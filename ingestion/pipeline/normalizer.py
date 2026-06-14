"""Two-stage normalization: deterministic keyword/UPI matching, then LLM for unknowns."""

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Protocol, TypedDict

import openai
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import select

from ingestion.config import settings
from ingestion.db.client import get_session
from ingestion.models.transactions import Merchant
from ingestion.pipeline.constants import (
    PAYMENT_GATEWAY_PREFIXES,
    SUBCATEGORY_CATEGORY_MAP,
    SUBCATEGORY_KEYWORDS,
)
from .categorizer import categorize_transaction, detect_payment_method
from .parsers.base import BaseCSVParser, ParsedRow
from .upi_parser import parse_upi_narration

log = logging.getLogger(__name__)

# Conservative prompt: fix capitalisation only, no expansion of abbreviations or
# partial names. Escaped braces so .format(narration=...) only substitutes {narration}.
NORMALIZATION_PROMPT = """You are a bank transaction normalizer.
Clean the merchant name from this bank narration string.

Rules:
- Fix capitalization only (title case)
- Remove payment codes, reference numbers, and bank codes
- Do NOT expand abbreviations or correct partial names
- Do NOT guess the full name if it is truncated
- Return the merchant name exactly as it appears, just cleaned

Category must be exactly one of:
Food, Shopping, Groceries, Transport, Fuel, Rent, EMI,
Salary, Investment, Insurance, Utilities, Recharge,
Entertainment, Medical, Education, Transfer, ATM Withdrawal,
Interest, Charges, Government, Other

Subcategory must be exactly one of these per category,
or null if none apply:
- Food: Food Delivery, Dining Out, Cafe, Bakery
- Groceries: Supermarket, Local Market, Online Grocery
- Transport: Ride Share, Public Transport, Parking, Toll
- Fuel: Petrol, Diesel
- Medical: Pharmacy, Doctor, Hospital, Lab, Insurance
- Utilities: Electricity, Water, Gas, Internet
- Recharge: Mobile Recharge, DTH
- Entertainment: Streaming, Movies, Gaming, Events
- Shopping: Online Shopping, Clothing, Electronics,
            Home, Personal Care
- EMI: Home Loan, Car Loan, Personal Loan, Education Loan
- Investment: Mutual Fund, Stocks, Fixed Deposit
- Charges: Credit Card, Bank Charges, Tax

Narration: {narration}

Respond with JSON only, no other text:
{{
  "merchant_name": "...",
  "category": "...",
  "subcategory": "..." or null
}}"""

# Compiled once at module load — matches {6+ alphanum}/{3-8 letters}{1+ alphanum}
# _GATEWAY_RE = re.compile(r"^[A-Za-z0-9]{6,}/([A-Za-z]{3,8})([A-Za-z0-9]+)$")

# Build regex from known prefixes — longest first to avoid partial matches
_GATEWAY_PREFIXES_SORTED = sorted(PAYMENT_GATEWAY_PREFIXES.keys(), key=len, reverse=True)
_PREFIX_PATTERN = "|".join(_GATEWAY_PREFIXES_SORTED)
_GATEWAY_RE = re.compile(
    rf"^[A-Za-z0-9]{{6,}}/({_PREFIX_PATTERN})([A-Za-z0-9]+)$",
    re.IGNORECASE
)


def detect_subcategory(
    merchant: str | None,
    narration: str,
) -> tuple[str | None, str | None]:
    """Detect subcategory and optionally override category
    using deterministic keyword matching.

    Checks merchant name first, then falls back to narration.
    Returns (subcategory, category_override) where
    category_override is None if category should not change.
    """
    search_text = ""
    if merchant:
        search_text += merchant.lower()
    search_text += " " + narration.lower()

    for subcategory, keywords in SUBCATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword.lower() in search_text:
                category_override = SUBCATEGORY_CATEGORY_MAP.get(subcategory)
                return subcategory, category_override

    return None, None


class NormalizationResult(TypedDict):
    merchant_name: str
    category: str
    subcategory: str | None


