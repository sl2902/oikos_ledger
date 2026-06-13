# Adapted from statementsparser by Harsh Lalakiya
# https://github.com/iharshlalakiya/statementparser
# MIT License

import re
from dataclasses import dataclass

from .constants import IFSC_BANK_MAPPING, VPA_APP_MAPPING

# HDFC dash-separated UPI format:
# UPI-MERCHANT-VPA-IFSC_REF-UPI_REF-DESCRIPTION
_HDFC_UPI_RE = re.compile(
    r"^UPI-(.+?)-([A-Za-z0-9._\-]+@[A-Za-z0-9]+)-([A-Z0-9]+)-([0-9]+)-(.+)$",
    re.IGNORECASE,
)

# Slash-separated UPI format: UPI/REF/MERCHANT/VPA or UPI/{desc}/{ref}
_SLASH_UPI_RE = re.compile(
    r"UPI/([0-9]+)/(.+?)/([A-Za-z0-9._]+@[A-Za-z0-9]+)",
    re.IGNORECASE,
)

# Generic VPA extraction (anything@anything)
_VPA_RE = re.compile(r"([A-Za-z0-9._\-]+@[A-Za-z0-9]+)", re.IGNORECASE)


@dataclass
class UPITransaction:
    merchant: str | None
    vpa: str | None
    app: str | None
    counterparty_bank: str | None
    upi_ref: str | None


def _resolve_app(vpa: str) -> str | None:
    suffix = vpa.split("@")[-1].lower() if "@" in vpa else ""
    return VPA_APP_MAPPING.get(suffix)


def _resolve_bank(ifsc_ref: str) -> str | None:
    prefix = ifsc_ref[:4].upper()
    return IFSC_BANK_MAPPING.get(prefix)


def _clean_merchant(raw: str) -> str:
    """Title-case and strip merchant name."""
    cleaned = raw.strip()
    # Strip leading numeric codes e.g. "15779 APOLLO PHARMAC" → "APOLLO PHARMAC"
    cleaned = re.sub(r'^\d+\s+', '', cleaned)
    return cleaned.title()


def parse_upi_narration(narration: str) -> UPITransaction:
    """Extract UPI metadata from a bank transaction narration string.

    Handles HDFC dash-separated format and generic slash-separated format.
    Returns a UPITransaction with available fields populated; unknown fields
    are None.
    """
    text = narration.strip()

    # Try HDFC dash format first (most structured)
    m = _HDFC_UPI_RE.match(text)
    if m:
        merchant_raw, vpa, ifsc_ref, upi_ref, _ = m.groups()
        return UPITransaction(
            merchant=_clean_merchant(merchant_raw),
            vpa=vpa,
            app=_resolve_app(vpa),
            counterparty_bank=_resolve_bank(ifsc_ref),
            upi_ref=upi_ref,
        )

    # Try slash format
    m = _SLASH_UPI_RE.search(text)
    if m:
        upi_ref, merchant_raw, vpa = m.groups()
        return UPITransaction(
            merchant=_clean_merchant(merchant_raw),
            vpa=vpa,
            app=_resolve_app(vpa),
            counterparty_bank=None,
            upi_ref=upi_ref,
        )

    # Fallback: extract any VPA present
    m = _VPA_RE.search(text)
    if m:
        vpa = m.group(1)
        return UPITransaction(
            merchant=None,
            vpa=vpa,
            app=_resolve_app(vpa),
            counterparty_bank=None,
            upi_ref=None,
        )

    return UPITransaction(merchant=None, vpa=None, app=None, counterparty_bank=None, upi_ref=None)
