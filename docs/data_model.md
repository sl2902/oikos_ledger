# Oikos Ledger — Data Model

## Status

All 13 custom tables are implemented and verified. Defined in two places:

- **Python** — `ingestion/models/` (SQLModel classes, authoritative for table creation)
- **TypeScript** — `app/lib/db/schema.ts` (Drizzle schema, mirrors Python for type-safe reads)

> **Note on `spatial_ref_sys`:** PostGIS creates this system table. It appears in the Supabase/Aurora table editor alongside the 13 custom tables but is not part of the Oikos Ledger schema.

---

## Design Conventions

- All primary keys are `UUID` with `server_default=text("gen_random_uuid()")` — PostgreSQL column-level expression, not application-layer `default_factory`.
- All `created_at` columns use `server_default=text("timezone('utc', now())")`. All `updated_at` columns add `onupdate=text("timezone('utc', now())")`. Both are `TIMESTAMPTZ`.
- `transactions` and `transaction_amendments` are **append-only** — corrections go to `transaction_amendments`, never back to `transactions`.
- PostGIS geometry columns use `GEOMETRY(Point, 4326)` — WGS 84 lat/lng as a single column.
- pgvector columns use `VECTOR(1536)` — 1536 dimensions matching OpenAI `text-embedding-3-small`.
- **Schema changes while tables are empty:** update the SQLModel model, run `python scripts/drop_tables.py` then `python scripts/create_tables.py`. Once tables contain data, write proper migrations.

---

## Tables