class NormalizerClient(Protocol):
    async def normalize(self, narration: str) -> NormalizationResult:
        """Normalize a single transaction narration."""
        ...


class OpenAINormalizerClient:
    def __init__(self, client: openai.AsyncOpenAI, model: str) -> None:
        self._client = client
        self._model = model

    async def normalize(self, narration: str) -> NormalizationResult:
        prompt = NORMALIZATION_PROMPT.format(narration=narration)
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                max_tokens=200,
                temperature=0,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.choices[0].message.content or ""
            return _parse_llm_response(text, narration)
        except Exception as exc:
            log.warning("OpenAI normalization failed for '%s': %s", narration[:60], exc)
            return _fallback_result(narration)


class GeminiNormalizerClient:
    def __init__(self, model: str) -> None:
        self._model_name = model

    async def normalize(self, narration: str) -> NormalizationResult:
        import google.generativeai as genai  # lazy — only imported when Gemini is active
        prompt = NORMALIZATION_PROMPT.format(narration=narration)
        try:
            model = genai.GenerativeModel(self._model_name)
            response = await model.generate_content_async(prompt)
            text = response.text or ""
            return _parse_llm_response(text, narration)
        except Exception as exc:
            log.warning("Gemini normalization failed for '%s': %s", narration[:60], exc)
            return _fallback_result(narration)


def _parse_llm_response(text: str, narration: str) -> NormalizationResult:
    """Extract JSON from LLM text. Returns fallback on malformed output."""
    try:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start == -1 or end == 0:
            return _fallback_result(narration)
        data = json.loads(text[start:end])
        return NormalizationResult(
            merchant_name=str(data.get("merchant_name") or narration)[:50],
            category=str(data.get("category") or "Other"),
            subcategory=data.get("subcategory"),
        )
    except Exception:
        return _fallback_result(narration)


def _fallback_result(narration: str) -> NormalizationResult:
    return NormalizationResult(
        merchant_name=narration[:50],
        category="Other",
        subcategory=None,
    )


def detect_payment_gateway(narration: str) -> tuple[str | None, str | None]:
    """Detect payment gateway pattern and extract merchant name.

    Handles format: {ALPHANUM_CODE}/{GATEWAY_PREFIX}{MERCHANT}
    Example: K4UXS7UOARZ2DOWVCI/PAYUSWIGGYIN → gateway=PayU, merchant=Swiggy

    Returns:
        (gateway_name, merchant_name) or (None, None) if not a gateway pattern.
    """
    match = _GATEWAY_RE.match(narration.strip())
    if not match:
        return None, None

    prefix = match.group(1).upper()
    merchant_raw = match.group(2)

    gateway = None
    for gw_prefix, gw_name in PAYMENT_GATEWAY_PREFIXES.items():
        if prefix.startswith(gw_prefix):
            gateway = gw_name
            break

    if gateway is None:
        return None, None

    # Strip residual gateway prefix text that bled into merchant_raw
    for gw_prefix in PAYMENT_GATEWAY_PREFIXES:
        if merchant_raw.upper().startswith(gw_prefix):
            merchant_raw = merchant_raw[len(gw_prefix):]
            break

    # Strip app names that sometimes bleed into merchant position
    _APP_PREFIXES = ["PAYTM", "GPAY", "PHONEPE", "BHIM"]
    for app in _APP_PREFIXES:
        if merchant_raw.upper().startswith(app):
            merchant_raw = merchant_raw[len(app):]
            break

    # Strip trailing IN / IND / COM country suffixes added by gateways
    # Exception for BESCOM
    if 'BESCOM' not in merchant_raw:
        merchant = re.sub(r"(COM|CO|IN|IND)$", "", merchant_raw, flags=re.IGNORECASE).strip().title()
    else:
        merchant = re.sub(r"(IN|IND)$", "", merchant_raw, flags=re.IGNORECASE).strip().title()
    return gateway, merchant if merchant else None


