import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from .base import BaseCSVParser, NarrationResult, ParsedRow, SkippedRow

# (prefix, payment_method, category) — sorted longest-first so specific prefixes
# are matched before shorter overlapping ones
SBI_NARRATION_PATTERNS: list[tuple[str, str, str]] = [
    ("BY TRANSFER-INB IMPS", "IMPS", "Transfer"),
    ("BY TRANSFER-INB NEFT", "NEFT", "Transfer"),
    ("BY TRANSFER-INB RTGS", "RTGS", "Transfer"),
    ("TO TRANSFER-INB IMPS", "IMPS", "Transfer"),
    ("TO TRANSFER-INB NEFT", "NEFT", "Transfer"),
    ("TO TRANSFER-INB RTGS", "RTGS", "Transfer"),
    ("BY TRANSFER-NEFT", "NEFT", "Transfer"),
    ("TO TRANSFER-NEFT", "NEFT", "Transfer"),
    ("BY TRANSFER-UPI", "UPI", "Transfer"),
    ("TO TRANSFER-UPI", "UPI", "Transfer"),
    ("CREDIT INTEREST", "Other", "Interest"),
    ("DEBIT INTEREST", "Other", "Interest"),
    ("ATM CASH", "ATM", "ATM Withdrawal"),
    ("NACH DR", "NACH", "EMI"),
    ("NACH CR", "NACH", "Transfer"),
    ("BY CLG", "Cheque", "Transfer"),
    ("TO CLG", "Cheque", "Transfer"),
    ("ATW", "ATM", "ATM Withdrawal"),
    ("POS", "POS", "Shopping"),
    ("EMI", "Auto-debit", "EMI"),
]


class SBIParser(BaseCSVParser):
    @property
    def bank_name(self) -> str:
        return "State Bank of India"

    @property
    def bank_code(self) -> str:
        return "SBI"

    @property
    def column_map(self) -> dict[str, list[str]]:
        return {
            "date": ["txn date", "transaction date", "date"],
            # "description" only — omitting "narration"/"particulars" prevents
            # HDFC headers from satisfying validate_headers for wrong-bank uploads
            "narration": ["description"],
            "debit": ["debit", "dr", "withdrawal"],
            "credit": ["credit", "cr", "deposit"],
            "reference": ["ref no./cheque no.", "reference", "cheque no"],
            "balance": ["balance"],
        }

    def parse_date(self, date_str: str) -> date | None:
        s = date_str.strip()
        if not s:
            return None
        for fmt in ("%d %b %Y", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
        return None

    def clean_amount(self, raw: str) -> Decimal:
        # Handles Indian lakh-format amounts that may be double-quoted in CSV
        # e.g. "15,74,555.38" or "50,000.00"
        cleaned = raw.strip().strip('"').replace(",", "").replace(" ", "")
        if not cleaned or cleaned == "-":
            return Decimal("0")
        try:
            return Decimal(cleaned)
        except InvalidOperation:
            return Decimal("0")

    def _clean_reference(self, ref_raw: str) -> str | None:
        ref = ref_raw.strip()
        if not ref_raw:
            return None
        
        # Reject — counterparty account info, not a reference number
        if ref.upper().startswith("TRANSFER FROM"):
            return None
            
        # "NEFT INB: IR00BJGQR8 / name_of_person" → "IR00BJGQR8"
        neft_match = re.match(r'NEFT INB:\s*(\S+)', ref_raw)
        if neft_match:
            return neft_match.group(1).rstrip('/')
        # Duplicated ref: "MAI000085898680          MAI000085898680" → "MAI000085898680"
        parts = re.split(r'\s{2,}', ref_raw.strip())
        first = parts[0].strip() if parts else ref_raw.strip()
        first = first.split('/')[0].strip()
        if not first or re.fullmatch(r'0+', first):
            return None
        return first

    def _extract_merchant_from_narration(self, narration: str) -> str | None:
        s = re.sub(r'-+$', '', narration).strip()
        # IMPS: extract VPA/name from IMPS<txnid>/<segment>/... — skip pure-digit account numbers
        imps_match = re.search(r'IMPS\d+/([^/]+)/', s, re.IGNORECASE)
        if imps_match:
            segment = imps_match.group(1).strip()
            if not re.fullmatch(r'\d+', segment):
                return segment.title()
        # NEFT: name appears after "--" at end of narration
        neft_match = re.search(r'--(.+)$', s)
        if neft_match:
            name = neft_match.group(1).strip()
            if len(name) > 1:
                return name.title()
        return None

    def normalize_narration(self, narration: str) -> NarrationResult | None:
        upper = narration.upper().strip()
        for prefix, payment_method, category in sorted(
            SBI_NARRATION_PATTERNS, key=lambda x: len(x[0]), reverse=True
        ):
            if upper.startswith(prefix):
                merchant = self._extract_merchant_from_narration(narration)
                return NarrationResult(
                    merchant=merchant or prefix.title(),
                    payment_method=payment_method,
                    category=category,
                    subcategory=None,
                    needs_llm=merchant is None,
                )
        return None

    def _parse_row(
        self,
        row: dict[str, str],
        header_map: dict[str, str],
        row_number: int,
    ) -> tuple[ParsedRow, None] | tuple[None, SkippedRow]:
        raw_date = row.get(header_map.get("date", ""), "").strip()
        raw_narration = row.get(header_map.get("narration", ""), "").strip()
        debit_raw = row.get(header_map.get("debit", ""), "").strip()
        credit_raw = row.get(header_map.get("credit", ""), "").strip()
        ref_raw = row.get(header_map.get("reference", ""), "").strip()

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

        reference_number = self._clean_reference(ref_raw)

        balance_raw = row.get(header_map.get("balance", ""), "")
        closing_balance = (
            self.clean_amount(balance_raw) if balance_raw.strip() else None
        )

        return ParsedRow(
            transaction_date=parsed_date,
            raw_description=raw_narration,
            amount=amount,
            transaction_type=transaction_type,
            reference_number=reference_number,
            closing_balance=closing_balance,
        ), None
