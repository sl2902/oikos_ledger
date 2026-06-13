# Oikos Ledger — API Reference

## Conventions

All Route Handlers are under `app/app/api/`. Every endpoint:

- Requires an authenticated session (Google OAuth via NextAuth v5). Unauthenticated requests return `401 { "error": "Unauthorized" }`.
- Returns `Content-Type: application/json`.
- Uses `export const dynamic = "force-dynamic"` to opt out of Next.js static caching.
- Scopes all queries to the authenticated `user_id` — users cannot read each other's data.

**Error shape:**
```json
{ "error": "Human-readable message" }
```

**Status codes used:**
| Code | Meaning |
|---|---|
| 200 | Success |
| 400 | Missing or invalid request parameter |
| 401 | Not authenticated |
| 404 | Resource not found (or belongs to another user) |
| 409 | Conflict — see individual endpoint notes |
| 500 | Unhandled server error |

---

## Endpoints

### POST /api/auth/[...nextauth]

NextAuth v5 catch-all route. Handles Google OAuth sign-in, sign-out, and session refresh. Not called directly by application code — managed by Auth.js.

---

### GET /api/transactions

Returns a paginated list of transactions for an account and month, with month-level aggregates and balance info.

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `account_id` | UUID | Yes | Bank account to query |
| `month` | `YYYY-MM` | No | Filter to calendar month |
| `date_from` | `YYYY-MM-DD` | No | Custom range start (used when `month` is absent) |
| `date_to` | `YYYY-MM-DD` | No | Custom range end |
| `category` | string | No | Filter by category name |
| `search` | string | No | Partial match on `normalized_merchant` |
| `page` | integer | No | Default 1 |
| `limit` | integer | No | Default 20 |

**Response:**
```json
{
  "transactions": [
    {
      "id": "uuid",
      "transaction_date": "2026-05-12",
      "raw_description": "UPI-SWIGGY-...",
      "normalized_merchant": "Swiggy",
      "amount": "450.00",
      "closing_balance": "12340.50",
      "currency": "INR",
      "transaction_type": "debit",
      "reference_number": "123456789012",
      "category": "Food & Dining",
      "subcategory": null,
      "payment_method": "UPI",
      "is_amended": false
    }
  ],
  "total": 87,
  "page": 1,
  "limit": 20,
  "total_pages": 5,
  "opening_balance": "11200.00",
  "closing_balance": "14350.75",
  "balance_verified": true,
  "balance_discrepancy": null,
  "month_total_debits": "23450.00",
  "month_total_credits": "50000.00"
}
```

**Notes:**
- Transactions are ordered `(transaction_date DESC, row_number DESC)` — newest first, with intra-day order matching the original bank statement.
- `month_total_debits` and `month_total_credits` are computed from the **full unpaginated result** before applying `page`/`limit` — they always reflect the entire month, not just the current page.
- `opening_balance` is derived from the oldest transaction's `closing_balance ± amount`. `closing_balance` is taken from the most recent transaction.
- `balance_verified` and `balance_discrepancy` come from the most recent `complete` upload for the account+month, not from the transaction rows.
- Amendments are applied server-side. Each transaction in the response reflects effective values after all amendments. `is_amended: true` indicates at least one amendment exists.
- `payment_method` has no database column — computed from `raw_description` at query time and overridable by a `payment_method` amendment.

---

### GET /api/transactions/months

Returns up to the 3 most recent months that have transactions for an account. Used to populate the month tab bar.

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `account_id` | UUID | Yes | Bank account to query |

**Response:**
```json
[
  { "key": "2026-05", "label": "May 2026" },
  { "key": "2026-04", "label": "April 2026" },
  { "key": "2026-03", "label": "March 2026" }
]
```

**Notes:**
- Returns at most 3 months. If fewer than 3 months have transactions, returns only those that do.
- Ordered most-recent-first.
- Cache: `force-dynamic`.

---

### GET /api/transactions/[id]/amendments

Returns the full amendment history for a single transaction.

**Path params:** `id` — transaction UUID

**Response:**
```json
{
  "amendments": [
    {
      "id": "uuid",
      "transaction_id": "uuid",
      "amendment_group_id": "uuid",
      "user_id": "uuid",
      "field_name": "normalized_merchant",
      "old_value": "UPI-SWIGGY-...",
      "new_value": "Swiggy",
      "amended_by": "user",
      "reason": "Corrected auto-parsed name",
      "amended_at": "2026-05-14T10:23:00Z"
    }
  ]
}
```

**Notes:**
- Ordered by `amended_at DESC`.
- Returns 404 if the transaction does not belong to the authenticated user.

---

### POST /api/transactions/[id]/amend

Creates one or more amendments for a transaction in a single interaction group.

**Path params:** `id` — transaction UUID

**Request body:**
```json
{
  "amendments": [
    { "field_name": "normalized_merchant", "old_value": "PAYTM123", "new_value": "Zomato" },
    { "field_name": "category", "old_value": "Other", "new_value": "Food & Dining" }
  ],
  "reason": "Optional free-text reason"
}
```