def get_normalizer_client() -> NormalizerClient:
    """Return the configured normalizer client based on settings.normalizer_provider.

    Raises ValueError for unsupported providers.
    """
    if settings.normalizer_provider == "openai":
        return OpenAINormalizerClient(
            client=openai.AsyncOpenAI(api_key=settings.openai_api_key),
            model=settings.normalizer_model,
        )
    elif settings.normalizer_provider == "gemini":
        return GeminiNormalizerClient(model=settings.normalizer_model)
    else:
        raise ValueError(
            f"Unsupported normalizer provider: {settings.normalizer_provider}. "
            f"Supported providers: openai, gemini"
        )


class NormalizedTransaction(TypedDict):
    transaction_date: object  # date
    raw_description: str
    normalized_merchant: str
    amount: Decimal
    transaction_type: str  # "debit" | "credit"
    category: str
    subcategory: str | None
    payment_method: str
    reference_number: str | None
    closing_balance: Decimal | None
    row_number: int | None
    upi_merchant: str | None
    upi_app: str | None
    upi_vpa: str | None
    upi_ref: str | None
    upi_counterparty_bank: str | None


class _PartialNormalized(TypedDict):
    transaction_date: object
    raw_description: str
    amount: Decimal
    transaction_type: str
    reference_number: str | None
    closing_balance: Decimal | None
    row_number: int | None
    payment_method: str
    upi_merchant: str | None
    upi_app: str | None
    upi_vpa: str | None
    upi_ref: str | None
    upi_counterparty_bank: str | None
    merchant: str | None
    category: str
    subcategory: str | None
    needs_llm: bool
    gateway: str | None


def normalize_deterministic(
    row: ParsedRow,
    parser: BaseCSVParser | None = None,
) -> _PartialNormalized:
    """Apply all deterministic normalization steps to a parsed row."""
    narration = row["raw_description"]

    # Step 1: Bank-specific narration detection
    if parser:
        bank_result = parser.normalize_narration(narration)
        if bank_result:
            log.debug("Bank-specific narration match", extra={
                "raw": narration[:60],
                "merchant": bank_result["merchant"],
                "payment_method": bank_result["payment_method"],
                "category": bank_result["category"],
            })
            return _PartialNormalized(
                transaction_date=row["transaction_date"],
                raw_description=narration,
                amount=row["amount"],
                transaction_type=row["transaction_type"],
                reference_number=row.get("reference_number"),
                closing_balance=row.get("closing_balance"),
                row_number=row.get("row_number"),
                payment_method=bank_result["payment_method"],
                upi_merchant=None,
                upi_app=None,
                upi_vpa=None,
                upi_ref=None,
                upi_counterparty_bank=None,
                merchant=bank_result["merchant"],
                category=bank_result["category"],
                subcategory=bank_result["subcategory"],
                needs_llm=bank_result["needs_llm"],
                gateway=None,
            )

    # Step 2: payment gateway pattern takes priority — these are not UPI transactions
    gateway, gateway_merchant = detect_payment_gateway(narration)
    if gateway:
        category = categorize_transaction(narration, gateway_merchant, "Other")
        subcategory, cat_override = detect_subcategory(gateway_merchant, narration)
        if cat_override:
            category = cat_override
        partial = _PartialNormalized(
            transaction_date=row["transaction_date"],
            raw_description=narration,
            amount=row["amount"],
            transaction_type=row["transaction_type"],
            reference_number=row["reference_number"],
            closing_balance=row.get("closing_balance"),
            row_number=row.get("row_number"),
            payment_method="Other",
            upi_merchant=None,
            upi_app=None,
            upi_vpa=None,
            upi_ref=None,
            upi_counterparty_bank=None,
            merchant=gateway_merchant,
            category=category,
            subcategory=subcategory,
            needs_llm=gateway_merchant is None,
            gateway=gateway,
        )
        log.debug("Deterministic normalization", extra={
            "raw": narration[:60],
            "gateway_detected": gateway,
            "gateway_merchant": gateway_merchant,
            "payment_method": "Other",
            "upi_merchant": None,
            "upi_app": None,
            "category": category,
            "subcategory": subcategory,
            "needs_llm": gateway_merchant is None,
        })
        return partial

    # Step 2: standard payment method + UPI parsing
    payment_method = detect_payment_method(narration)

    upi_merchant = upi_app = upi_vpa = upi_ref = upi_bank = None

    if payment_method == "UPI":
        upi = parse_upi_narration(narration)
        upi_merchant = upi.merchant
        upi_app = upi.app
        upi_vpa = upi.vpa
        upi_ref = upi.upi_ref
        upi_bank = upi.counterparty_bank

    merchant = upi_merchant  # best guess before LLM
    category = categorize_transaction(narration, merchant, payment_method)
    subcategory, cat_override = detect_subcategory(merchant, narration)
    if cat_override:
        category = cat_override
    needs_llm = category == "Other" or merchant is None

    log.debug("Deterministic normalization", extra={
        "raw": narration[:60],
        "gateway_detected": None,
        "gateway_merchant": None,
        "payment_method": payment_method,
        "upi_merchant": upi_merchant,
        "upi_app": upi_app,
        "category": category,
        "subcategory": subcategory,
        "needs_llm": needs_llm,
    })

    return _PartialNormalized(
        transaction_date=row["transaction_date"],
        raw_description=narration,
        amount=row["amount"],
        transaction_type=row["transaction_type"],
        reference_number=row["reference_number"],
        closing_balance=row.get("closing_balance"),
        row_number=row.get("row_number"),
        payment_method=payment_method,
        upi_merchant=upi_merchant,
        upi_app=upi_app,
        upi_vpa=upi_vpa,
        upi_ref=upi_ref,
        upi_counterparty_bank=upi_bank,
        merchant=merchant,
        category=category,
        subcategory=subcategory,
        needs_llm=needs_llm,
        gateway=None,
    )


