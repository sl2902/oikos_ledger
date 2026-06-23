# Oikos Ledger — API Reference

## Conventions

All Route Handlers are under `app/app/api/`. Every endpoint:

- Requires an authenticated session (Google OAuth via NextAuth v5). Unauthenticated requests return `401 { "error": "Unauthorized" }`.
- Returns `Content-Type: application/json` unless otherwise noted.
- Uses `export const dynamic = "force-dynamic"` to opt out of Next.js static caching.
- Scopes all queries to the authenticated `user_id` — users cannot read each other's data.

**Error shape:**
```json
{ "error": "Human-readable message" }
```

**Status codes:**
| Code | Meaning |
|---|---|
| 200 | Success |
| 201 | Created |
| 400 | Missing or invalid request parameter |
| 401 | Not authenticated |
| 404 | Resource not found (or belongs to another user) |
| 409 | Conflict — duplicate file, or status race condition |
| 500 | Unhandled server error |

---

## Auth

### POST /api/auth/[...nextauth]

NextAuth v5 catch-all. Handles Google OAuth sign-in, sign-out, and session refresh. Managed by Auth.js — not called directly by application code.

---

## Bank Accounts

### GET /api/bank-accounts

Returns all bank accounts for the authenticated user, ordered by most recent upload.

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

## Transactions

### GET /api/transactions

Returns a paginated list of transactions with month-level aggregates.

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `account_id` | UUID | Yes | Bank account to query |
| `month` | `YYYY-MM` | No | Filter to calendar month |
| `date_from` | `YYYY-MM-DD` | No | Custom range start |
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
- Ordered `(transaction_date DESC, row_number DESC)` — newest first, intra-day order matches original bank statement.
- `month_total_debits` and `month_total_credits` reflect the **full unpaginated result**, not just the current page.
- `payment_method` has no database column — computed from `raw_description` at query time and overridable by amendment.
- Amendments applied server-side; each transaction reflects effective values. `is_amended: true` when any amendment exists.

---

### GET /api/transactions/categories

Returns the distinct category names present in an account's transactions. Used to populate the Analytics page category filter.

**Query params:** `account_id` (UUID, required)

**Response:**
```json
["Finance", "Food", "Shopping", "Transport", "Utilities"]
```

---

### GET /api/transactions/months

Returns up to the 3 most recent months that have transactions for an account.

**Query params:** `account_id` (UUID, required)

**Response:**
```json
[
  { "key": "2026-05", "label": "May 2026" },
  { "key": "2026-04", "label": "April 2026" },
  { "key": "2026-03", "label": "March 2026" }
]
```

---

### GET /api/transactions/[id]/amendments

Returns the full amendment history for a single transaction. Returns 404 if the transaction does not belong to the authenticated user.

**Response:**
```json
{
  "amendments": [
    {
      "id": "uuid",
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

---

### POST /api/transactions/[id]/amend

Creates amendments for a transaction.

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

**Immutable fields (rejected):** `transaction_date`, `amount`, `transaction_type`, `raw_description`, `reference_number`

**Response:** `{ "success": true, "amendment_group_id": "uuid" }`

**Notes:**
- All amendments in one POST share the same `amendment_group_id`.
- If `normalized_merchant` is amended and passes validation, the `merchants` table is upserted with the corrected name.

---

## Categories

### GET /api/categories

Returns all spending categories and subcategories. Used to populate filter dropdowns and amendment modal.

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

---

## Uploads

### POST /api/upload

Accepts a CSV file, computes SHA-256 hash, streams to S3, creates an `uploads` row, and invokes Lambda.

**Request:** `multipart/form-data` with `file` (CSV) and `account_id`.

**Response:** `{ "upload_id": "uuid", "status": "pending" }`

**Notes:**
- Returns 409 if same file (by SHA-256) already uploaded for this account.
- S3 upload and Lambda invocation skipped gracefully when AWS is not configured.

---

### GET /api/upload/[upload_id]

Returns current upload status. Polled every 1 second by the upload modal.

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

Two modes:

**Cancel mode** (no `?force=true`) — used during polling:
- `complete` status → 409 (race condition — modal transitions to success state)
- Other statuses → delete partial transactions, set `cancelled`, return 200

**Force-delete mode** (`?force=true`) — used by upload history:
- `pending`/`processing` → 409 (cannot delete while processing)
- Otherwise → cascade delete amendments → transactions → upload row

---

### GET /api/uploads

Returns all uploads for an account, ordered newest-first.

**Query params:** `account_id` (UUID, required)

---

## Insights

### POST /api/insights/query

Main insights query handler. Accepts natural language questions, returns structured data and a text summary via SSE stream or JSON.

**Request body:**
```json
{
  "question": "How much did I spend on food in March?",
  "intent": null,
  "account_id": "uuid",
  "conversation_history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "last_chart_type": "line",
  "last_results": null,
  "date_from": "2026-03-01",
  "date_to": "2026-03-31",
  "is_voice": false
}
```

**Response — streaming SSE** (for fresh queries):
```
data: {"type":"metadata","intent":"finance_custom","intent_label":"Custom query","sql":"SELECT ...","results":[...],"chart_type":"line","row_count":13}

