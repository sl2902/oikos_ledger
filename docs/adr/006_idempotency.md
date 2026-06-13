# ADR 006 — Full Pipeline Idempotency at the Database Level

**Date:** 2026-06-10
**Status:** Accepted

---

## Context

The ingestion pipeline processes bank CSV uploads through multiple stages: file ingestion, transaction parsing, merchant normalisation, insight computation, macro data fetching, recommendation generation, and query caching. Users may re-upload the same file, Lambda may be triggered twice for the same upload, and background jobs may run on overlapping schedules.

Each stage must produce identical results regardless of how many times it runs — no duplicate rows, no errors, no silent data corruption.

---

## Decision

Enforce idempotency via **database-level unique constraints and conflict resolution strategies** rather than application-level duplicate checks.

---

## Rationale

| Approach | Reliability | Performance | Transparency |
|---|---|---|---|
| Application-level SELECT then INSERT | Fragile — race conditions between SELECT and INSERT; bugs in check logic bypass protection | Slower — two round-trips | Hidden in code |
| Database-level UNIQUE + ON CONFLICT | Reliable — enforced atomically by the database even under concurrent writes | Faster — single round-trip | Self-documenting in schema |

Database constraints hold even if bugs exist in application code. A constraint violation is an explicit error, not a silent duplicate. Constraints are visible when inspecting the schema and require no code archaeology to understand.

---

## Conflict Resolution by Stage

| Stage | Table | Constraint | Strategy |
|---|---|---|---|
| File | `uploads` | `UNIQUE (user_id, account_id, file_hash)` | REJECT — same file for the same account is an application error |
| Transaction (with ref) | `transactions` | `UNIQUE (user_id, account_id, reference_number) WHERE reference_number IS NOT NULL` | `DO NOTHING` — skip silently |
| Transaction (no ref) | `transactions` | `UNIQUE (user_id, account_id, transaction_date, amount, normalized_merchant)` | `DO NOTHING` — skip silently |
| Merchant | `merchants` | `UNIQUE (canonical_name)` | `DO UPDATE` — refresh embedding and metadata |
| Insights | `insights` | `UNIQUE (user_id, period, category)` | `DO UPDATE` — overwrite with latest computation |
| Macro data | `macro_economic_data` | `UNIQUE (country_code, indicator, period)` | `DO UPDATE` — refresh value and timestamp |
| Recommendations | `recommendations` | `UNIQUE (user_id, type, category)` | `DO UPDATE` — replace with latest |
| Query cache | `query_cache` | `UNIQUE (user_id, query_hash)` | `DO UPDATE` — refresh result and expiry |

**Why DO NOTHING for transactions but DO UPDATE for everything else:**

Transactions are sourced from the bank and are immutable — if the same transaction appears in two uploads, the second occurrence carries no new information. Silently skipping it is correct.

Merchants, insights, recommendations, and cache entries are computed artifacts. A later computation may produce a better result (updated embedding, recomputed aggregation, revised recommendation). Overwriting ensures the latest computation wins.

**Why REJECT for file uploads:**

A duplicate file hash for the same user and account is not a retry scenario — it is a user error (uploading the same file twice). Returning an explicit error is more useful than silently ignoring the second upload.

---

## Pipeline Status Guard

Lambda checks `uploads.status` at entry point before starting work:

- `pending` → proceed, atomically update to `processing`
- `processing` → abort (another invocation is already running)
- `complete` → abort (already successfully processed)
- `failed` → abort (requires manual intervention or re-trigger)

This prevents two concurrent Lambda invocations from processing the same upload simultaneously, which could produce duplicate transactions even with the row-level constraints.

---

## Consequences

- All unique constraints exist in the database from day one, before any pipeline code writes to these tables
- Constraint names follow the pattern `uq_{table}_{description}` for easy identification in `pg_indexes`
- Application code in Iteration 2 will use `INSERT … ON CONFLICT` with the strategies above — the constraints are the contract that code must honour
- Partial unique index on `transactions.reference_number` covers only rows where the column is not null; the composite index covers the rest
