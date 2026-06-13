# ADR 010: Deterministic-First Normalization Strategy

## Status
Accepted

## Context
Initial normalization relied heavily on LLM (gpt-4o-mini) for
merchant extraction and categorization. Problems encountered:

1. LLM is non-deterministic — same narration returns different
   categories across runs even with temperature=0
2. LLM doesn't know Indian financial context — BESCOM categorized
   as Shopping, HSL SEC as Other, IB BILLPAY as Medical
3. LLM is slow and expensive — 8-10s per batch of 37 transactions
4. Merchant names hallucinated — "apollo pharmac" expanded to
   "Apollo Pharmacy" incorrectly

## Decision
Deterministic rules run first and always win over LLM:

Priority order:
1. Bill payment pattern (IB BILLPAY DR) — hardcoded map
2. Payment gateway pattern (alphanum/prefix+merchant)
3. UPI parsing — structured field extraction
4. Keyword categorization — scoring-based, 200+ keywords
5. Subcategory detection — keyword map per subcategory
6. LLM — only when merchant is None or category is Other
7. Deterministic category override — always applied after LLM

LLM prompt is conservative:
- Fix capitalization only
- Do NOT expand abbreviations
- Do NOT guess truncated names
- Return merchant as it appears in narration

## Known Limitations
- Rule engine requires per-pattern fixes for new narration formats
- Same merchant appears differently across banks and payment methods
- Gateway+merchant+domain concatenation (PAYTMSWIGGYCOM) not
  reliably splittable without merchant whitelist
- BESCOM exception hardcoded (COM is company name not domain suffix)

## Consequences
- Consistent categorization for known patterns
- LLM called for ~30% of transactions (down from ~70%)
- Faster pipeline — fewer LLM calls
- User corrections via amendment UI feed back to merchant registry
- New narration formats require code changes — not self-learning
