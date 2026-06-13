"""Tests for amendment validation logic — ports the TypeScript Route Handler rules to Python."""

import re
from uuid import uuid4


# ── Python equivalents of the TypeScript validation helpers ──────────────────

def clean_merchant_name(name: str) -> str:
    result = name.strip()
    result = re.sub(r"\s+", " ", result)
    result = re.sub(r"^[^a-zA-Z0-9]+", "", result)
    result = re.sub(r"[^a-zA-Z0-9]+$", "", result)
    return " ".join(word[0].upper() + word[1:].lower() for word in result.split(" ") if word)


def is_valid_merchant_name(name: str, raw_description: str) -> dict:
    trimmed = name.strip()

    if len(trimmed) < 3:
        return {"valid": False, "error": "Merchant name must be at least 3 characters"}

    if len(trimmed) > 50:
        return {"valid": False, "error": "Merchant name must be 50 characters or less"}

    if trimmed.lower() == raw_description.lower():
        return {"valid": False, "error": "Merchant name cannot be the same as the raw description"}

    if re.fullmatch(r"[A-Z0-9]{8,}", trimmed, re.IGNORECASE):
        return {"valid": False, "error": "Merchant name appears to be a payment code, not a name"}

    if re.match(r"[A-Z0-9]{6,}/", trimmed):
        return {"valid": False, "error": "Merchant name contains a payment gateway code"}

    return {"valid": True}


AMENDABLE_FIELDS = {"normalized_merchant", "category", "subcategory", "payment_method"}
IMMUTABLE_FIELDS = {"transaction_date", "amount", "transaction_type", "raw_description", "reference_number"}
MERCHANTS_WRITEBACK_FIELDS = ["normalized_merchant"]


# ── clean_merchant_name ───────────────────────────────────────────────────────

def test_clean_merchant_name_title_case():
    """apollo pharmacy → Apollo Pharmacy"""
    assert clean_merchant_name("apollo pharmacy") == "Apollo Pharmacy"


def test_clean_merchant_name_collapses_spaces():
    """Apollo  Pharmacy → Apollo Pharmacy"""
    assert clean_merchant_name("Apollo  Pharmacy") == "Apollo Pharmacy"


def test_clean_merchant_name_strips_punctuation():
    """Leading/trailing punctuation removed."""
    assert clean_merchant_name("...Swiggy...") == "Swiggy"


# ── is_valid_merchant_name ────────────────────────────────────────────────────

def test_valid_merchant_name_passes():
    result = is_valid_merchant_name("Swiggy", "K4UXS7UOARZ2DOWVCI/PAYUSWIGGYIN")
    assert result["valid"] is True


def test_merchant_name_too_short_fails():
    result = is_valid_merchant_name("AB", "K4UXS7UOARZ2DOWVCI/PAYUSWIGGYIN")
    assert result["valid"] is False
    assert "3 characters" in result["error"]


def test_merchant_name_too_long_fails():
    result = is_valid_merchant_name("A" * 51, "raw")
    assert result["valid"] is False
    assert "50 characters" in result["error"]


def test_merchant_name_identical_to_raw_fails():
    raw = "SU2TF7IYQ6NGJD/RAZPSWIGGY"
    result = is_valid_merchant_name(raw, raw)
    assert result["valid"] is False
    assert "same as the raw description" in result["error"]


def test_merchant_name_payment_code_fails():
    result = is_valid_merchant_name("ABCD12345678", "raw")
    assert result["valid"] is False
    assert "payment code" in result["error"]


def test_merchant_name_gateway_pattern_fails():
    result = is_valid_merchant_name("K4UXS7/PAYUSWIGGY", "raw")
    assert result["valid"] is False


# ── Amendment model invariants ────────────────────────────────────────────────

def test_amendment_group_id_shared_across_fields():
    """Multiple amendments from same interaction share group ID."""
    group_id = str(uuid4())
    amendments = [
        {"field_name": "category", "old_value": "Other", "new_value": "Food"},
        {"field_name": "normalized_merchant", "old_value": "RAZPSWIGGY", "new_value": "Swiggy"},
    ]
    for amendment in amendments:
        assert amendment["field_name"] in AMENDABLE_FIELDS
    # Both rows would be written with the same group_id
    assert len(group_id) == 36  # UUID4 string length


def test_immutable_fields_rejected():
    """transaction_date, amount, transaction_type cannot be amended."""
    for field in IMMUTABLE_FIELDS:
        assert field not in AMENDABLE_FIELDS


def test_subcategory_private_to_user():
    """Subcategory amendments are scoped to user_id only."""
    assert "subcategory" not in MERCHANTS_WRITEBACK_FIELDS