### `users`

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

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `account_id` | UUID FK → `bank_accounts.id` | |
| `filename` | TEXT | Original filename |
| `s3_key` | TEXT | S3 object key |
| `file_hash` | TEXT | SHA-256 of raw CSV — used for duplicate detection |
| `status` | TEXT | pending \| processing \| complete \| failed \| cancelled |
| `row_count` | INTEGER | Nullable — set after parsing |
| `error_message` | TEXT | Nullable — set on failure |
| `uploaded_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ | Nullable |
| `opening_balance` | NUMERIC(15,2) | Nullable — derived from first row: `closing + debit - credit` |
| `closing_balance` | NUMERIC(15,2) | Nullable — from last transaction in statement |
| `balance_verified` | BOOLEAN | Nullable — true if all row closing balances are mathematically consistent |
| `balance_discrepancy` | NUMERIC(15,2) | Nullable — absolute difference between expected and actual closing balance |

---

### `merchants`

Normalised merchant registry. Raw bank description strings are resolved to canonical entries during ingestion.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `global_merchant_id` | TEXT | Nullable — external reference |
| `canonical_name` | TEXT | LLM-resolved name. `UNIQUE` |
| `category` | TEXT | |
| `subcategory` | TEXT | Nullable |
| `location` | GEOMETRY(Point, 4326) | Nullable — PostGIS |
| `embedding` | VECTOR(1536) | pgvector |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Lookup strategy:** `ILIKE` partial match on `canonical_name` using the first 20 characters of the extracted merchant name.

**Write strategy:** `INSERT ... ON CONFLICT DO UPDATE` — latest LLM result always wins. Category is overridden by deterministic categorisation before upsert.

**Limitations:** Registry only populated for LLM-path transactions. Deterministic transactions (UPI with keyword match, bill payments, gateway patterns) do not write to the registry.

---

### `categories`

Reference hierarchy for spending categories. Self-referential for subcategories. Seeded by `scripts/seed_categories.py` (10 top-level, 35 subcategories). Not user-generated.

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

Core financial data. **Append-only — no `updated_at`.** Corrections go to `transaction_amendments`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `account_id` | UUID FK → `bank_accounts.id` | |
| `merchant_id` | UUID FK → `merchants.id` | Nullable |
| `upload_id` | UUID FK → `uploads.id` | |
| `row_number` | INTEGER | Nullable — original CSV row position |
| `transaction_date` | DATE | |
| `raw_description` | TEXT | Original bank string — never modified |
| `normalized_merchant` | TEXT | LLM-resolved |
| `amount` | NUMERIC(12,2) | Always positive |
| `closing_balance` | NUMERIC(15,2) | Nullable — running balance after this transaction |
| `currency` | TEXT | ISO 4217 |
| `transaction_type` | TEXT | debit \| credit |
| `reference_number` | TEXT | Nullable — `Chq/Ref Number` from bank CSV |
| `category` | TEXT | |
| `subcategory` | TEXT | Nullable |
| `location` | GEOMETRY(Point, 4326) | Nullable — PostGIS |
| `embedding` | VECTOR(1536) | pgvector |
| `created_at` | TIMESTAMPTZ | |

Sort order: `(transaction_date DESC, row_number DESC)` — newest first, intra-day order matches original bank statement.

---

### `transaction_amendments`

**Append-only sidecar to `transactions` — no `updated_at`.** Every user or system correction creates a new row. The original transaction is never modified. Current state derived by replaying amendments on top of the original row.

`amendment_group_id` binds all amendments from a single user interaction.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `transaction_id` | UUID FK → `transactions.id` | |
| `amendment_group_id` | UUID | Groups simultaneous field changes |
| `user_id` | UUID FK → `users.id` | |
| `field_name` | TEXT | normalized_merchant \| category \| subcategory \| payment_method |
| `old_value` | TEXT | |
| `new_value` | TEXT | |
| `amended_by` | TEXT | user \| system |
| `reason` | TEXT | Nullable |
| `amended_at` | TIMESTAMPTZ | |

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

`UNIQUE (user_id, period, category)`

---

### `macro_economic_data`

Time-series macroeconomic indicators by country and period. One row per indicator per country per period.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `country_code` | TEXT | ISO 3166-1 alpha-2 |
| `indicator` | TEXT | e.g. "gdp_growth", "food_inflation" |
| `period` | TEXT | YYYY or YYYY-MM |
| `value` | NUMERIC(10,4) | |
| `source` | TEXT | "world_bank" \| "rbi" |
| `fetched_at` | TIMESTAMPTZ | |

`UNIQUE (country_code, indicator, period)`

---

### `recommendations`

Generated recommendations per user. Linked to the macro indicator or RBI benchmark that triggered them.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `type` | TEXT | reduce_spending \| shift_category \| macro_alert \| benchmark_gap |
| `priority` | TEXT | high \| medium \| low |
| `message` | TEXT | Human-readable |
| `supporting_data` | JSONB | Supporting figures, benchmark comparison data |
| `category` | TEXT | Nullable |
| `macro_indicator` | TEXT | Nullable — indicator that triggered this |
| `is_dismissed` | BOOLEAN | Default false |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

`UNIQUE (user_id, type, category)`

---

### `query_cache`

Caches NL→SQL query results. Two-tier lookup: exact SHA-256 hash first, then pgvector cosine similarity.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `account_id` | UUID FK → `bank_accounts.id` | |
| `query_hash` | TEXT | SHA-256 of normalised query text |
| `query_text` | TEXT | Original query |
| `query_embedding` | VECTOR(1536) | For cosine similarity lookup |
| `result` | JSONB | Cached response payload including `chart_type`, `sql`, `results` |
| `expires_at` | TIMESTAMPTZ | 24h TTL, refreshed on conflict |
| `created_at` | TIMESTAMPTZ | |

`UNIQUE (user_id, account_id, query_hash)`

---

### `voice_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id` | |
| `started_at` | TIMESTAMPTZ | |
| `ended_at` | TIMESTAMPTZ | Nullable |

---

### `voice_messages`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `session_id` | UUID FK → `voice_sessions.id` | |
| `role` | TEXT | user \| assistant |
| `content` | TEXT | Spoken or generated text |
| `generated_query` | TEXT | Nullable — SQL executed |
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
users ──< query_cache >── bank_accounts
users ──< voice_sessions ──< voice_messages
```

---

## Index Strategy

| Table | Column | Index type | Purpose |
|---|---|---|---|
| `transactions` | `embedding` | HNSW (pgvector) | Approximate nearest-neighbour semantic search |
| `merchants` | `location` | GIST (PostGIS) | Radius/bounding-box geospatial queries |
| `transactions` | `transaction_date` | BRIN | Time-series range scans |
| `query_cache` | `query_embedding` | HNSW (pgvector) | Cosine similarity cache hit detection |
| `query_cache` | `query_hash` | B-tree | Exact text-hash lookup |

Indexes added via migration once ingestion pipeline is writing data.

---

## Idempotency

All pipeline stages are idempotent. Enforced at the **database level via unique constraints**.

