# Oikos Ledger — Data Model

## Status

All 13 custom tables are implemented and verified. They are defined in two places:

- **Python** — `ingestion/models/` (SQLModel classes, authoritative for table creation)
- **TypeScript** — `app/lib/db/schema.ts` (Drizzle schema, mirrors Python for type-safe reads)

> **Note on `spatial_ref_sys`:** PostGIS creates a `spatial_ref_sys` system table in the database. It appears alongside the 13 custom tables in the Supabase table editor but is not part of the Oikos Ledger schema and is not defined in either ORM.

---

## Design Conventions

- All primary keys are `UUID` with `server_default=text("gen_random_uuid()")` — the default is a PostgreSQL column-level expression, not an application-layer `default_factory`. This means inserts from any client (Python, SQL, tests) get a UUID without the application supplying one.
- All `created_at` columns use `server_default=text("timezone('utc', now())")`. All `updated_at` columns add `onupdate=text("timezone('utc', now())")`. Both are `TIMESTAMPTZ` (timezone-aware).
- `transactions` and `transaction_amendments` are **append-only** — neither table has an `updated_at` column; corrections go to `transaction_amendments`, never back to `transactions`
- PostGIS geometry columns use `GEOMETRY(Point, 4326)` — WGS 84 lat/lng stored as a single column, not separate float columns
- pgvector columns use `VECTOR(1536)` — 1536 dimensions matching OpenAI `text-embedding-3-small`
- **Schema changes while tables are empty:** update the SQLModel model in `ingestion/models/`, run `python scripts/drop_tables.py` then `python scripts/create_tables.py`. Do not alter the live database directly. Once tables contain data, proper migrations will be required.

---

## Tables

### `users`

Authenticated user identity and preferences.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `email` | TEXT | Unique, not null |
| `country_code` | TEXT | ISO 3166-1 alpha-2 |
| `currency` | TEXT | ISO 4217 |
| `income_bracket` | TEXT | Nullable |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

### `bank_accounts`

A user can have multiple bank accounts. Transactions belong to an account.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `bank_name` | TEXT | |
| `account_type` | TEXT | checking \| savings \| credit |
| `account_nickname` | TEXT | Nullable |
| `currency` | TEXT | ISO 4217 |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

### `uploads`

