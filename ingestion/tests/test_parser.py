"""Tests for the CSV parsing layer: bank parsers and the parser router."""

from datetime import date
from decimal import Decimal

import pytest

from ingestion.pipeline.parser import (
    UnsupportedBankError,
    detect_bank_from_content,
    get_parser,
    parse_csv,
)
from ingestion.pipeline.parsers.axis import AxisParser
from ingestion.pipeline.parsers.hdfc import HDFCParser

# Real-format HDFC CSV fixture (2-digit year, trailing spaces on dates)
HDFC_SAMPLE = """Date     ,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
01/05/26  ,UPI-MALNAD HALLI THOTA-PAYTM.S1UZESK@PTY-YESB0MCHUPI-612535829269-UPI SEND MONEY,01/05/26,434.00,,0000612535829269,1122118.71
02/05/26  ,IB BILLPAY DR-HDFCSI-485498XXXXXX3363,02/05/26,4622.00,,NBZBEDFSSBEBCZL1,1123971.53
06/05/26  ,K4UXS7UOARZ2DOWVCI/PAYUSWIGGYIN,06/05/26,350.00,,,1122118.71
10/05/26  ,SALARY CR-ACMECORP,10/05/26,,85000.00,SAL2605100001,1207118.71"""

# Same data but with different header case (tests header normalisation)
HDFC_SAMPLE_MIXED_CASE = """DATE     ,NARRATION,VALUE DAT,DEBIT AMOUNT,CREDIT AMOUNT,CHQ/REF NUMBER,CLOSING BALANCE
01/05/26  ,UPI-MERCHANT-VPA@PTY-YESB0X-123456-UPI,01/05/26,100.00,,,50000.00"""


def test_hdfc_parse_upi_transaction():
    parser = HDFCParser()
    rows, _ = parser.parse_csv(HDFC_SAMPLE)
    row = rows[0]
    assert row["transaction_date"] == date(2026, 5, 1)
    assert row["amount"] == Decimal("434.00")
    assert row["transaction_type"] == "debit"
    assert row["reference_number"] == "0000612535829269"


def test_hdfc_parse_bill_payment():
    parser = HDFCParser()
    rows, _ = parser.parse_csv(HDFC_SAMPLE)
    row = rows[1]
    assert row["transaction_date"] == date(2026, 5, 2)
    assert row["amount"] == Decimal("4622.00")
    assert row["transaction_type"] == "debit"
    assert row["reference_number"] == "NBZBEDFSSBEBCZL1"


def test_hdfc_parse_credit():
    parser = HDFCParser()
    rows, _ = parser.parse_csv(HDFC_SAMPLE)
    salary_row = next(r for r in rows if r["transaction_type"] == "credit")
    assert salary_row["amount"] == Decimal("85000.00")
    assert salary_row["transaction_date"] == date(2026, 5, 10)


def test_hdfc_date_format_two_digit_year():
    parser = HDFCParser()
    rows, _ = parser.parse_csv(HDFC_SAMPLE)
    # All dates should parse correctly to 2026
    years = {r["transaction_date"].year for r in rows}
    assert years == {2026}


def test_hdfc_amount_cleaning():
    parser = HDFCParser()
    assert parser.clean_amount("  434.00  ") == Decimal("434.00")
    assert parser.clean_amount("1,23,456.78") == Decimal("123456.78")
    assert parser.clean_amount("") == Decimal("0")
    assert parser.clean_amount("-") == Decimal("0")
    assert parser.clean_amount("434.00Cr") == Decimal("434.00")


def test_hdfc_no_reference_number_when_empty():
    parser = HDFCParser()
    rows, _ = parser.parse_csv(HDFC_SAMPLE)
    # Row 3 (Swiggy) has no reference number
    swiggy_row = rows[2]
    assert swiggy_row["reference_number"] is None


def test_hdfc_skips_zero_amount_rows():
    csv_with_blank = HDFC_SAMPLE + "\n03/05/26  ,,03/05/26,,,,"
    parser = HDFCParser()
    rows, _ = parser.parse_csv(csv_with_blank)
    assert len(rows) == 4  # blank row should be skipped


def test_parser_router_hdfc():
    parser = get_parser("HDFC Bank")
    assert parser.bank_name == "HDFC Bank"


def test_parser_router_unsupported():
    with pytest.raises(UnsupportedBankError):
        get_parser("Some Unknown Bank")


