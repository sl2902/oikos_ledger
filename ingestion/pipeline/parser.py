"""Router that selects the correct bank CSV parser and includes fallback header detection."""

import csv
import io
import logging

from .constants import BANK_HEADER_SIGNATURES
from .parsers.axis import AxisParser
from .parsers.base import BaseCSVParser, ParsedRow, SkippedRow
from .parsers.hdfc import HDFCParser
from .parsers.icici import ICICIParser
from .parsers.sbi import SBIParser

log = logging.getLogger(__name__)

PARSER_REGISTRY: dict[str, BaseCSVParser] = {
    "HDFC Bank": HDFCParser(),
    "State Bank of India": SBIParser(),
    "ICICI Bank": ICICIParser(),
    "Axis Bank": AxisParser(),
}


class UnsupportedBankError(Exception):
    pass


def get_parser(bank_name: str) -> BaseCSVParser:
    """Get parser for bank_name. Raises UnsupportedBankError if unsupported."""
    parser = PARSER_REGISTRY.get(bank_name)
    if parser is None:
        raise UnsupportedBankError(
            f"No parser registered for '{bank_name}'. "
            f"Supported banks: {list(PARSER_REGISTRY)}"
        )
    return parser


def detect_bank_from_content(file_content: str) -> str | None:
    """Fallback: detect bank from CSV headers using BANK_HEADER_SIGNATURES.

    Normalises headers to lowercase stripped strings before matching.
    Returns bank name string, or None if no signature matches.
    """
    try:
        reader = csv.DictReader(io.StringIO(file_content.strip()))
        if reader.fieldnames is None:
            return None
        headers = {h.lower().strip() for h in reader.fieldnames}
    except Exception:
        return None

    for bank_name, signature in BANK_HEADER_SIGNATURES.items():
        if signature.issubset(headers):
            return bank_name
    return None


def parse_csv(
    bank_name: str,
    file_content: str,
) -> tuple[list[ParsedRow], list[SkippedRow], BaseCSVParser]:
    """Route CSV content to the correct parser. Returns (parsed_rows, skipped_rows, parser).

    Steps:
    1. Look up primary parser via bank_name.
    2. Attempt to parse. If header validation fails, try detect_bank_from_content().
    3. If fallback bank differs from primary, log a warning.
    4. Raise UnsupportedBankError if no suitable parser is found.
    """
    try:
        parser = get_parser(bank_name)
    except UnsupportedBankError:
        parser = None

    if parser is not None:
        log.info("Parser selected", extra={
            "bank_name": bank_name,
            "parser": parser.__class__.__name__,
        })
        try:
            rows, skipped = parser.parse_csv(file_content)
            _log_parse_complete(bank_name, rows, skipped)
            return rows, skipped, parser
        except ValueError as e:
            log.warning("Primary parser header mismatch", extra={
                "expected_bank": bank_name,
                "detected_bank": None,
                "headers": _csv_headers(file_content),
            })
            log.warning("Primary parser failed (%s): %s — attempting fallback detection", bank_name, e)

    # Fallback: detect from headers
    detected_bank = detect_bank_from_content(file_content)
    if detected_bank:
        log.info("Headers detected", extra={
            "bank_name": detected_bank,
            "detected_headers": list(BANK_HEADER_SIGNATURES.get(detected_bank, set())),
            "csv_headers": _csv_headers(file_content),
        })
    if detected_bank and detected_bank != bank_name:
        log.warning("Primary parser header mismatch", extra={
            "expected_bank": bank_name,
            "detected_bank": detected_bank,
            "headers": _csv_headers(file_content),
        })

    if detected_bank:
        fallback_parser = get_parser(detected_bank)
        rows, skipped = fallback_parser.parse_csv(file_content)
        _log_parse_complete(detected_bank, rows, skipped)
        return rows, skipped, fallback_parser

    raise UnsupportedBankError(
        f"Could not find a parser for '{bank_name}' and header detection found no match."
    )


def _csv_headers(file_content: str) -> list[str]:
    """Return up to 10 CSV column headers from file_content."""
    try:
        reader = csv.DictReader(io.StringIO(file_content.strip()))
        return list(reader.fieldnames or [])[:10]
    except Exception:
        return []


def _log_parse_complete(
    bank_name: str, rows: list[ParsedRow], skipped: list[SkippedRow]
) -> None:
    log.info("Parse complete", extra={
        "bank_name": bank_name,
        "parsed_rows": len(rows),
        "skipped_rows": len(skipped),
        "skip_reasons": [s["reason"] for s in skipped] if skipped else [],
    })
