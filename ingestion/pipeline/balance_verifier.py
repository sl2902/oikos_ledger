"""Balance verification for parsed bank statement rows.

Verifies that closing balances are mathematically consistent
across all rows. Does not reject the upload on failure —
flags discrepancies for display in the UI.
"""

from dataclasses import dataclass, field
from decimal import Decimal

from ingestion.pipeline.parsers.base import ParsedRow


@dataclass
class BalanceVerification:
    is_valid: bool
    opening_balance: Decimal
    closing_balance: Decimal
    total_debits: Decimal
    total_credits: Decimal
    mismatched_rows: list[int] = field(default_factory=list)
    discrepancy: Decimal = Decimal("0")
    error_message: str | None = None


def verify_balance(rows: list[ParsedRow]) -> BalanceVerification:
    """Verify closing balance consistency across all parsed rows.

    Steps:
    1. Sort rows by transaction_date ascending (oldest first)
    2. Compute opening balance from first row:
       opening = first_closing + first_debit - first_credit
    3. For each subsequent row verify:
       previous_closing + current_credit - current_debit
       == current_closing (within 0.01 tolerance for rounding)
    4. Track mismatched row indices
    5. Return BalanceVerification result

    Returns BalanceVerification with is_valid=False if any
    row has a discrepancy. Never raises — returns error in
    error_message if input is invalid.
    """
    if not rows:
        return BalanceVerification(
            is_valid=False,
            opening_balance=Decimal("0"),
            closing_balance=Decimal("0"),
            total_debits=Decimal("0"),
            total_credits=Decimal("0"),
            error_message="No rows to verify",
        )

    # Filter rows that have closing_balance
    rows_with_balance = [r for r in rows if r.get("closing_balance") is not None]

    if not rows_with_balance:
        return BalanceVerification(
            is_valid=False,
            opening_balance=Decimal("0"),
            closing_balance=Decimal("0"),
            total_debits=Decimal("0"),
            total_credits=Decimal("0"),
            error_message="No closing balance data available",
        )

    # Sort by row_number when available (preserves intra-day order), fall back to date
    if all(r.get("row_number") is not None for r in rows_with_balance):
        sorted_rows = sorted(rows_with_balance, key=lambda r: r["row_number"])
    else:
        sorted_rows = sorted(rows_with_balance, key=lambda r: r["transaction_date"])

    # Compute opening balance from first row
    first = sorted_rows[0]
    first_closing = first["closing_balance"]
    first_debit = first["amount"] if first["transaction_type"] == "debit" else Decimal("0")
    first_credit = first["amount"] if first["transaction_type"] == "credit" else Decimal("0")
    opening_balance = first_closing + first_debit - first_credit

    # Verify each row
    mismatched_rows = []
    tolerance = Decimal("0.01")
    prev_closing = first_closing
    total_debits = Decimal("0")
    total_credits = Decimal("0")

    for i, row in enumerate(sorted_rows[1:], start=1):
        debit = row["amount"] if row["transaction_type"] == "debit" else Decimal("0")
        credit = row["amount"] if row["transaction_type"] == "credit" else Decimal("0")
        total_debits += debit
        total_credits += credit

        expected_closing = prev_closing + credit - debit
        actual_closing = row["closing_balance"]

        if abs(expected_closing - actual_closing) > tolerance:
            mismatched_rows.append(i)

        prev_closing = actual_closing

    # Add first row amounts to totals
    total_debits += first_debit
    total_credits += first_credit

    closing_balance = sorted_rows[-1]["closing_balance"]
    is_valid = len(mismatched_rows) == 0

    # Calculate total discrepancy
    expected_closing = opening_balance + total_credits - total_debits
    discrepancy = abs(expected_closing - closing_balance)

    return BalanceVerification(
        is_valid=is_valid,
        opening_balance=opening_balance,
        closing_balance=closing_balance,
        total_debits=total_debits,
        total_credits=total_credits,
        mismatched_rows=mismatched_rows,
        discrepancy=discrepancy,
    )