def test_parser_fallback_detection():
    detected = detect_bank_from_content(HDFC_SAMPLE)
    assert detected == "HDFC Bank"


def test_parse_csv_via_router():
    rows, _, _ = parse_csv("HDFC Bank", HDFC_SAMPLE)
    assert len(rows) == 4


def test_parse_csv_header_case_insensitive():
    parser = HDFCParser()
    rows, _ = parser.parse_csv(HDFC_SAMPLE_MIXED_CASE)
    assert len(rows) == 1
    assert rows[0]["amount"] == Decimal("100.00")


def test_hdfc_closing_balance_extracted():
    """Closing balance is extracted from HDFC CSV row."""
    rows, _ = HDFCParser().parse_csv(HDFC_SAMPLE)
    assert rows[0].get("closing_balance") is not None
    assert rows[0]["closing_balance"] == Decimal("1122118.71")


def test_closing_balance_nullable():
    """Closing balance is None when column is missing or empty."""
    csv_without_balance = """Date,Narration,Debit Amount,Credit Amount,Chq/Ref Number
01/05/26,UPI-TEST,100.00,,"""
    rows, _ = HDFCParser().parse_csv(csv_without_balance)
    assert rows[0]["closing_balance"] is None


def test_closing_balance_decimal_precision():
    """Closing balance preserves two decimal places."""
    rows, _ = HDFCParser().parse_csv(HDFC_SAMPLE)
    balance = rows[0]["closing_balance"]
    assert isinstance(balance, Decimal)


def test_row_number_preserved():
    """Row numbers reflect original CSV position."""
    rows, _ = HDFCParser().parse_csv(HDFC_SAMPLE)
    for i, row in enumerate(rows):
        assert row["row_number"] == i


def test_row_number_intraday_order():
    """Multiple transactions on same day preserve CSV order."""
    csv = """Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
01/05/26,UPI-MERCHANT-A,01/05/26,100.00,,REF001,1000.00
01/05/26,UPI-MERCHANT-B,01/05/26,200.00,,REF002,800.00
01/05/26,UPI-MERCHANT-C,01/05/26,50.00,,REF003,750.00"""
    rows, _ = HDFCParser().parse_csv(csv)
    assert rows[0]["row_number"] == 0
    assert rows[1]["row_number"] == 1
    assert rows[2]["row_number"] == 2


# ── Skipped-row tracking tests ────────────────────────────────────────────────


def test_skipped_rows_returned_in_tuple():
    """parse_csv returns a (rows, skipped, parser) tuple."""
    rows, skipped, parser = parse_csv("HDFC Bank", HDFC_SAMPLE)
    assert isinstance(rows, list)
    assert isinstance(skipped, list)


def test_no_skipped_rows_returns_empty_list():
    """Clean CSV produces an empty skipped list."""
    _, skipped, _ = parse_csv("HDFC Bank", HDFC_SAMPLE)
    assert skipped == []


def test_zero_amount_row_skipped_with_reason():
    """A row where both debit and credit are zero is skipped with reason='zero_amount'."""
    csv = """Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
01/05/26,ZERO-AMOUNT-TXN,01/05/26,0.00,0.00,REF000,1000.00"""
    rows, skipped = HDFCParser().parse_csv(csv)
    assert len(rows) == 0
    assert len(skipped) == 1
    assert skipped[0]["reason"] == "zero_amount"
    assert skipped[0]["date"] == "01/05/26"


def test_invalid_date_row_skipped_with_reason():
    """A row with an unparseable date is skipped with reason='invalid_date'."""
    csv = """Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
NOTADATE,UPI-MERCHANT,NOTADATE,100.00,,REF000,1000.00"""
    rows, skipped = HDFCParser().parse_csv(csv)
    assert len(rows) == 0
    assert len(skipped) == 1
    assert skipped[0]["reason"] == "invalid_date"


def test_malformed_row_skipped_with_reason():
    """A row with too few columns is skipped with reason='malformed_row'."""
    csv = """Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
01/05/26,UPI-TEST"""
    rows, skipped = HDFCParser().parse_csv(csv)
    assert len(rows) == 0
    assert len(skipped) == 1
    assert skipped[0]["reason"] == "malformed_row"


