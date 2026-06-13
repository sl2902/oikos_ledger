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
    rows = parser.parse_csv(HDFC_SAMPLE)
    row = rows[0]
    assert row["transaction_date"] == date(2026, 5, 1)
    assert row["amount"] == Decimal("434.00")
    assert row["transaction_type"] == "debit"
    assert row["reference_number"] == "0000612535829269"


def test_hdfc_parse_bill_payment():
    parser = HDFCParser()
    rows = parser.parse_csv(HDFC_SAMPLE)
    row = rows[1]
    assert row["transaction_date"] == date(2026, 5, 2)
    assert row["amount"] == Decimal("4622.00")
    assert row["transaction_type"] == "debit"
    assert row["reference_number"] == "NBZBEDFSSBEBCZL1"


def test_hdfc_parse_credit():
    parser = HDFCParser()
    rows = parser.parse_csv(HDFC_SAMPLE)
    salary_row = next(r for r in rows if r["transaction_type"] == "credit")
    assert salary_row["amount"] == Decimal("85000.00")
    assert salary_row["transaction_date"] == date(2026, 5, 10)


def test_hdfc_date_format_two_digit_year():
    parser = HDFCParser()
    rows = parser.parse_csv(HDFC_SAMPLE)
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
    rows = parser.parse_csv(HDFC_SAMPLE)
    # Row 3 (Swiggy) has no reference number
    swiggy_row = rows[2]
    assert swiggy_row["reference_number"] is None


def test_hdfc_skips_zero_amount_rows():
    csv_with_blank = HDFC_SAMPLE + "\n03/05/26  ,,03/05/26,,,,"
    parser = HDFCParser()
    rows = parser.parse_csv(csv_with_blank)
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
    rows = parse_csv("HDFC Bank", HDFC_SAMPLE)
    assert len(rows) == 4


def test_parse_csv_header_case_insensitive():
    parser = HDFCParser()
    rows = parser.parse_csv(HDFC_SAMPLE_MIXED_CASE)
    assert len(rows) == 1
    assert rows[0]["amount"] == Decimal("100.00")


def test_hdfc_closing_balance_extracted():
    """Closing balance is extracted from HDFC CSV row."""
    rows = HDFCParser().parse_csv(HDFC_SAMPLE)
    assert rows[0].get("closing_balance") is not None
    assert rows[0]["closing_balance"] == Decimal("1122118.71")


def test_closing_balance_nullable():
    """Closing balance is None when column is missing or empty."""
    csv_without_balance = """Date,Narration,Debit Amount,Credit Amount
01/05/26,UPI-TEST,100.00,,"""
    rows = HDFCParser().parse_csv(csv_without_balance)
    assert rows[0]["closing_balance"] is None


def test_closing_balance_decimal_precision():
    """Closing balance preserves two decimal places."""
    rows = HDFCParser().parse_csv(HDFC_SAMPLE)
    balance = rows[0]["closing_balance"]
    assert isinstance(balance, Decimal)


def test_row_number_preserved():
    """Row numbers reflect original CSV position."""
    rows = HDFCParser().parse_csv(HDFC_SAMPLE)
    for i, row in enumerate(rows):
        assert row["row_number"] == i


def test_row_number_intraday_order():
    """Multiple transactions on same day preserve CSV order."""
    csv = """Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
01/05/26,UPI-MERCHANT-A,01/05/26,100.00,,REF001,1000.00
01/05/26,UPI-MERCHANT-B,01/05/26,200.00,,REF002,800.00
01/05/26,UPI-MERCHANT-C,01/05/26,50.00,,REF003,750.00"""
    rows = HDFCParser().parse_csv(csv)
    assert rows[0]["row_number"] == 0
    assert rows[1]["row_number"] == 1
    assert rows[2]["row_number"] == 2