Tracks every CSV upload event and ingestion pipeline status.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `account_id` | UUID FK → `bank_accounts.id` | |
| `filename` | TEXT | Original filename |
| `s3_key` | TEXT | S3 object key |
| `status` | TEXT | pending \| processing \| complete \| failed \| cancelled |
| `row_count` | INTEGER | Nullable — set after parsing |
| `error_message` | TEXT | Nullable — set on failure |
| `uploaded_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ | Nullable |
| `opening_balance` | NUMERIC(15,2) | Nullable — account balance before first transaction in statement. Derived from first row: `closing + debit - credit`. |
| `closing_balance` | NUMERIC(15,2) | Nullable — account balance after last transaction in statement. |
| `balance_verified` | BOOLEAN | Nullable — true if all row closing balances are mathematically consistent. False if any discrepancy detected. Null if closing balance not available in CSV. |
| `balance_discrepancy` | NUMERIC(15,2) | Nullable — absolute difference between expected and actual closing balance. Null if `balance_verified` is true. |

---

### `merchants`

Normalised merchant registry. Raw bank description strings are resolved to canonical entries during ingestion.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `global_merchant_id` | TEXT | Nullable — external reference |
| `canonical_name` | TEXT | LLM-resolved name |
| `category` | TEXT | |
| `subcategory` | TEXT | Nullable |
| `location` | GEOMETRY(Point, 4326) | Nullable — PostGIS |
| `embedding` | VECTOR(1536) | pgvector |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

### Merchant Registry

Append-only cache of LLM normalization results. Written to after every successful LLM call. Read before calling LLM — a registry hit skips the LLM entirely.

**Lookup strategy:**
- `ILIKE` partial match on `canonical_name` using the first 20 characters of the extracted merchant name.

**Write strategy:**
- `INSERT ... ON CONFLICT DO UPDATE` — latest LLM result always wins. Category is overridden by deterministic categorization before upsert, so the stored category reflects the deterministic result when one is available.

**Limitations:**
- Registry is only populated for transactions that go through the LLM path. Deterministic transactions (UPI with keyword match, bill payments, gateway patterns) do not write to the registry.
- Fuzzy matching via `pg_trgm` is planned but not yet implemented — the registry is too sparse on first run for similarity thresholds to be reliable.

---

### `categories`

Reference hierarchy for spending categories. Self-referential for subcategories. Seeded by `scripts/seed_categories.py`, not user-generated. The seeder is idempotent — safe to re-run, skips existing rows. Current seed data: 10 top-level categories, 35 subcategories.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT | |
| `parent_id` | UUID FK → `categories.id` | Nullable — null for top-level |
| `icon` | TEXT | Nullable |
| `color` | TEXT | Nullable — hex code |
| `created_at` | TIMESTAMPTZ | |

---

### `transactions`

Core financial data. **Append-only — no `updated_at`.** Rows are never updated or deleted. Corrections go to `transaction_amendments`. Both the raw bank string and the LLM-normalised merchant name are stored.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `account_id` | UUID FK → `bank_accounts.id` | |
| `merchant_id` | UUID FK → `merchants.id` | Nullable |
| `upload_id` | UUID FK → `uploads.id` | |
| `row_number` | INTEGER | Nullable — original CSV row position. Sort by `(transaction_date DESC, row_number DESC)` to show newest transactions first while preserving bank statement order within each day. |
| `transaction_date` | DATE | |
| `raw_description` | TEXT | Original bank string — never modified |
| `normalized_merchant` | TEXT | LLM-resolved |
| `amount` | NUMERIC(12,2) | Always positive |
| `closing_balance` | NUMERIC(15,2) | Nullable — running account balance after this transaction as reported by the bank. Used for balance verification and per-month opening/closing balance display. |
| `currency` | TEXT | ISO 4217 |
| `transaction_type` | TEXT | debit \| credit |
| `reference_number` | TEXT | Nullable — `Chq/Ref Number` from bank CSV; used for deduplication |
| `category` | TEXT | |
| `subcategory` | TEXT | Nullable |
| `location` | GEOMETRY(Point, 4326) | Nullable — PostGIS |
| `embedding` | VECTOR(1536) | pgvector |
| `created_at` | TIMESTAMPTZ | |

---

### `transaction_amendments`

**Append-only sidecar to `transactions` — no `updated_at`.** Every user or system correction creates a new row. The original transaction is never modified. Current state is derived by replaying amendments on top of the original row.

`amendment_group_id` binds all amendments produced by a single user interaction — a user editing multiple fields at once generates one group, not one row per field.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `transaction_id` | UUID FK → `transactions.id` | |
| `amendment_group_id` | UUID | Groups amendments from one interaction |
| `user_id` | UUID FK → `users.id` | |
| `field_name` | TEXT | Which field was amended |
| `old_value` | TEXT | Value before |
| `new_value` | TEXT | Value after |
| `amended_by` | TEXT | user \| system |
| `reason` | TEXT | Nullable |
| `amended_at` | TIMESTAMPTZ | |

---

### `macro_economic_data`

Time-series macroeconomic indicators by country and period. One row per indicator per country per period.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `country_code` | TEXT | ISO 3166-1 alpha-2 |
| `indicator` | TEXT | gdp_growth \| inflation \| food_inflation \| gdp_per_capita |
| `period` | TEXT | YYYY-MM |
| `value` | NUMERIC(12,4) | |
| `source` | TEXT | world_bank \| rbi |
| `fetched_at` | TIMESTAMPTZ | |

---

### `insights`

Pre-computed monthly spend aggregations per user per category. Computed by Lambda after ingestion completes. `last_upload_id` identifies which upload triggered the most recent recomputation — used to detect stale rows when new data arrives.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `period` | TEXT | YYYY-MM |
| `category` | TEXT | |
| `total_amount` | NUMERIC(12,2) | |
| `transaction_count` | INTEGER | |
| `avg_amount` | NUMERIC(12,2) | |
| `mom_delta` | NUMERIC(12,2) | Month-over-month change |
| `last_upload_id` | UUID FK → `uploads.id` | Tracks which upload triggered recomputation |
| `computed_at` | TIMESTAMPTZ | |

---

### `recommendations`

Generated recommendations per user. Linked to the macro indicator that triggered them, if applicable.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `type` | TEXT | reduce_spending \| shift_category \| macro_alert |
| `priority` | TEXT | high \| medium \| low |
| `message` | TEXT | Human-readable |
| `supporting_data` | JSONB | Supporting figures and context |
| `category` | TEXT | Nullable |
| `macro_indicator` | TEXT | Nullable — indicator that triggered this |
| `is_dismissed` | BOOLEAN | Default false |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

### `query_cache`

Caches expensive pgvector semantic search results. `query_embedding` enables an exact vector match lookup before running a full cosine similarity scan — a cache hit avoids touching the `transactions` HNSW index entirely.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `query_hash` | TEXT | SHA-256 of query text — secondary lookup |
| `query_text` | TEXT | Original voice query |
| `query_embedding` | VECTOR(1536) | Exact vector match — checked before cosine scan |
| `result` | JSONB | Cached result payload |
| `expires_at` | TIMESTAMPTZ | Cache TTL |
| `created_at` | TIMESTAMPTZ | |

---

### `voice_sessions`

Tracks voice query sessions per user.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `started_at` | TIMESTAMPTZ | |
| `ended_at` | TIMESTAMPTZ | Nullable |

---

### `voice_messages`

Individual turns within a voice session. Stores both user query and system response, plus the generated query that was executed.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `session_id` | UUID FK → `voice_sessions.id` | |
| `role` | TEXT | user \| assistant |
| `content` | TEXT | Spoken or generated text |
| `generated_query` | TEXT | Nullable — SQL or pgvector query executed |
| `created_at` | TIMESTAMPTZ | |

---

## Relationships

```
users ──< bank_accounts ──< uploads ──< transactions >── merchants
users ──< transactions
users ──< transaction_amendments
transactions ──< transaction_amendments
categories ──< categories (self-referential parent_id)
users ──< insights >── uploads
users ──< recommendations
users ──< query_cache
users ──< voice_sessions ──< voice_messages
```

---

## Index Strategy (planned)

| Table | Column | Index type | Purpose |
|---|---|---|---|
| `transactions` | `embedding` | HNSW (pgvector) | Approximate nearest-neighbour semantic search |
| `merchants` | `location` | GIST (PostGIS) | Radius and bounding-box geospatial queries |
| `transactions` | `transaction_date` | BRIN | Time-series range scans |
| `query_cache` | `query_embedding` | HNSW (pgvector) | Exact vector cache hit detection |
| `query_cache` | `query_hash` | B-tree | Secondary text-hash lookup |

Indexes are not created by `create_tables.py` in the current iteration — they will be added in a migration once the ingestion pipeline is writing data.

---

## Idempotency

All pipeline stages are idempotent. Running any stage twice produces the same result as running it once. Idempotency is enforced at the **database level via unique constraints** — not application logic — so it holds even if bugs exist in the application code.

| Level | Table | Constraint | Conflict resolution |
|---|---|---|---|
| 1 — File | `uploads` | `UNIQUE (user_id, account_id, file_hash)` | REJECT — same file hash for the same account is an error; checked at the Route Handler before S3 upload |
| 2 — Transaction (with ref) | `transactions` | `UNIQUE (user_id, account_id, reference_number) WHERE reference_number IS NOT NULL` | `INSERT … ON CONFLICT DO NOTHING` |
| 2 — Transaction (no ref) | `transactions` | `UNIQUE (user_id, account_id, transaction_date, amount, normalized_merchant)` | `INSERT … ON CONFLICT DO NOTHING` |
| 3 — Pipeline status | `uploads.status` | Application-level guard | Lambda aborts if status is `processing` or `complete`; only proceeds if `pending` |
| 4 — Merchant | `merchants` | `UNIQUE (canonical_name)` | `INSERT … ON CONFLICT (canonical_name) DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = EXCLUDED.updated_at` |
| 5 — Insights | `insights` | `UNIQUE (user_id, period, category)` | `INSERT … ON CONFLICT DO UPDATE SET` all aggregate columns and `computed_at` |
| 6 — Macro data | `macro_economic_data` | `UNIQUE (country_code, indicator, period)` | `INSERT … ON CONFLICT DO UPDATE SET value = EXCLUDED.value, fetched_at = EXCLUDED.fetched_at` |
| 7 — Recommendations | `recommendations` | `UNIQUE (user_id, type, category)` | `INSERT … ON CONFLICT DO UPDATE SET` all columns |
| 8 — Query cache | `query_cache` | `UNIQUE (user_id, query_hash)` | `INSERT … ON CONFLICT DO UPDATE SET result = EXCLUDED.result, query_embedding = EXCLUDED.query_embedding, expires_at = EXCLUDED.expires_at` |

**Notes:**

- `file_hash` is the SHA-256 digest of the raw CSV content. It is computed at the Route Handler before the file is written to S3 or Lambda is triggered.
- The partial unique index on `transactions.reference_number` only applies where `reference_number IS NOT NULL`. Rows without a reference number fall through to the composite index.
- All conflict resolution strategies (`DO NOTHING` / `DO UPDATE`) are implemented in the ingestion pipeline (Iteration 2), not the schema. The constraints exist now; the application logic referencing them will be added in Iteration 2.

---

## Amendment Application

`transactions` is append-only. User corrections go to `transaction_amendments`, never back to the original row.

### How amendments are applied

Effective transaction values are computed at query time in the `GET /api/transactions` Route Handler:

1. Fetch raw transactions matching the query filters
2. Collect all `transaction_id` values from the result set
3. Fetch the latest amendment per `(transaction_id, field_name)` in one query, ordered by `amended_at DESC`
4. Apply amendments to produce effective values:
   ```
   effectiveTransaction = {
     ...transaction,
     normalized_merchant: latestAmendment("normalized_merchant") ?? transaction.normalized_merchant,
     category:            latestAmendment("category")            ?? transaction.category,
     subcategory:         latestAmendment("subcategory")         ?? transaction.subcategory,
     payment_method:      latestAmendment("payment_method")      ?? computedFromRawDescription,
     is_amended:          true if any amendments exist for this transaction
   }
   ```
5. `payment_method` has no database column — it is computed from `raw_description` server-side and can be overridden by a `payment_method` amendment

### Amendable vs immutable fields

| Amendable | Immutable |
|---|---|
| `normalized_merchant` | `transaction_date` |
| `category` | `amount` |
| `subcategory` | `transaction_type` |
| `payment_method` | `raw_description` |
| | `reference_number` |
| | `account_id`, `user_id`, `upload_id` |

### Merchant feedback loop

When a user corrects `normalized_merchant`:

1. The amendment is written to `transaction_amendments`
2. The Route Handler cleans and validates the new name (3–50 characters, not a payment code, not identical to raw description)
3. If valid, the merchant record is looked up by old `canonical_name` and updated to the new name and current `category`
4. Future normalization runs will find the corrected name in the merchant registry and use it without needing the LLM

If validation fails, the amendment is still saved to `transaction_amendments` so the user's correction is recorded, but the `merchants` table upsert is skipped — a payment-code-looking name is not written back as a shared canonical merchant name.

### Subcategory privacy

Subcategories are **private per user**. They are stored in `transaction_amendments` scoped to `user_id` and never written to the `merchants` table or any other shared reference table. Subcategory is a personal interpretation of a transaction, not a shared fact. Two users transacting at the same merchant can have different subcategories without either affecting the other.

### Amendment grouping

All field changes submitted in a single POST are assigned the same `amendment_group_id` (UUID). This groups simultaneous corrections — e.g., fixing both merchant name and category at once — so the audit trail shows them as a single user intent rather than separate events.