async def normalize_with_llm(
    partial: _PartialNormalized,
    client: NormalizerClient,
) -> NormalizedTransaction:
    """Normalize via merchant registry first, LLM second.

    1. Check merchants table for case-insensitive match on extracted merchant name.
    2. Cache hit  → return stored canonical_name and category (no LLM call).
    3. Cache miss → call LLM, upsert result into merchants table.
    """
    raw = partial["raw_description"]
    extracted_merchant = partial["merchant"]

    # Step 1: merchant registry lookup by extracted merchant name
    if extracted_merchant:
        try:
            with get_session() as reg_session:
                existing = reg_session.exec(
                    select(Merchant).where(
                        func.lower(Merchant.canonical_name).contains(
                            extracted_merchant.strip().lower()[:20]
                        )
                    )
                ).first()
                if existing:
                    log.info("Merchant registry hit", extra={
                        "extracted_merchant": extracted_merchant[:40],
                        "canonical_name": existing.canonical_name,
                        "category": existing.category,
                        "subcategory": existing.subcategory,
                    })
                    subcategory, cat_override = detect_subcategory(
                        existing.canonical_name, raw
                    )
                    return _build_normalized(
                        partial,
                        existing.canonical_name,
                        cat_override or existing.category,
                        subcategory or existing.subcategory,
                    )
        except Exception as exc:
            log.debug("Merchant registry lookup skipped: %s", exc)

    # Step 2: LLM normalization
    log.info("LLM normalization", extra={
        "raw": raw[:60],
        "provider": settings.normalizer_provider,
        "model": settings.normalizer_model,
    })
    try:
        result = await client.normalize(raw)

        # Always run deterministic categorization to override LLM when it returns Other
        det_subcategory, det_category = detect_subcategory(result["merchant_name"], raw)
        det_cat_result = categorize_transaction(
            raw, 
            result["merchant_name"], 
            partial["payment_method"]  # use detected payment method, not LLM result
        )

        final_category = result["category"]
        final_subcategory = result["subcategory"]

        # Override LLM category if deterministic finds something better
        if det_cat_result != "Other":
            final_category = det_cat_result
        if det_category:
            final_category = det_category
        if det_subcategory:
            final_subcategory = det_subcategory

        log.info("LLM result", extra={
            "raw": raw[:60],
            "merchant_name": result["merchant_name"],
            "category": result["category"],
            "subcategory": result["subcategory"],
        })
    except Exception as exc:
        log.warning("LLM normalization failed", extra={
            "raw": raw[:60],
            "error": str(exc),
            "fallback_merchant": raw[:50],
        })
        result = _fallback_result(raw)

    # # Step 3: detect subcategory deterministically
    # subcategory, cat_override = detect_subcategory(result["merchant_name"], raw)
    # final_category = cat_override or result["category"]
    # final_subcategory = subcategory or result["subcategory"]

    # Step 3: upsert into merchant registry — zero-vector placeholder for embedding;
    # the embedder step can update merchant embeddings in a separate pass.
    try:
        with get_session() as reg_session:
            stmt = (
                pg_insert(Merchant)
                .values(
                    id=uuid.uuid4(),
                    canonical_name=result["merchant_name"],
                    category=final_category,
                    subcategory=final_subcategory,
                    embedding=[0.0] * 1536,
                )
                .on_conflict_do_update(
                    constraint="uq_merchants_canonical_name",
                    set_={
                        "category": final_category,
                        "subcategory": final_subcategory,
                        "updated_at": datetime.now(timezone.utc),
                    },
                )
            )
            reg_session.execute(stmt)
            log.debug("Merchant registry upsert", extra={
                "canonical_name": result["merchant_name"],
                "category": final_category,
                "subcategory": final_subcategory,
            })
    except Exception as exc:
        # log.warning("Merchant registry upsert failed", extra={
        #     "canonical_name": result["merchant_name"],
        #     "error": str(exc),
        # })
        log.warning(
            "Merchant registry upsert failed: %s — merchant: %s",
            str(exc),
            result["merchant_name"],
        )

    return _build_normalized(partial, result["merchant_name"], final_category, final_subcategory)


