"""Tests for deterministic normalization: payment method detection, UPI parsing, categorization,
and the provider-agnostic normalize_batch / get_normalizer_client factory."""

from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ingestion.pipeline.categorizer import categorize_transaction, detect_payment_method
from ingestion.pipeline.normalizer import (
    GeminiNormalizerClient,
    NORMALIZATION_PROMPT,
    NormalizationResult,
    OpenAINormalizerClient,
    _PartialNormalized,
    detect_payment_gateway,
    detect_subcategory,
    get_normalizer_client,
    normalize_batch,
)
from ingestion.pipeline.parsers.base import ParsedRow
from ingestion.pipeline.upi_parser import parse_upi_narration

# ── Payment method detection ──────────────────────────────────────────────────

def test_upi_payment_method_detection():
    assert detect_payment_method("UPI-MERCHANT-VPA@PTY-YESB0X-123-UPI SEND MONEY") == "UPI"


def test_neft_payment_method_detection():
    assert detect_payment_method("NEFT/2026051012345/ACME CORP/SBIN0001234") == "NEFT"


def test_imps_payment_method_detection():
    assert detect_payment_method("IMPS/306012345678/JOHN DOE/HDFC0000001") == "IMPS"


def test_salary_payment_method_detection():
    assert detect_payment_method("SALARY CR-ACMECORP") == "Salary"


def test_atm_payment_method_detection():
    d = detect_payment_method("ATM/05-05/WITHDRAWAL FROM ATM12345")
    assert d == "ATM"


# ── UPI narration parsing ──────────────────────────────────────────────────────

def test_upi_merchant_extraction():
    narration = "UPI-MALNAD HALLI THOTA-PAYTM.S1UZESK@PTY-YESB0MCHUPI-612535829269-UPI SEND MONEY"
    result = parse_upi_narration(narration)
    assert result.merchant == "Malnad Halli Thota"


def test_upi_app_detection_phonePe():
    narration = "UPI-COFFEE SHOP-user123@ybl-HDFC0000001-987654321-UPI"
    result = parse_upi_narration(narration)
    assert result.app == "PhonePe"


def test_upi_app_detection_paytm():
    narration = "UPI-MALNAD HALLI THOTA-PAYTM.S1UZESK@PTY-YESB0MCHUPI-612535829269-UPI"
    result = parse_upi_narration(narration)
    assert result.app == "Paytm"


def test_upi_counterparty_bank_yes_bank():
    narration = "UPI-MALNAD HALLI THOTA-PAYTM.S1UZESK@PTY-YESB0MCHUPI-612535829269-UPI"
    result = parse_upi_narration(narration)
    assert result.counterparty_bank == "Yes Bank"


def test_upi_counterparty_bank_sbi():
    narration = "UPI-MERCHANT-user@oksbi-SBIN0000001-123456789-UPI"
    result = parse_upi_narration(narration)
    assert result.counterparty_bank == "State Bank of India"


def test_upi_non_upi_narration_returns_none_fields():
    result = parse_upi_narration("IB BILLPAY DR-HDFCSI-485498XXXXXX3363")
    assert result.merchant is None
    assert result.vpa is None
    assert result.app is None


# ── Categorization ────────────────────────────────────────────────────────────

def test_category_food_swiggy():
    category = categorize_transaction(
        "K4UXS7UOARZ2DOWVCI/PAYUSWIGGYIN", "Swiggy", "POS"
    )
    assert category == "Food"


def test_category_food_zomato():
    category = categorize_transaction("UPI-ZOMATO-zomato@icici-ICIC000001-123-UPI", "Zomato", "UPI")
    assert category == "Food"


def test_category_salary_detection():
    category = categorize_transaction("SALARY CR-ACMECORP", None, "Salary")
    assert category == "Salary"


def test_category_salary_via_payment_method():
    # Payment method "Salary" short-circuits categorization
    category = categorize_transaction("SOME UNKNOWN TEXT", None, "Salary")
    assert category == "Salary"


def test_category_emi_via_payment_method():
    category = categorize_transaction("EMI PAYMENT FOR LOAN", None, "EMI")
    assert category == "Finance"


