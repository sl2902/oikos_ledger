# ADR 005 — Deterministic Bank-Specific Parsers over LLM-Based Format Detection

**Date:** 2026-06-10
**Status:** Accepted

---

## Context

Oikos Ledger ingests bank CSV exports. Different banks use different column layouts, date formats, and amount conventions. A format detection strategy was needed before the parser could be written.

---

## Options Considered

### Option A — LLM-based format detection

Pass CSV headers and a sample of rows to an LLM. Ask it to identify the column mapping (date, description, debit, credit, reference number) and return a structured schema.

**Rejected because:**
- Introduces hallucination risk — an LLM may confidently misidentify columns, causing silent data corruption
- Requires validation and guardrail logic that negates much of the benefit
- Adds LLM API cost to every ingestion run, for a problem that does not benefit from AI
- Bank CSV formats are stable and documented; there is no ambiguity an LLM uniquely resolves
- Failures are non-deterministic and hard to reproduce or debug

### Option B — Deterministic bank-specific parsers *(selected)*

One parser module per bank with hardcoded column mappings for that bank's CSV format. A router in `ingestion/pipeline/parser.py` dispatches to the correct parser based on `bank_accounts.bank_name`.

**Selected because:**
- Column mappings are exact and fixed — no hallucination surface
- Failures are deterministic and immediately reproducible
- No LLM cost at parse time
- Easy to add a new bank: create one file, map its columns, done
- Aligns with the principle that LLMs should be used only where they genuinely earn their place

---

## Decision

Use deterministic bank-specific parsers.

---

## Architecture

```
ingestion/pipeline/parser.py          — router: detects bank from bank_name, calls correct parser
ingestion/pipeline/parsers/
  __init__.py
  hdfc.py                             — HDFC Bank parser (fully implemented in Iteration 2)
  sbi.py                              — stub, raises NotImplementedError
  icici.py                            — stub, raises NotImplementedError
  ... (one file per supported bank)
```

The router raises a descriptive error if it receives a `bank_name` with no registered parser.

LLM usage is reserved for merchant normalisation and categorisation — problems that genuinely require language understanding and where deterministic rules would be impractical.

---

## Consequences

- Each new bank requires a small amount of one-time work to write and test a parser
- Parser failures are easy to debug: a wrong column mapping produces a clear error or obviously wrong data, not a plausible-but-incorrect result
- The parser layer has no LLM dependency and can be tested offline with fixture CSV files