| Level | Table | Constraint | Conflict resolution |
|---|---|---|---|
| 1 — File | `uploads` | `UNIQUE (user_id, account_id, file_hash)` | REJECT — checked at Route Handler before S3 upload |
| 2 — Transaction (with ref) | `transactions` | `UNIQUE (user_id, account_id, reference_number) WHERE reference_number IS NOT NULL` | `INSERT … ON CONFLICT DO NOTHING` |
| 2 — Transaction (no ref) | `transactions` | `UNIQUE (user_id, account_id, transaction_date, amount, normalized_merchant)` | `INSERT … ON CONFLICT DO NOTHING` |
| 3 — Pipeline status | `uploads.status` | Application-level guard | Lambda aborts if status is `processing` or `complete` |
| 4 — Merchant | `merchants` | `UNIQUE (canonical_name)` | `INSERT … ON CONFLICT DO UPDATE` |
| 5 — Insights | `insights` | `UNIQUE (user_id, period, category)` | `INSERT … ON CONFLICT DO UPDATE` |
| 6 — Macro data | `macro_economic_data` | `UNIQUE (country_code, indicator, period)` | `INSERT … ON CONFLICT DO UPDATE` |
| 7 — Recommendations | `recommendations` | `UNIQUE (user_id, type, category)` | `INSERT … ON CONFLICT DO UPDATE` |
| 8 — Query cache | `query_cache` | `UNIQUE (user_id, account_id, query_hash)` | `INSERT … ON CONFLICT DO UPDATE` |

---

## Amendment Application

Effective transaction values computed at query time in `GET /api/transactions`:

1. Fetch raw transactions matching filters
2. Fetch latest amendment per `(transaction_id, field_name)` ordered by `amended_at DESC`
3. Apply amendments:
   ```
   effectiveTransaction = {
     ...transaction,
     normalized_merchant: latestAmendment("normalized_merchant") ?? transaction.normalized_merchant,
     category:            latestAmendment("category")            ?? transaction.category,
     subcategory:         latestAmendment("subcategory")         ?? transaction.subcategory,
     payment_method:      latestAmendment("payment_method")      ?? computedFromRawDescription,
     is_amended:          true if any amendments exist
   }
   ```

### Amendable vs immutable fields

| Amendable | Immutable |
|---|---|
| `normalized_merchant` | `transaction_date` |
| `category` | `amount` |
| `subcategory` | `transaction_type` |
| `payment_method` | `raw_description` |
| | `reference_number` |

### Merchant feedback loop

When `normalized_merchant` is corrected and passes validation (3–50 chars, not a payment code, not identical to raw description), the `merchants` table is upserted with the corrected name and current category. Future normalisation runs will find the corrected name in the registry without needing the LLM.

### Subcategory privacy

Subcategories are private per user — stored in `transaction_amendments` scoped to `user_id`, never written to the `merchants` table. Two users at the same merchant can have different subcategories without either affecting the other.

---

## Idempotency Detail Notes

- `file_hash` is the SHA-256 digest of the raw CSV content. Computed at the Route Handler before the file is written to S3 or Lambda is triggered.
- The partial unique index on `transactions.reference_number` only applies where `reference_number IS NOT NULL`. Rows without a reference number fall through to the composite index.
- All conflict resolution strategies (`DO NOTHING` / `DO UPDATE`) are implemented in the ingestion pipeline, not the schema. The constraints exist now; the application logic referencing them was added in Iteration 2.

## Amendment Application — Full Detail

`transactions` is append-only. User corrections go to `transaction_amendments`, never back to the original row.

### How amendments are applied

Effective transaction values are computed at query time in `GET /api/transactions`:

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
5. `payment_method` has no database column — computed from `raw_description` server-side, overridable by amendment

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
4. Future normalisation runs will find the corrected name in the merchant registry without needing the LLM

If validation fails, the amendment is still saved but the `merchants` table upsert is skipped — a payment-code-looking name is not written back as a shared canonical merchant name.

### Subcategory privacy

Subcategories are **private per user** — stored in `transaction_amendments` scoped to `user_id`, never written to the `merchants` table. Subcategory is a personal interpretation, not a shared fact. Two users transacting at the same merchant can have different subcategories without affecting each other.

### Amendment grouping

All field changes submitted in a single POST are assigned the same `amendment_group_id` (UUID). This groups simultaneous corrections — e.g. fixing both merchant name and category at once — so the audit trail shows them as a single user intent rather than separate events.