def test_skipped_rows_contain_original_values():
    """Skipped row records preserve the raw field values from the CSV."""
    csv = """Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
01/05/26,ZERO-AMOUNT-TXN,01/05/26,0.00,0.00,REF123,1000.00"""
    _, skipped = HDFCParser().parse_csv(csv)
    assert len(skipped) == 1
    row = skipped[0]
    assert row["date"] == "01/05/26"
    assert row["narration"] == "ZERO-AMOUNT-TXN"
    assert row["debit"] == "0.00"
    assert row["credit"] == "0.00"
    assert row["reference"] == "REF123"
    assert row["reason"] == "zero_amount"


def test_multiple_skipped_rows_all_returned():
    """All skipped rows in a file appear in the skipped list."""
    csv = """Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
01/05/26,ZERO-ONE,01/05/26,0.00,0.00,REF001,1000.00
01/05/26,ZERO-TWO,01/05/26,0.00,0.00,REF002,1000.00
01/05/26,VALID-TXN,01/05/26,100.00,,REF003,900.00"""
    rows, skipped = HDFCParser().parse_csv(csv)
    assert len(rows) == 1
    assert len(skipped) == 2
    assert all(s["reason"] == "zero_amount" for s in skipped)


# ── normalize_narration tests ─────────────────────────────────────────────────


def test_hdfc_bill_payment_normalize_narration():
    """HDFC IB BILLPAY DR detected by normalize_narration."""
    parser = HDFCParser()
    result = parser.normalize_narration(
        "IB BILLPAY DR-HDFCSI-HDFC BANK LTD-NETBANK,MUM-..."
    )
    assert result is not None
    assert result["merchant"] == "HDFC Credit Card"
    assert result["payment_method"] == "Bill Pay"
    assert result["category"] == "Finance"
    assert result["subcategory"] == "Credit Card"
    assert result["needs_llm"] is False


def test_hdfc_non_billpay_returns_none():
    """Non-bill-payment HDFC narration returns None."""
    parser = HDFCParser()
    result = parser.normalize_narration(
        "UPI-SWIGGY-SWIGGY@HDFCBANK-HDFC0000001-..."
    )
    assert result is None


def test_axis_cwdr_normalize_narration():
    """Axis CWDR detected as ATM withdrawal."""
    parser = AxisParser()
    result = parser.normalize_narration("CWDR/ATM/123456/BANGALORE")
    assert result is not None
    assert result["payment_method"] == "ATM"
    assert result["category"] == "ATM Withdrawal"
    assert result["needs_llm"] is False


def test_axis_pur_normalize_narration():
    """Axis PUR detected as POS purchase."""
    parser = AxisParser()
    result = parser.normalize_narration("PUR/AMAZON/123456")
    assert result is not None
    assert result["payment_method"] == "POS"
    assert result["category"] == "Shopping"
    assert result["needs_llm"] is False


def test_axis_vmt_icon_before_vmt():
    """VMT-ICON matched before VMT (longest prefix first)."""
    parser = AxisParser()
    result = parser.normalize_narration("VMT-ICON/TRANSFER/...")
    assert result is not None
    assert result["payment_method"] == "Transfer"


def test_axis_unknown_code_returns_none():
    """Unknown Axis narration code returns None."""
    parser = AxisParser()
    result = parser.normalize_narration("UPI-SWIGGY-...")
    assert result is None


def test_base_parser_normalize_narration_returns_none():
    """Base parser normalize_narration always returns None."""
    from ingestion.pipeline.parsers.base import BaseCSVParser
    # BaseCSVParser is abstract — use HDFCParser as concrete, call base directly
    parser = HDFCParser()
    result = BaseCSVParser.normalize_narration(parser, "ANY NARRATION")
    assert result is None


def test_normalize_batch_uses_parser():
    """normalize_batch passes parser to normalize_deterministic."""
    import asyncio
    from unittest.mock import AsyncMock, MagicMock

    from ingestion.pipeline.normalizer import normalize_batch

    mock_parser = MagicMock()
    mock_parser.normalize_narration.return_value = None

    rows = [{
        "transaction_date": date(2026, 5, 1),
        "raw_description": "UPI-SWIGGY-TEST",
        "amount": Decimal("610.00"),
        "transaction_type": "debit",
        "reference_number": "REF001",
        "closing_balance": Decimal("1000.00"),
        "row_number": 0,
    }]

    mock_client = MagicMock()
    mock_client.normalize = AsyncMock(return_value={
        "merchant_name": "Swiggy",
        "category": "Food",
        "subcategory": "Food Delivery",
    })

    result = asyncio.run(
        normalize_batch(rows, mock_client, parser=mock_parser)
    )
    mock_parser.normalize_narration.assert_called_once()
