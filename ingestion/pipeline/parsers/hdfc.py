import logging
import re

from .base import BaseCSVParser, NarrationResult, ParsedRow, SkippedRow

log = logging.getLogger(__name__)


class HDFCParser(BaseCSVParser):
    HDFC_BILL_PAY_MAP: dict[str, str] = {
        "HDFCSI": "HDFC Credit Card",
        # Add more as discovered from real statements
    }

    @property
    def bank_name(self) -> str:
        return "HDFC Bank"

    @property
    def bank_code(self) -> str:
        return "HDFC"

    @property
    def column_map(self) -> dict[str, list[str]]:
        return {
            "date": ["date"],
            "narration": ["narration", "description"],
            "debit": ["debit amount", "withdrawal", "debit"],
            "credit": ["credit amount", "deposit", "credit"],
            "reference": ["chq/ref number", "reference", "ref"],
            "balance": ["closing balance", "balance"],
            "value_date": ["value dat", "value date"],
        }

    def normalize_narration(self, narration: str) -> NarrationResult | None:
        """Handle HDFC-specific narration patterns.

        Patterns handled:
        - ACH C-        → Finance / Dividend (inward ACH credit)
        - IB BILLPAY DR → Finance / Credit Card
        """
        upper = narration.upper()

        if upper.startswith("POSDEC"):
            return NarrationResult(
                merchant="POS Decline Charge",
                payment_method="Other",
                category="Finance",
                subcategory=None,
                needs_llm=False,
            )

        if upper.startswith("POS/"):
            # Format: POS/<MERCHANT>/<CITY>/<DATE>/<TIME>
            pos_match = re.match(r'POS/([^/]+)/', narration, re.IGNORECASE)
            if pos_match:
                merchant = pos_match.group(1).strip().title()
                return NarrationResult(
                    merchant=merchant,
                    payment_method="POS",
                    category="Other",
                    subcategory=None,
                    needs_llm=True,
                )

        if upper.startswith("POS ") and re.match(r'POS \d', narration, re.IGNORECASE):
            # Format: POS <CARD> <REF> <DATE> <TIME> <CITY> <MERCHANT>
            # tokens: POS(0) CARD(1) REF(2) DATE(3) TIME(4) CITY(5) MERCHANT(6+)
            parts = narration.split()
            if len(parts) >= 7:
                merchant_raw = " ".join(parts[6:]).strip().title()
                return NarrationResult(
                    merchant=merchant_raw,
                    payment_method="POS",
                    category="Other",
                    subcategory=None,
                    needs_llm=True,
                )

        if upper.startswith("ACH C-"):
            # Format: ACH C- <COMPANY>-<REF>
            ach_match = re.match(
                r'ACH C-\s*([^-]+)-.*$', narration, re.IGNORECASE
            )
            if ach_match:
                merchant = ach_match.group(1).strip().title()
            else:
                merchant = "ACH Credit"

            return NarrationResult(
                merchant=merchant,
                payment_method="Bank Transfer",
                category="Finance",
                subcategory="Dividend",
                needs_llm=False,
            )

        if "IB BILLPAY DR" in upper:
            bill_match = re.match(
                r'IB\s+BILLPAY\s+DR-([^-]+)-', narration, re.IGNORECASE
            )
            if bill_match:
                biller_code = bill_match.group(1).strip().upper()
                merchant = self.HDFC_BILL_PAY_MAP.get(
                    biller_code, biller_code.title()
                )
            else:
                merchant = "Bill Payment"

            return NarrationResult(
                merchant=merchant,
                payment_method="Bill Pay",
                category="Finance",
                subcategory="Credit Card",
                needs_llm=False,
            )
        return None

    def parse_csv(self, file_content: str) -> tuple[list[ParsedRow], list[SkippedRow]]:
        """Override base parse_csv to handle HDFC narrations with embedded commas.

        HDFC exports narrations without quoting even when they contain commas,
        causing column overflow. Re-join split narration fields before parsing.
        Returns (parsed_rows, skipped_rows).
        """
        lines = file_content.strip().splitlines()
        if not lines:
            raise ValueError(f"{self.bank_name} parser: empty file content")

        # Find header line
        header_line = next((l for l in lines if l.strip()), None)
        if not header_line:
            return [], []

        raw_headers = [h.strip() for h in header_line.split(",")]
        expected_cols = len(raw_headers)
        header_map = self.detect_headers(raw_headers)
        if not self.validate_headers(header_map):
            raise ValueError(
                f"{self.bank_name} parser: required columns not found. "
                f"Got: {raw_headers}"
            )

        rows: list[ParsedRow] = []
        skipped: list[SkippedRow] = []

        for i, line in enumerate(lines[1:]):  # skip header
            if not line.strip():
                continue

            parts = line.split(",")
            if len(parts) > expected_cols:
                # Narration contains embedded comma — rejoin middle fields
                tail_count = expected_cols - 2
                date = parts[0]
                tail = parts[-tail_count:]
                narration = ",".join(parts[1:-tail_count])
                parts = [date, narration] + tail

            if len(parts) != expected_cols:
                log.warning(
                    "Skipping malformed row %d: expected %d cols, got %d — %s",
                    i, expected_cols, len(parts), line[:80]
                )
                skipped.append(SkippedRow(
                    row_number=i,
                    date=parts[0].strip() if parts else "",
                    narration=parts[1].strip() if len(parts) > 1 else "",
                    debit="",
                    credit="",
                    reference="",
                    reason="malformed_row",
                ))
                continue

            row = dict(zip(raw_headers, [p.strip() for p in parts]))
            parsed, skip = self._parse_row(row, header_map, i)
            if parsed is None:
                log.debug(
                    "Row %d skipped by _parse_row: %s",
                    i, line[:80]
                )
                if skip is not None:
                    skipped.append(skip)
                continue

            parsed["row_number"] = i
            rows.append(parsed)

        return rows, skipped

    # logic carried into parse_csv()
    def _fix_split_narration(self, row: list[str]) -> list[str]:
        """Re-join narration fields split by embedded commas.

        HDFC exports narrations without quoting even when they contain
        commas. Detect overflow by checking if column count exceeds 7
        and re-join the middle fields as narration.

        Expected columns: Date, Narration, Value Date, Debit, Credit, Ref, Balance
        """
        EXPECTED_COLS = 7
        if len(row) <= EXPECTED_COLS:
            return row

        # Extra columns = narration was split
        # Last 5 columns are always: Value Date, Debit, Credit, Ref, Balance
        date = row[0]
        tail = row[-(EXPECTED_COLS - 2):]  # Value Date, Debit, Credit, Ref, Balance
        narration = ",".join(row[1:-(EXPECTED_COLS - 2)])  # rejoin middle parts
        return [date, narration] + tail
