import csv
import io
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from ingestion.pipeline.parsers.base import (
    BaseCSVParser,
    NarrationResult,
    ParsedRow,
    SkippedRow,
)


class ICICIParser(BaseCSVParser):
    """Parser for ICICI Bank CSV statements.

    Expected columns (headers may contain newlines):
    S No., Value Date, Transaction Date, Cheque Number,
    Transaction Remarks, Withdrawal Amount (INR),
    Deposit Amount (INR), Balance (INR)

    Date format: DD/MM/YYYY
    Amount format: plain decimal 2500.00
    Reference: '-' when absent
    Narration: quoted, may contain newlines
    """

    bank_name = "ICICI Bank"
    bank_code = "ICICI"

    ICICI_NARRATION_CODES: dict[str, tuple[str, str]] = {
        "BBPS": ("Bill Pay", "Utilities"),
        "BCTT": ("Other", "Charges"),
        "BIL": ("NEFT", "Transfer"),
        "BPAY": ("Bill Pay", "Utilities"),
        "CCWD": ("ATM", "ATM Withdrawal"),
        "DTAX": ("Other", "Government"),
        "EBA": ("Other", "Investment"),
        "IDTX": ("Other", "Government"),
        "IMPS": ("IMPS", "Transfer"),
        "INF": ("Transfer", "Transfer"),
        "INFT": ("Transfer", "Transfer"),
        "LCCBRN CMS": ("Cheque", "Transfer"),
        "LNPY": ("Other", "EMI"),
        "MMT": ("IMPS", "Transfer"),
        "N CHG": ("Other", "Charges"),
        "NEFT": ("NEFT", "Transfer"),
        "ONL": ("POS", "Shopping"),
        "PAC": ("Other", "Insurance"),
        "PAVC": ("Other", "Charges"),
        "PAYC": ("UPI", "Transfer"),
        "RCHG": ("Other", "Recharge"),
        "SGB": ("Other", "Investment"),
        "SMO": ("Other", "Transfer"),
        "T CHG": ("Other", "Charges"),
        "TOP": ("Other", "Recharge"),
        "UCCBRN CMS": ("Cheque", "Transfer"),
        "NFS": ("ATM", "ATM Withdrawal"),
        "VAT": ("ATM", "ATM Withdrawal"),
        "MAT": ("ATM", "ATM Withdrawal"),
        "VPS": ("POS", "Shopping"),
        "IPS": ("POS", "Shopping"),
    }

    # Slash-pattern narrations
    # Format: {CODE}/{SUBTYPE}/{TXN_ID}/{MERCHANT}/...
    # Value: (payment_method, category, merchant_segment_index)
    ICICI_SLASH_PATTERNS: dict[str, tuple[str, str, int]] = {
        "NFS/CASH WDL RVSL": ("ATM", "ATM Withdrawal", -2),
        "NFS/CASH WDL": ("ATM", "ATM Withdrawal", 3), # merchant code, not city
        "MMT/IMPS": ("IMPS", "Transfer", 3),
        "VPS": ("POS", "Shopping", 1),
        "IPS": ("POS", "Shopping", 1),
        "ONL": ("POS", "Shopping", 1),
    }

    @property
    def column_map(self) -> dict[str, list[str]]:
        return {
            "date": ["transaction date", "txn date", "date"],
            "narration": ["transaction remarks", "remarks",
                          "narration", "description", "particulars"],
            "debit": ["withdrawal amount (inr )", "withdrawal amount (inr)",
                      "withdrawal", "debit", "dr"],
            "credit": ["deposit amount (inr )", "deposit amount (inr)",
                       "deposit", "credit", "cr"],
            "balance": ["balance (inr )", "balance (inr)", "balance", "bal"],
            "reference": ["cheque number", "chq no", "reference", "ref no"],
        }

    def parse_csv(
        self, file_content: str
    ) -> tuple[list[ParsedRow], list[SkippedRow]]:
        """Override to handle ICICI multiline narrations and
        newlines in column headers.

        ICICI exports column headers with embedded newlines:
        'Withdrawal Amount\\n(INR )' — normalize these before
        passing to DictReader.
        """
        reader = csv.reader(io.StringIO(file_content.strip()))

        all_rows = list(reader)
        if not all_rows:
            return [], []

        # Normalize header — strip newlines within header cells
        raw_headers = [
            h.strip().replace("\n", " ").lower()
            for h in all_rows[0]
        ]

        expected_cols = len(raw_headers)
        header_map = self.detect_headers(raw_headers)

        if not self.validate_headers(header_map):
            raise ValueError(
                f"{self.bank_name} parser: required columns not found. "
                f"Got: {raw_headers}"
            )

        rows: list[ParsedRow] = []
        skipped: list[SkippedRow] = []

        for i, row_parts in enumerate(all_rows[1:]):
            if not any(p.strip() for p in row_parts):
                continue

            # Normalize narration — replace internal newlines with space
            row_parts = [p.replace("\n", " ").strip() for p in row_parts]

            if len(row_parts) != expected_cols:
                skipped.append(SkippedRow(
                    row_number=i,
                    date=row_parts[0] if row_parts else "",
                    narration=row_parts[4][:100] if len(row_parts) > 4 else "",
                    debit="",
                    credit="",
                    reference="",
                    reason="malformed_row",
                ))
                continue

            row = dict(zip(raw_headers, row_parts))
            parsed, skip = self._parse_row(row, header_map, i)
            if parsed is not None:
                parsed["row_number"] = i
                rows.append(parsed)
            elif skip is not None:
                skipped.append(skip)

        return rows, skipped

    def parse_date(self, date_str: str) -> date | None:
        """Parse ICICI date format DD/MM/YYYY."""
        date_str = date_str.strip()
        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
            try:
                return datetime.strptime(date_str, fmt).date()
            except ValueError:
                continue
        return None

    def clean_amount(self, raw: str) -> Decimal:
        """Clean ICICI amount — plain decimal, no commas."""
        cleaned = raw.strip().replace(",", "").replace(" ", "")
        if not cleaned or cleaned == "-":
            return Decimal("0")
        try:
            return Decimal(cleaned)
        except InvalidOperation:
            return Decimal("0")

    def _extract_slash_merchant(
        self, narration: str, segment_index: int
    ) -> str | None:
        """Extract merchant from slash-separated narration."""
        narration = re.sub(r'\s+', ' ', narration).strip()
        parts = narration.split("/")

        if segment_index == -2:
            # Second-to-last non-empty segment — typically city for ATM
            non_empty = [p.strip() for p in parts if p.strip()]
            if len(non_empty) >= 2:
                return non_empty[-2].title()
            return None

        if len(parts) > segment_index:
            merchant = parts[segment_index].strip()
            merchant = re.sub(r'\d{6,}', '', merchant).strip()
            merchant = re.sub(r'\s+', ' ', merchant).strip()
            return merchant.title() if merchant else None

        return None

    def normalize_narration(self, narration: str) -> NarrationResult | None:
        """Handle ICICI Bank narration patterns.

        Priority:
        1. Salary patterns
        2. Slash patterns (NFS/CASH WDL, VPS, MMT/IMPS, ONL)
        3. ICICI narration codes (BBPS, NEFT, IMPS etc.)
        """
        normalized = re.sub(r'\s+', ' ', narration).strip()
        upper = normalized.upper()

        # Step 1: Special patterns
        if "TRANSFER FROM SALARY" in upper or "SALARY CREDIT" in upper:
            return NarrationResult(
                merchant="Salary",
                payment_method="Salary",
                category="Salary",
                subcategory=None,
                needs_llm=False,
            )

        # Step 2: Slash pattern detection — longest prefix first
        for prefix, (payment_method, category, merchant_idx) in sorted(
            self.ICICI_SLASH_PATTERNS.items(),
            key=lambda x: len(x[0]),
            reverse=True,
        ):
            if upper.startswith(prefix.upper()):
                merchant = self._extract_slash_merchant(normalized, merchant_idx)
                return NarrationResult(
                    merchant=merchant or prefix.title(),
                    payment_method=payment_method,
                    category=category,
                    subcategory=None,
                    needs_llm=merchant is None,
                )

        # Step 3: ICICI code detection — longest first
        for code, (payment_method, category) in sorted(
            self.ICICI_NARRATION_CODES.items(),
            key=lambda x: len(x[0]),
            reverse=True,
        ):
            if upper.startswith(code.upper()):
                remainder = normalized[len(code):].strip().lstrip("/-").strip()
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
        """Parse single ICICI CSV row."""
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

        # Extract transaction ID from slash-pattern narrations as reference
        if reference_number is None:
            upper_narration = raw_narration.upper().replace('\n', ' ')
            narration_clean = raw_narration.replace('\n', ' ')

            if upper_narration.startswith("NFS/CASH WDL RVSL/"):
                parts = re.split(r'[\s/]+', narration_clean)
                for part in parts:
                    if re.fullmatch(r'\d{12,}', part.strip()):
                        reference_number = part.strip() + "-RVSL"
                        break
            elif upper_narration.startswith("NFS/"):
                parts = narration_clean.split("/")
                if len(parts) >= 3:
                    txn_id = parts[2].strip()
                    if txn_id and re.fullmatch(r'\d{12,}', txn_id):
                        reference_number = txn_id
            elif upper_narration.startswith("VPS/PAYMNT RVSL/"):  # before VPS/
                parts = narration_clean.split("/")
                if len(parts) >= 5:
                    ref = parts[4].strip()
                    if ref and re.fullmatch(r'\d{9,}', ref):
                        reference_number = ref + "-RVSL"
            elif upper_narration.startswith(("VPS/", "IPS/")):
                parts = narration_clean.split("/")
                if len(parts) >= 4:
                    ref = parts[3].strip()
                    if ref and re.fullmatch(r'\d{12,}', ref):
                        reference_number = ref

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
