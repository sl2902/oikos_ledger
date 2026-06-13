# Adapted from statementsparser by Harsh Lalakiya
# https://github.com/iharshlalakiya/statementparser
# MIT License

import csv
import io
from abc import ABC, abstractmethod
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import TypedDict

from ..constants import AMOUNT_STRIP_CHARS, DATE_FORMATS

try:
    from datetime import datetime
except ImportError:
    pass


class ParsedRow(TypedDict):
    transaction_date: date
    raw_description: str
    amount: Decimal
    transaction_type: str  # "debit" | "credit"
    reference_number: str | None
    closing_balance: Decimal | None
    row_number: int  # original CSV row position — preserved for intra-day ordering


class BaseCSVParser(ABC):
    """Abstract base for bank-specific CSV parsers."""

    @property
    @abstractmethod
    def bank_name(self) -> str: ...

    @property
    @abstractmethod
    def bank_code(self) -> str: ...

    @property
    @abstractmethod
    def column_map(self) -> dict[str, list[str]]:
        """Maps canonical field names to possible CSV column header variants.

        Required keys: date, narration, debit, credit
        Optional keys: reference, balance, value_date
        """
        ...

    def parse_csv(self, file_content: str) -> list[ParsedRow]:
        """Parse CSV content into a list of ParsedRow dicts."""
        reader = csv.DictReader(io.StringIO(file_content.strip()))
        if reader.fieldnames is None:
            return []

        raw_headers = list(reader.fieldnames)
        header_map = self.detect_headers(raw_headers)
        if not self.validate_headers(header_map):
            raise ValueError(
                f"{self.bank_name} parser: required columns not found. "
                f"Got: {raw_headers}"
            )

        rows: list[ParsedRow] = []
        for i, row in enumerate(reader):
            parsed = self._parse_row(row, header_map)
            if parsed is not None:
                parsed["row_number"] = i
                rows.append(parsed)
        return rows

    def detect_headers(self, headers: list[str]) -> dict[str, str]:
        """Map CSV headers to canonical field names via substring matching."""
        normalized = [h.lower().strip() for h in headers]
        result: dict[str, str] = {}
        for field, variants in self.column_map.items():
            for variant in variants:
                for idx, header in enumerate(normalized):
                    if variant == header or header == variant:
                        result[field] = headers[idx]
                        break
                if field in result:
                    break
        return result

    def validate_headers(self, detected: dict[str, str]) -> bool:
        """Verify all required fields were detected."""
        return all(k in detected for k in ("date", "narration", "debit", "credit"))

    def parse_date(self, date_str: str) -> date | None:
        """Try each format in DATE_FORMATS[bank_code] then DEFAULT."""
        s = date_str.strip()
        if not s:
            return None
        formats = DATE_FORMATS.get(self.bank_code, []) + DATE_FORMATS["DEFAULT"]
        for fmt in formats:
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
        return None

    def clean_amount(self, amount_str: str) -> Decimal:
        """Clean an amount string to a positive Decimal.

        Handles: leading/trailing whitespace, commas, currency symbols,
        Cr/Dr suffixes, nil/dash placeholders, Indian number formatting.
        """
        s = amount_str.strip()
        if not s or s in ("-", "nil", "NIL", "N/A", "n/a"):
            return Decimal("0")

        # Remove Cr/Dr suffixes (indicates direction, not sign)
        s = s.rstrip("CcRrDd").strip()

        # Strip all amount chars except digits and decimal point
        cleaned = ""
        for ch in s:
            if ch.isdigit() or ch == ".":
                cleaned += ch

        if not cleaned:
            return Decimal("0")
        try:
            return abs(Decimal(cleaned))
        except InvalidOperation:
            return Decimal("0")

    def _parse_row(
        self,
        row: dict[str, str],
        header_map: dict[str, str],
    ) -> ParsedRow | None:
        """Parse a single CSV row into a ParsedRow dict, or None to skip."""
        debit_raw = row.get(header_map.get("debit", ""), "").strip()
        credit_raw = row.get(header_map.get("credit", ""), "").strip()

        debit = self.clean_amount(debit_raw)
        credit = self.clean_amount(credit_raw)

        # Skip summary/blank rows with no amounts
        if debit == Decimal("0") and credit == Decimal("0"):
            return None

        if debit > Decimal("0"):
            amount = debit
            transaction_type = "debit"
        else:
            amount = credit
            transaction_type = "credit"

        date_str = row.get(header_map.get("date", ""), "")
        parsed_date = self.parse_date(date_str)
        if parsed_date is None:
            return None

        narration = row.get(header_map.get("narration", ""), "").strip()
        if not narration:
            return None

        ref_raw = row.get(header_map.get("reference", ""), "").strip()
        reference_number = ref_raw if ref_raw and ref_raw not in ("0", "00000000000") else None

        balance_raw = row.get(header_map.get("balance", ""), "")
        closing_balance = self.clean_amount(balance_raw) if balance_raw.strip() else None

        return ParsedRow(
            transaction_date=parsed_date,
            raw_description=narration,
            amount=amount,
            transaction_type=transaction_type,
            reference_number=reference_number,
            closing_balance=closing_balance,
        )
