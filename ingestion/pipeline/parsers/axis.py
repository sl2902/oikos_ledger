import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from .base import BaseCSVParser, NarrationResult, ParsedRow, SkippedRow


class AxisParser(BaseCSVParser):
    """Parser for Axis Bank CSV statements.

    Expected columns: SRL NO, Tran Date, CHQNO, PARTICULARS, DR, CR, BAL, SOL
    Date format: DD-MM-YYYY
    Amount format: may include commas (1,040.00)
    Reference: '-' when absent
    SOL: branch code — ignored
    """

    AXIS_NARRATION_CODES: dict[str, tuple[str, str]] = {
        "ICONN": ("NEFT", "Transfer"),
        "VMT-ICON": ("Transfer", "Transfer"),
        "VMT": ("Transfer", "Transfer"),
        "AUTOSWEEP": ("Transfer", "Investment"),
        "REV SWEEP": ("Transfer", "Interest"),
        "SWEEP TRF": ("Transfer", "Transfer"),
        "CWDR": ("ATM", "ATM Withdrawal"),
        "TIP/SCG": ("Other", "Charges"),
        "RATE.DIFF": ("Other", "Charges"),
        "CLG": ("Cheque", "Transfer"),
        "EDC": ("POS", "Shopping"),
        "SETU": ("IMPS", "Transfer"),
        "INT.PD": ("Other", "Interest"),
    }

    # Slash-pattern narrations — extracted deterministically
    # Format: {PREFIX}/{SEGMENT1}/{MERCHANT_OR_INFO}/...
    # merchant_segment_index: position of merchant in slash parts (-1 = last non-empty)
    SLASH_PATTERNS: dict[str, tuple[str, str, int]] = {
        "ATM-CASH-AXIS": ("ATM", "ATM Withdrawal", -1),
        "INB": ("NEFT", "Transfer", 2),
        "POS": ("POS", "Shopping", 1),
        "PUR": ("POS", "Shopping", 1),
    }

    @property
    def bank_name(self) -> str:
        return "Axis Bank"

    @property
    def bank_code(self) -> str:
        return "Axis"

    @property
    def column_map(self) -> dict[str, list[str]]:
        return {
            "date": ["tran date", "transaction date", "date"],
            # "particulars" only — avoids matching HDFC's "Narration" header
            "narration": ["particulars"],
            "debit": ["dr", "debit", "withdrawal", "debit amount"],
            "credit": ["cr", "credit", "deposit", "credit amount"],
            "balance": ["bal", "balance", "closing balance"],
            "reference": ["chqno", "chq no", "reference", "ref no"],
        }

    def parse_date(self, date_str: str) -> date | None:
        """Parse Axis date format DD-MM-YYYY."""
        date_str = date_str.strip()
        for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%d-%m-%y", "%d/%m/%y"):
            try:
                return datetime.strptime(date_str, fmt).date()
            except ValueError:
                continue
        return None

    def clean_amount(self, raw: str) -> Decimal:
        """Clean Axis amount format — strip commas and spaces."""
        cleaned = raw.strip().replace(",", "").replace(" ", "")
        if not cleaned:
            return Decimal("0")
        try:
            return Decimal(cleaned)
        except InvalidOperation:
            return Decimal("0")

    def _extract_slash_merchant(self, narration: str, segment_index: int) -> str | None:
        """Extract merchant from slash-separated narration."""
        parts = narration.split("/")
        if segment_index == -1:
            non_empty = [p.strip() for p in parts if p.strip()]
            return non_empty[-1].title() if non_empty else None
        if len(parts) > segment_index:
            merchant = parts[segment_index].strip()
            # Remove trailing transaction metadata in parentheses
            merchant = re.sub(r'\(.*?\)', '', merchant).strip()
            return merchant.title() if merchant else None
        return None

    def normalize_narration(self, narration: str) -> NarrationResult | None:
        """Handle Axis Bank narration patterns.

        Priority:
        1. Slash patterns (ATM-CASH-AXIS/, INB/, POS/, PUR/)
        2. Axis narration codes (CWDR, CLG, SETU, etc.)
        """
        upper = narration.upper().strip()

        # Step 1: slash pattern detection — longest prefix first
        for prefix, (payment_method, category, merchant_idx) in sorted(
            self.SLASH_PATTERNS.items(),
            key=lambda x: len(x[0]),
            reverse=True,
        ):
            if upper.startswith(prefix.upper() + "/"):
                merchant = self._extract_slash_merchant(narration, merchant_idx)
                return NarrationResult(
                    merchant=merchant or prefix.title(),
                    payment_method=payment_method,
                    category=category,
                    subcategory=None,
                    needs_llm=merchant is None,
                )

        # Step 2: axis narration code detection — longest first
        for code, (payment_method, category) in sorted(
            self.AXIS_NARRATION_CODES.items(),
            key=lambda x: len(x[0]),
            reverse=True,
        ):
            if upper.startswith(code.upper()):
                remainder = narration[len(code):].strip().lstrip("-/").strip()
                merchant = remainder[:50].title() if remainder else code.title()
                return NarrationResult(
                    merchant=merchant,
                    payment_method=payment_method,
                    category=category,
                    subcategory=None,
                    needs_llm=False,
                )

        return None

    def _parse_row(
        self,
        row: dict[str, str],
        header_map: dict[str, str],
        row_number: int,
    ) -> tuple[ParsedRow, None] | tuple[None, SkippedRow]:
        """Parse single Axis CSV row."""
        raw_date = row.get(header_map.get("date", ""), "").strip()
        raw_narration = row.get(header_map.get("narration", ""), "").strip()
        debit_raw = row.get(header_map.get("debit", ""), "").strip()
        credit_raw = row.get(header_map.get("credit", ""), "").strip()
        ref_raw = row.get(header_map.get("reference", ""), "").strip()
        balance_raw = row.get(header_map.get("balance", ""), "").strip()

        def skipped(reason: str) -> tuple[None, SkippedRow]:
            return None, SkippedRow(
                row_number=row_number,
                date=raw_date,
                narration=raw_narration[:100],
                debit=debit_raw,
                credit=credit_raw,
                reference=ref_raw,
                reason=reason,  # type: ignore[arg-type]
            )

        debit = self.clean_amount(debit_raw)
        credit = self.clean_amount(credit_raw)

        if debit == Decimal("0") and credit == Decimal("0"):
            return skipped("zero_amount")

        parsed_date = self.parse_date(raw_date)
        if parsed_date is None:
            return skipped("invalid_date")

        if not raw_narration:
            return skipped("missing_narration")

        if debit > Decimal("0"):
            amount = debit
            transaction_type = "debit"
        else:
            amount = credit
            transaction_type = "credit"

        # Treat '-' and all-zero references as null
        reference_number = None
        if ref_raw and ref_raw != "-" and not re.fullmatch(r'0+', ref_raw):
            reference_number = ref_raw

        closing_balance = (
            self.clean_amount(balance_raw) if balance_raw else None
        )

        return ParsedRow(
            transaction_date=parsed_date,
            raw_description=raw_narration,
            amount=amount,
            transaction_type=transaction_type,
            reference_number=reference_number,
            closing_balance=closing_balance,
        ), None