**Allowed `field_name` values:** `normalized_merchant`, `category`, `subcategory`, `payment_method`

**Immutable fields (rejected if submitted):** `transaction_date`, `amount`, `transaction_type`, `raw_description`, `reference_number`

**Response:**
```json
{ "success": true, "amendment_group_id": "uuid" }
```

**Notes:**
- All amendments in one POST are assigned the same `amendment_group_id`, grouping them as a single user interaction in the audit trail.
- **Side effect:** if `normalized_merchant` is amended and the new value passes validation (3–50 chars, not identical to `raw_description`, not a payment code pattern), the `merchants` table row for the old `canonical_name` is updated to the new name and current `category`. This feeds future normalization runs.
- Returns 404 if the transaction does not belong to the authenticated user.
- Returns 400 if `amendments` is empty or contains an immutable field.

---

### GET /api/categories

Returns all spending categories and subcategories from the database. Used to populate category dropdowns in the filter bar and amendment modal.

**Response:**
```json
{
  "categories": [
    { "id": "uuid", "name": "Food & Dining" }
  ],
  "subcategories": [
    { "id": "uuid", "name": "Restaurants", "parent_id": "uuid" }
  ]
}
```

**Notes:**
- `categories` contains only top-level entries (`parent_id IS NULL`), ordered alphabetically.
- `subcategories` contains only child entries (`parent_id IS NOT NULL`), ordered alphabetically within each parent.
- Client-side: dedupingInterval of 60 000 ms — categories change infrequently.
- Data is seeded by `scripts/seed_categories.py` (10 top-level, 35 subcategories). Not user-generated.

---

### POST /api/upload

Accepts a CSV file, computes its SHA-256 hash, streams it to S3, creates an `uploads` row, and asynchronously invokes the Lambda ingestion pipeline.

**Request:** `multipart/form-data` with field `file` (CSV) and `account_id`.

**Response:**
```json
{ "upload_id": "uuid", "status": "pending" }
```

**Notes:**
- Duplicate detection: if `(user_id, account_id, file_hash)` already exists in `uploads`, returns 409.
- When AWS is not configured, S3 upload and Lambda invocation are skipped gracefully — the `uploads` row is still created.

---

### GET /api/upload/[upload_id]

Returns the current status of an upload. Polled by the upload modal every 1 second while status is `pending` or `processing`.

**Response:**
```json
{
  "upload_id": "uuid",
  "status": "complete",
  "row_count": 37,
  "error_message": null,
  "opening_balance": "11200.00",
  "closing_balance": "14350.75",
  "balance_verified": true,
  "balance_discrepancy": null
}
```

---

### DELETE /api/upload/[upload_id]

Two modes selected by query parameter:

**Cancel mode** (no `?force=true`) — used by the upload modal during polling:
- If status is `complete`: returns `409 { "status": "complete", "row_count": N }` — the modal detects the race condition and transitions to the success state.
- If status is `pending`/`processing`/`failed`/`cancelled`: deletes any partial transactions, sets status to `cancelled`, returns `200 { "status": "cancelled" }`.

**Force-delete mode** (`?force=true`) — used by the upload history modal:
- If status is `pending` or `processing`: returns `409 { "error": "Cannot delete an upload that is still processing" }`.
- Otherwise: cascades deletion — amendments → transactions → upload row. Returns `200 { "status": "deleted" }`.

---

### GET /api/uploads

Returns all uploads for a bank account, ordered newest-first.

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `account_id` | UUID | Yes | Bank account to query |

**Response:**
```json
{
  "uploads": [
    {
      "id": "uuid",
      "filename": "hdfc_may_2026.csv",
      "status": "complete",
      "row_count": 37,
      "balance_verified": true,
      "balance_discrepancy": null,
      "opening_balance": "11200.00",
      "closing_balance": "14350.75",
      "uploaded_at": "2026-05-14T10:00:00Z",
      "completed_at": "2026-05-14T10:01:23Z"
    }
  ]
}
```

---

### GET /api/bank-accounts

Returns all bank accounts for the authenticated user.

**Response:**
```json
{
  "accounts": [
    {
      "id": "uuid",
      "bank_name": "HDFC Bank",
      "account_type": "savings",
      "account_nickname": "Primary",
      "currency": "INR"
    }
  ]
}
```

---

### POST /api/bank-accounts

Creates a new bank account for the authenticated user.

**Request body:**
```json
{
  "bank_name": "HDFC Bank",
  "account_type": "savings",
  "account_nickname": "Primary",
  "currency": "INR"
}
```

**Response:** `201 { "id": "uuid", ... }`

---

### GET /api/insights

Returns precomputed monthly spending aggregations per category. Computed by Lambda after each ingestion run.

---

### GET /api/recommendations

Returns ranked spending recommendations. Supports dismiss via `PATCH /api/recommendations/[id]`.

---

### GET /api/macro

Returns latest macroeconomic indicators (GDP growth, inflation, food inflation) for the user's country.

---

### POST /api/voice

Accepts a transcribed natural-language query. Returns a structured data payload and a spoken response string.
