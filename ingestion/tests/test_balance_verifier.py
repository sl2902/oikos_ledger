from datetime import date
from decimal import Decimal

from ingestion.pipeline.balance_verifier import verify_balance
from ingestion.pipeline.parsers.base import ParsedRow


def make_row(
    date_val: date,
    amount: str,
    txn_type: str,
    closing: str,
) -> ParsedRow:
    return ParsedRow(
        transaction_date=date_val,
        raw_description="TEST",
        amount=Decimal(amount),
        transaction_type=txn_type,
        reference_number=None,
        closing_balance=Decimal(closing),
    )


def test_valid_balance_sequence():
    rows = [
        make_row(date(2026, 5, 1), "434.00", "debit", "1122118.71"),
        make_row(date(2026, 5, 2), "4622.00", "debit", "1117496.71"),
        make_row(date(2026, 5, 3), "240.00", "debit", "1117256.71"),
    ]
    result = verify_balance(rows)
    assert result.is_valid is True
    assert result.opening_balance == Decimal("1122552.71")
    assert result.closing_balance == Decimal("1117256.71")
    assert result.mismatched_rows == []


def test_invalid_balance_sequence():
    rows = [
        make_row(date(2026, 5, 1), "434.00", "debit", "1122118.71"),
        make_row(date(2026, 5, 2), "4622.00", "debit", "1000000.00"),  # wrong
    ]
    result = verify_balance(rows)
    assert result.is_valid is False
    assert 1 in result.mismatched_rows


def test_opening_balance_calculation():
    rows = [
        make_row(date(2026, 5, 1), "434.00", "debit", "1122118.71"),
    ]
    result = verify_balance(rows)
    assert result.opening_balance == Decimal("1122552.71")


def test_credit_transaction():
    rows = [
        make_row(date(2026, 5, 1), "85000.00", "credit", "1207118.71"),
    ]
    result = verify_balance(rows)
    assert result.opening_balance == Decimal("1122118.71")


def test_empty_rows():
    result = verify_balance([])
    assert result.is_valid is False
    assert result.error_message == "No rows to verify"


def test_rows_without_closing_balance():
    rows = [
        ParsedRow(
            transaction_date=date(2026, 5, 1),
            raw_description="TEST",
            amount=Decimal("100"),
            transaction_type="debit",
            reference_number=None,
            closing_balance=None,
        )
    ]
    result = verify_balance(rows)
    assert result.is_valid is False
    assert result.error_message == "No closing balance data available"


def test_sorts_by_date():
    """Rows out of order should be sorted before verification."""
    rows = [
        make_row(date(2026, 5, 3), "240.00", "debit", "1117256.71"),
        make_row(date(2026, 5, 1), "434.00", "debit", "1122118.71"),
        make_row(date(2026, 5, 2), "4622.00", "debit", "1117496.71"),
    ]
    result = verify_balance(rows)
    assert result.is_valid is True
    assert result.opening_balance == Decimal("1122552.71")