def _build_normalized(
    partial: _PartialNormalized,
    merchant_name: str,
    category: str,
    subcategory: str | None,
) -> NormalizedTransaction:
    return NormalizedTransaction(
        transaction_date=partial["transaction_date"],
        raw_description=partial["raw_description"],
        normalized_merchant=merchant_name,
        amount=partial["amount"],
        transaction_type=partial["transaction_type"],
        category=category,
        subcategory=subcategory,
        payment_method=partial["payment_method"],
        reference_number=partial["reference_number"],
        closing_balance=partial["closing_balance"],
        row_number=partial.get("row_number"),
        upi_merchant=partial["upi_merchant"],
        upi_app=partial["upi_app"],
        upi_vpa=partial["upi_vpa"],
        upi_ref=partial["upi_ref"],
        upi_counterparty_bank=partial["upi_counterparty_bank"],
    )


def _partial_to_normalized(partial: _PartialNormalized) -> NormalizedTransaction:
    """Convert a deterministic partial to a final NormalizedTransaction (no LLM)."""
    merchant = partial["merchant"] or partial["raw_description"][:50]
    return _build_normalized(partial, merchant, partial["category"], partial["subcategory"])


async def normalize_batch(
    rows: list[ParsedRow],
    client: NormalizerClient,
    parser: BaseCSVParser | None = None,
) -> list[NormalizedTransaction]:
    """Normalize a batch of parsed rows using deterministic matching then LLM.

    LLM calls run concurrently up to settings.normalizer_max_concurrency.
    """
    partials = [normalize_deterministic(row, parser) for row in rows]

    sem = asyncio.Semaphore(settings.normalizer_max_concurrency)

    async def _normalize_one(partial: _PartialNormalized) -> NormalizedTransaction:
        if not partial["needs_llm"]:
            return _partial_to_normalized(partial)
        async with sem:
            return await normalize_with_llm(partial, client)

    results = await asyncio.gather(*[_normalize_one(p) for p in partials])
    return list(results)
