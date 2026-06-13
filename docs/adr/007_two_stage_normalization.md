# ADR 007 — Two-Stage Normalization: Deterministic First, LLM Second

**Date:** 2026-06-10
**Status:** Accepted

---

## Context

Every transaction requires two enrichments before it can be stored:
1. A normalized merchant name (e.g. "MALNAD HALLI THOTA" → "Malnad Halli Thota" or "Swiggy")
2. A spending category (Food, Transport, Housing, etc.)

The ingestion pipeline processes batches of parsed transactions. A strategy was needed for how to produce these enrichments.

---

## Options Considered

### Option A — LLM-first: send every transaction to Claude

Pass the raw narration string to Claude for every transaction and ask it to return merchant name and category.

**Rejected because:**
- Expensive at scale: a user with 500 transactions per month pays LLM cost per transaction, not per unknown
- Slow: LLM latency (~200–500ms) per transaction in series is unacceptable; even with concurrency, a 500-transaction batch takes longer than necessary
- Inconsistent: LLMs produce non-deterministic output; the same Swiggy transaction could be categorized differently on two different runs
- Wasteful: Indian bank transactions are heavily patterned. UPI transactions encode the merchant name and counterparty bank directly in the narration string. Common merchants (Swiggy, Zomato, Amazon, Jio) appear in thousands of transactions.

### Option B — Deterministic-only: no LLM

Use only keyword matching and UPI parsing. Never call an LLM.

**Rejected because:**
- Long-tail merchants (local shops, regional businesses, unusual transfer narrations) are not in any keyword list
- Merchant names in non-UPI transactions are often ambiguous bank codes or truncated strings
- Category "Other" would represent a significant fraction of transactions with no path to improvement

### Option C — Deterministic-first, LLM only for unknowns *(selected)*

Run deterministic logic for all transactions. Call the LLM only when:
- The deterministic categorizer returns "Other" (no keyword match), or
- The merchant name is not extractable (non-UPI transaction with no recognizable merchant)

**Selected because:**
- ~70-80% of Indian retail transactions match known patterns: UPI format provides merchant directly; keyword lists cover the most common merchants
- LLM cost scales with the unknown fraction, not total volume
- Deterministic results are 100% reproducible and testable without API calls
- LLM errors are bounded to only the "Other" fraction; the well-known transactions are unaffected by model changes

---

## Implementation

**Stage 1 — Deterministic:**
- `detect_payment_method(narration)` — matches keyword patterns for UPI, NEFT, IMPS, ATM, POS, etc.
- For UPI: `parse_upi_narration(narration)` — regex extracts merchant, VPA, app name, counterparty bank
- `categorize_transaction(narration, merchant, payment_method)` — scores 18 category keyword lists; returns highest-scoring category or "Other"

**Stage 2 — LLM (when `needs_llm=True`):**
- Model: `claude-haiku-4-5-20251001` — fast and cheap for structured extraction
- Prompt instructs Claude to return JSON only: `{"merchant_name", "category", "subcategory"}`
- On failure or malformed response: falls back to raw description truncated to 50 chars, category "Other"
- Concurrency: `asyncio.gather` with semaphore cap of 5 to avoid rate limits

**Source:** CATEGORY_KEYWORDS, PAYMENT_METHOD_PATTERNS, VPA_APP_MAPPING, IFSC_BANK_MAPPING, and the UPI parser logic are adapted from [statementsparser](https://github.com/iharshlalakiya/statementparser) by Harsh Lalakiya (MIT License).

---

## Consequences

- Deterministic results are fully unit-testable without LLM or network access
- The LLM call fraction decreases over time as the keyword lists are extended with new merchants
- Adding a new common merchant to `CATEGORY_KEYWORDS` immediately reduces LLM cost for all future uploads
- Pipeline tests mock the LLM client and verify the deterministic stage independently

---

## Addendum — Payment Gateway Pattern Detection

**Date:** 2026-06-11

Indian payment gateways (Razorpay, PayU, CCAvenue, etc.) produce narration strings in the format:

```
{ALPHANUM_CODE}/{GATEWAY_PREFIX}{MERCHANT}
```

Examples:
- `SU2TF7IYQ6NGJD/RAZPSWIGGY` → Razorpay + Swiggy
- `K4UXS7UOARZ2DOWVCI/PAYUSWIGGYIN` → PayU + Swiggy
- `Sk8Rv8NkPxMq43/RazPsWiggy` → Razorpay + Swiggy

These are **not UPI transactions** and do not follow the `UPI-` prefix pattern.

**Detection logic (in `normalize_deterministic`):**

1. Run `detect_payment_gateway(narration)` before payment method detection.
2. Regex: `^[A-Za-z0-9]{6,}/([A-Za-z]{3,4})([A-Za-z0-9]+)$`
   - Group 1: 3–4 letter gateway prefix
   - Group 2: merchant name suffix (alphanumeric only)
3. Prefix is matched against `PAYMENT_GATEWAY_PREFIXES` (constants.py).
4. Trailing `IN` / `IND` country suffixes are stripped from the merchant name.
5. Merchant is title-cased.
6. `payment_method` is set to `"Other"` (these are not a standard bank transfer type).

**Known gateways:** Razorpay (`RAZP`), PayU (`PAYU`), CCAvenue (`CCAV`), Instamojo (`INST`), Cashfree (`CASH`), BillDesk (`BILL`), Atom (`ATOM`), EazyPay (`EAZZ`).

---

## Addendum — Merchant Registry Cache

**Date:** 2026-06-11

The `merchants` table is used as a lookup cache before calling the LLM:

1. **Cache check:** `normalize_with_llm` queries `merchants` for a case-insensitive match on `canonical_name` against the raw description. For simple narrations where the raw description is essentially the merchant name (e.g. `"APOLLO PHARMAC"`, `"MALNAD HALLI THOTA"`), this avoids repeated LLM calls across uploads.

2. **Cache miss:** The LLM is called and the result is upserted into `merchants` using `INSERT … ON CONFLICT DO UPDATE` on the `canonical_name` unique constraint. A zero-vector placeholder is stored for `embedding`; merchant embeddings can be populated in a separate enrichment pass.

3. **Benefits:**
   - Same merchant always normalizes the same way — eliminates LLM non-determinism for recurring merchants.
   - LLM cost for subsequent uploads is reduced for any merchant already in the registry.
   - Registry failures are non-fatal; if the DB is unreachable, the pipeline falls through to the LLM.

---

## Addendum — Conservative LLM Normalization Prompt

**Date:** 2026-06-11

The original LLM prompt allowed the model to "clean" merchant names freely, which caused hallucinations:

- `"apollo pharmac"` → `"Apollo Pharmacy"` (incorrect expansion)
- `"SLV MILK"` → `"SLV Dairy"` (invented subcategory)

The prompt was updated with explicit constraints:

- **Fix capitalisation only** — title-case the name as it appears.
- **Do NOT expand abbreviations** — `"pharmac"` stays `"Pharmac"`, not `"Pharmacy"`.
- **Do NOT guess the full name** — if the narration is truncated, preserve the truncation.
- **Do NOT add words not in the original** — no inference of complete business names.

This trades completeness for consistency and prevents the model from hallucinating merchant names that could mislead categorisation or search.
