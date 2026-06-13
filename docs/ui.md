# UI Architecture

## Layout

Three-column layout rendered inside `app/(dashboard)/layout.tsx`:

1. **Nav sidebar** — collapsible, icon-only by default, expands on hover to 240px
2. **Accounts panel** — 220px fixed, lists bank accounts for the authenticated user
3. **Transactions panel** — `flex-1`, fills remaining space

---

## Accounts Panel

`components/accounts/AccountsSidebar.tsx`

- Lists all bank accounts for the authenticated user via `useAccounts()` (SWR, `GET /api/bank-accounts`)
- Selected account highlighted with a filled primary-color dot
- Bank logo fetched via Google Favicon API (`https://www.google.com/s2/favicons?domain={domain}&sz=64`); falls back to `public/fallback-bank-icon.svg`
- Displays bank name + account nickname or account type
- History clock icon appears on the selected account row — opens the Upload History modal
- Add bank account button pinned at bottom
- Selection stored in `localStorage` under key `oikos_selected_account_id` and shared via `AccountsContext`
- When a new account is added it is auto-selected

---

## Transactions Panel

`components/transactions/TransactionsPanel.tsx`

### Header (sticky)

- Bank logo, bank name, currency symbol
- Upload Statement button — opens `UploadStatementModal`

### Filter Bar (sticky, below header)

`components/transactions/FilterBar.tsx`

```
Row 1: [ Search merchants ] [ Category ▼ ] [ Method ▼ ] [ Min ₹ ] [ Max ₹ ]
Row 2: [ Jan 2026 ] [ Feb 2026 ] [ Mar 2026 ] [ Custom Range ]
Row 3: [ From  →  To ] (visible only when Custom Range is selected)
```

- Month tabs populated from `GET /api/transactions/months` (up to 3 most recent)
- Category dropdown populated from `GET /api/categories`
- Filter state held in `TransactionsPanel` and reset on account switch

### Transaction List (scrollable)

`components/transactions/TransactionGroup.tsx`

- Transactions grouped by month; each group rendered by `TransactionGroup`
- **Month heading** — sticky within scroll container:
  `{Month name}  |  Opening ₹X  |  Debits –₹X  |  Credits +₹X  |  Closing ₹X  |  ⚠ Balance mismatch` (badge shown only when `balance_verified === false`)
- **Column headers** — sticky below month heading, shown only on the first group
- 20 transactions per page (in-memory slice of full month result)
- Columns: Date · Merchant · Category · Method · Amount
- Edit icon appears on row hover
- Blue dot indicator on rows with at least one amendment (`is_amended: true`)

### Pagination (sticky at bottom)

`components/transactions/Pagination.tsx`

- Shows `{offset + 1}–{offset + pageSize} of {total} transactions`
- Previous / Next buttons; disabled at boundaries

---

## State Management

| Concern | Mechanism |
|---|---|
| Server data | SWR with `keepPreviousData: true` — stale data shown during revalidation |
| Upload polling | `setInterval` every 1 s (not SWR) — avoids React render-cycle race condition with rapid status changes |
| Selected account | `localStorage` + `AccountsContext` (React context) |
| Filter state | `useState` in `TransactionsPanel`, reset on account switch |
| Month selection | `useState` in `TransactionsPanel`, drives the `month` query param |
| Available months | `useAvailableMonths` SWR hook; exports `mutate` for revalidation after upload/delete |
| Categories | `useCategories` SWR hook with `dedupingInterval: 60 000 ms` |
| Uploads history | `useUploads` SWR hook, per account |

---

## Amendment Flow

1. User clicks the edit icon on a transaction row
2. `AmendTransactionModal` opens with the transaction's current effective values
3. Immutable fields shown read-only: date, amount, transaction type, raw description
4. Editable fields: merchant name, category (from DB), subcategory (dropdown when subcategories exist for parent, free-text otherwise), payment method
5. Only fields that actually changed are submitted as amendments
6. `POST /api/transactions/[id]/amend` writes rows to `transaction_amendments`
7. If `normalized_merchant` changed and passes validation, the `merchants` table is upserted with the corrected name
8. Blue dot appears on the row in subsequent renders (`is_amended: true`)
9. SWR revalidates the transaction list after a successful save (`mutateTransactions()`)

---

## Upload Flow

1. User clicks Upload Statement in the panel header
2. File selected; SHA-256 hash computed client-side
3. `POST /api/upload` — creates an `uploads` row (status `pending`), streams file to S3, invokes Lambda asynchronously
4. `setInterval` polls `GET /api/upload/{id}` every 1 second
5. Modal shows pipeline stage progress: **Uploading → Parsing → Normalizing → Embedding → Complete**
6. On `complete`: modal shows row count and a balance warning badge if `balance_verified === false`
7. Modal auto-closes after 2 seconds; `mutateTransactions()` and `mutateMonths()` are called
8. **Cancel during polling:** `DELETE /api/upload/{id}` (no `?force`). A `409` response means the upload completed between the last poll and the cancel — the modal detects this and transitions to the success state instead of closing silently

---

## Upload History

`components/uploads/UploadHistoryModal.tsx`

- Opened via the history clock icon on the selected account in the sidebar
- Fetches uploads via `useUploads(accountId)` (`GET /api/uploads?account_id=...`)
- Table columns: filename · uploaded date · row count · balance verification badge · status badge · delete button
- Delete button disabled for `pending` and `processing` uploads
- Clicking delete shows an inline confirmation view (replaces the table within the same modal)
- On confirm: `DELETE /api/upload/{id}?force=true` cascades deletion — amendments → transactions → upload row
- After deletion: SWR global `mutate` revalidates all `/api/transactions*` caches so the month tabs and transaction list refresh immediately