def test_category_fallback_other():
    category = categorize_transaction("XYZABCDEF12345UNKNOWNMERCHANT", None, "Transfer")
    assert category == "Other"


def test_category_amazon_shopping():
    category = categorize_transaction("AMAZON INDIA PURCHASE", "Amazon", "POS")
    assert category == "Shopping"


# ── normalize_batch with mock NormalizerClient ────────────────────────────────

def _unknown_row() -> ParsedRow:
    return ParsedRow(
        transaction_date=date(2026, 5, 1),
        raw_description="XYZABCDEF12345UNKNOWNMERCHANT",
        amount=Decimal("100.00"),
        transaction_type="debit",
        reference_number=None,
        closing_balance=None,
    )


def _zomato_row() -> ParsedRow:
    return ParsedRow(
        transaction_date=date(2026, 5, 18),
        raw_description="UPI-ZOMATO-zomato@icici-ICIC0000123-555666777-UPI",
        amount=Decimal("245.00"),
        transaction_type="debit",
        reference_number="555666777",
        closing_balance=Decimal("1000.00"),
    )


@pytest.mark.asyncio
async def test_normalize_batch_calls_llm_for_unknown():
    mock_normalize = AsyncMock(return_value=NormalizationResult(
        merchant_name="Test Merchant",
        category="Shopping",
        subcategory=None,
    ))
    mock_client = MagicMock()
    mock_client.normalize = mock_normalize

    results = await normalize_batch([_unknown_row()], mock_client)

    mock_normalize.assert_called_once()
    assert results[0]["normalized_merchant"] == "Test Merchant"
    assert results[0]["category"] == "Shopping"
    assert results[0]["transaction_type"] == "debit"


@pytest.mark.asyncio
async def test_normalize_batch_skips_llm_for_known_merchant():
    mock_normalize = AsyncMock()
    mock_client = MagicMock()
    mock_client.normalize = mock_normalize

    results = await normalize_batch([_zomato_row()], mock_client)

    mock_normalize.assert_not_called()
    assert results[0]["category"] == "Food"
    assert results[0]["normalized_merchant"] == "Zomato"


@pytest.mark.asyncio
async def test_normalize_batch_mixed_rows():
    mock_normalize = AsyncMock(return_value=NormalizationResult(
        merchant_name="Unknown Merchant",
        category="Other",
        subcategory=None,
    ))
    mock_client = MagicMock()
    mock_client.normalize = mock_normalize

    results = await normalize_batch([_zomato_row(), _unknown_row()], mock_client)

    # Only the unknown row triggers LLM; Zomato row uses deterministic path
    mock_normalize.assert_called_once()
    assert results[0]["category"] == "Food"       # Zomato — deterministic
    assert results[1]["category"] == "Other"      # unknown — LLM


# ── get_normalizer_client factory ─────────────────────────────────────────────

def test_get_normalizer_client_openai():
    mock_s = MagicMock()
    mock_s.normalizer_provider = "openai"
    mock_s.normalizer_model = "gpt-4o-mini"
    mock_s.openai_api_key = "sk-test"
    with patch("ingestion.pipeline.normalizer.settings", mock_s):
        client = get_normalizer_client()
    assert isinstance(client, OpenAINormalizerClient)


def test_get_normalizer_client_gemini():
    mock_s = MagicMock()
    mock_s.normalizer_provider = "gemini"
    mock_s.normalizer_model = "gemini-1.5-flash"
    with patch("ingestion.pipeline.normalizer.settings", mock_s):
        client = get_normalizer_client()
    assert isinstance(client, GeminiNormalizerClient)


def test_get_normalizer_client_invalid():
    mock_s = MagicMock()
    mock_s.normalizer_provider = "anthropic"
    with patch("ingestion.pipeline.normalizer.settings", mock_s):
        with pytest.raises(ValueError, match="Unsupported normalizer provider"):
            get_normalizer_client()


# ── Payment gateway detection ─────────────────────────────────────────────────

