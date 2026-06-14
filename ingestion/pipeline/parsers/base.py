# Adapted from statementsparser by Harsh Lalakiya
# https://github.com/iharshlalakiya/statementparser
# MIT License

import csv
import io
import logging
import re
from abc import ABC, abstractmethod
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal, TypedDict

from ..constants import AMOUNT_STRIP_CHARS, DATE_FORMATS

try:
    from datetime import datetime
except ImportError:
    pass

log = logging.getLogger(__name__)


class ParsedRow(TypedDict):
    transaction_date: date
    raw_description: str
    amount: Decimal
    transaction_type: str  # "debit" | "credit"
    reference_number: str | None
    closing_balance: Decimal | None
    row_number: int  # original CSV row position — preserved for intra-day ordering


class SkippedRow(TypedDict):
    row_number: int
    date: str
    narration: str
    debit: str
    credit: str
    reference: str
    reason: Literal[
        "zero_amount",
        "invalid_date",
        "missing_narration",
        "malformed_row",
    ]


class NarrationResult(TypedDict):
    merchant: str
    payment_method: str
    category: str
    subcategory: str | None
    needs_llm: bool


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

    def normalize_narration(self, narration: str) -> "NarrationResult | None":
        """Bank-specific narration code detection.

        Override in subclasses to handle bank-specific narration
        formats before common detection runs.
        Return None to fall through to common detection.
        """
        return None

    def parse_csv(self, file_content: str) -> tuple[list[ParsedRow], list[SkippedRow]]:
        """Parse CSV content. Returns (parsed_rows, skipped_rows)."""
        reader = csv.DictReader(io.StringIO(file_content.strip()))
        if reader.fieldnames is None:
            return [], []

        raw_headers = list(reader.fieldnames)
        header_map = self.detect_headers(raw_headers)
        if not self.validate_headers(header_map):
            raise ValueError(
                f"{self.bank_name} parser: required columns not found. "
                f"Got: {raw_headers}"
            )

        rows: list[ParsedRow] = []
        skipped: list[SkippedRow] = []

        for i, row in enumerate(reader):
            parsed, skip = self._parse_row(row, header_map, i)
            if parsed is not None:
                parsed["row_number"] = i
                rows.append(parsed)
            elif skip is not None:
                skipped.append(skip)

        return rows, skipped

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
        row_number: int,
    ) -> tuple[ParsedRow, None] | tuple[None, SkippedRow]:
        """Parse a single CSV row. Returns (ParsedRow, None) or (None, SkippedRow)."""
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
            log.debug("Row skipped — zero debit and credit: %s", raw_narration[:60])
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

        reference_number = (
            ref_raw
            if ref_raw and not re.fullmatch(r'0+', ref_raw)
            else None
        )

        balance_raw = row.get(header_map.get("balance", ""), "")
        closing_balance = (
            self.clean_amount(balance_raw)
            if balance_raw.strip()
            else None
        )

        return ParsedRow(
            transaction_date=parsed_date,
            raw_description=raw_narration,
            amount=amount,
            transaction_type=transaction_type,
            reference_number=reference_number,
            closing_balance=closing_balance,
        ), None