data: {"type":"text","text":"You spent "}
data: {"type":"text","text":"₹7,029 on food in March 2026."}

data: [DONE]
```

**Response — JSON** (for cache hits, suggestions, off-topic, display commands):
```json
{
  "type": "complete",
  "intent": "finance_custom",
  "intent_label": "Custom query",
  "sql": "SELECT ...",
  "results": [...],
  "response": "You spent ₹7,029 on food in March 2026.",
  "chart_type": "line",
  "row_count": 13,
  "cached": true
}
```

**Pre-built intents** (pass as `intent` param to bypass agent):
- `monthly_trend` — time-series aggregation (auto-selects daily/weekly/monthly based on data span)
- `biggest_expenses` — top categories by spend
- `credits_vs_debits` — comparison bar by month
- `top_merchants` — top 10 merchants by spend
- `spending_by_category` — category breakdown with percentages

**Notes:**
- `is_voice: true` suppresses text streaming and suggestions; data cards still rendered in UI.
- `conversation_history` enables follow-up queries with full context.
- Display commands (e.g. "show as pie chart") re-plot existing `last_results` without re-querying.

---

### POST /api/insights/session

Returns an ephemeral OpenAI Realtime API key for the voice session. Key expires after 60 seconds; the client must connect to the Realtime WebSocket immediately.

**Response:**
```json
{
  "value": "ek_...",
  "expires_at": 1781807283
}
```

---

### POST /api/insights/cache

Returns a cached query result by hash. Used when the user selects a suggestion from the similarity cache.

**Request body:** `{ "query_hash": "...", "account_id": "uuid" }`

**Response:** Same shape as `POST /api/insights/query` JSON response.

---

## Analytics

### POST /api/analytics

Returns aggregated transaction data for a given dimension. Deterministic SQL — no LLM involved.

**Request body:**
```json
{
  "account_id": "uuid",
  "dimension": "merchants",
  "months": 3,
  "category": "Food",
  "transaction_type": "debit"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `account_id` | UUID | Yes | Bank account to query |
| `dimension` | string | Yes | One of `merchants`, `payment_methods`, `subcategories`, `debit_credit` |
| `months` | integer | No | Lookback window — 3, 6, or 12. Default 3 |
| `category` | string | No | Filter by category (applies to `merchants` and `subcategories` only) |
| `transaction_type` | string | No | `debit`, `credit`, or `all`. Default `debit`. Ignored for `debit_credit` |

**Dimension shapes:**

`merchants` — top 15 merchants by spend:
```json
{
  "rows": [
    { "normalized_merchant": "Swiggy", "total": "4320.00", "txn_count": "12" }
  ],
  "dimension": "merchants"
}
```

`payment_methods` — pivoted wide format, one row per month, one column per payment method:
```json
{
  "rows": [
    { "month": "2026-03", "UPI": 18200, "POS": 4300, "NEFT": 0 },
    { "month": "2026-04", "UPI": 21000, "POS": 3100, "NEFT": 5000 }
  ],
  "dimension": "payment_methods"
}
```

`subcategories` — top 15 subcategories by spend:
```json
{
  "rows": [
    { "subcategory": "Ride Share", "total": "2100.00", "txn_count": "8" }
  ],
  "dimension": "subcategories"
}
```

`debit_credit` — monthly debit vs credit totals:
```json
{
  "rows": [
    { "month": "2026-03", "debits": "34500.00", "credits": "50000.00" }
  ],
  "dimension": "debit_credit"
}
```

---

## Recommendations

### POST /api/recommendations

Returns on-demand personalised spending recommendations benchmarked against RBI/HCES 2022-23 household expenditure data.

**Request body:**
```json
{
  "account_id": "uuid",
  "date_from": "2026-03-01",
  "date_to": "2026-05-31"
}
```

**Response — streaming SSE:**
```
data: {"type":"card","title":"Food spending","your_pct":38,"benchmark_pct":46,"status":"on_track","insight":"Your food spending is below the national average — you're managing this well."}

data: {"type":"card","title":"Health","your_pct":1,"benchmark_pct":6,"status":"below","insight":"Your health spending is well below the RBI benchmark. Consider reviewing your health insurance coverage."}

data: [DONE]
```

**Status values:** `on_track` | `above` | `below`