def test_gateway_razorpay_swiggy():
    """SU2TF7IYQ6NGJD/RAZPSWIGGY → gateway=Razorpay, merchant=Swiggy"""
    gateway, merchant = detect_payment_gateway("SU2TF7IYQ6NGJD/RAZPSWIGGY")
    assert gateway == "Razorpay"
    assert merchant == "Swiggy"


def test_gateway_payu_swiggy():
    """K4UXS7UOARZ2DOWVCI/PAYUSWIGGYIN → gateway=PayU, merchant=Swiggy"""
    gateway, merchant = detect_payment_gateway("K4UXS7UOARZ2DOWVCI/PAYUSWIGGYIN")
    assert gateway == "PayU"
    assert merchant == "Swiggy"


def test_gateway_mixed_case():
    """Sk8Rv8NkPxMq43/RazPsWiggy → gateway=Razorpay, merchant=Swiggy"""
    gateway, merchant = detect_payment_gateway("Sk8Rv8NkPxMq43/RazPsWiggy")
    assert gateway == "Razorpay"
    assert merchant == "Swiggy"


def test_gateway_no_match_returns_none():
    """Standard UPI narration should not match gateway pattern."""
    gateway, merchant = detect_payment_gateway(
        "UPI-MALNAD HALLI THOTA-PAYTM.S1UZESK@PTY-YESB0MCHUPI-612535829269-UPI SEND MONEY"
    )
    assert gateway is None
    assert merchant is None


# ── Slash delimiter variants ──────────────────────────────────────────────────

def test_atm_slash_delimiter():
    """ATM/20260520/WITHDRAWAL → PaymentMethod ATM"""
    method = detect_payment_method("ATM/20260520/WITHDRAWAL")
    assert method == "ATM"


def test_neft_slash_delimiter():
    """NEFT/20260515123456/JOHN DOE/SBIN0000001 → PaymentMethod NEFT"""
    method = detect_payment_method("NEFT/20260515123456/JOHN DOE/SBIN0000001")
    assert method == "NEFT"


# ── Conservative LLM prompt ───────────────────────────────────────────────────

def test_no_llm_expansion():
    """LLM prompt must not expand abbreviations or guess truncated names."""
    assert "Do NOT expand abbreviations" in NORMALIZATION_PROMPT
    assert "Do NOT guess the full name" in NORMALIZATION_PROMPT


# ── detect_subcategory ────────────────────────────────────────────────────────

def test_detect_subcategory_swiggy():
    subcategory, cat = detect_subcategory("Swiggy", "K4UXS7/PAYUSWIGGYIN")
    assert subcategory == "Food Delivery"
    assert cat == "Food"


def test_detect_subcategory_apollo():
    subcategory, cat = detect_subcategory("Apollo Pharmac", "UPI-APOLLO PHARMAC")
    assert subcategory == "Pharmacy"
    assert cat == "Medical"


def test_detect_subcategory_bescom():
    subcategory, cat = detect_subcategory("Bescom", "BESCOM ELECTRICITY")
    assert subcategory == "Electricity"
    assert cat == "Utilities"


def test_detect_subcategory_none():
    subcategory, cat = detect_subcategory("Unknown Merchant", "RANDOM NARRATION")
    assert subcategory is None
    assert cat is None


def test_merchant_registry_lookup_uses_extracted_name():
    """Registry lookup uses extracted merchant name not raw narration."""
    partial = _PartialNormalized(
        transaction_date=date(2026, 5, 1),
        raw_description="UPI-APOLLO PHARMACY-GPAY@HDFC-HDFC0000001-123456789-UPI",
        amount=Decimal("250.00"),
        transaction_type="debit",
        reference_number="123456789",
        closing_balance=None,
        payment_method="UPI",
        upi_merchant="Apollo Pharmacy",
        upi_app="Google Pay",
        upi_vpa="GPAY@HDFC",
        upi_ref="123456789",
        upi_counterparty_bank="HDFC Bank",
        merchant="Apollo Pharmacy",
        category="Medical",
        subcategory=None,
        needs_llm=False,
        gateway=None,
    )
    assert partial["merchant"] == "Apollo Pharmacy"
    assert partial["raw_description"] != partial["merchant"]
