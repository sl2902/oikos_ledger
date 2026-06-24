# Oikos Ledger — UI Architecture

## Layout

Three-column layout rendered inside `app/(dashboard)/layout.tsx`:

1. **Nav sidebar** — icon-only (56px), tooltips on hover. Nav items: Dashboard, Insights, Recommendations, Analytics. Macro Context item rendered but disabled (reduced opacity, not clickable).
2. **Accounts panel** — 220px fixed, lists bank accounts for the authenticated user
3. **Main panel** — `flex-1`, fills remaining space (transactions, insights, recommendations, or analytics)

---

## Accounts Panel

`components/accounts/AccountsSidebar.tsx`

- Lists all bank accounts via `useAccounts()` (SWR, `GET /api/bank-accounts`), ordered by most recent upload
- Selected account highlighted with a filled primary-colour dot
- Bank logo fetched via Google Favicon API; falls back to `public/fallback-bank-icon.svg`
- History clock icon on selected account row — opens Upload History modal
- Add bank account button pinned at bottom
- Selection stored in `localStorage` under `oikos_selected_account_id` and shared via `AccountsContext`
- New accounts auto-selected on creation

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
- Search debounce uses `filtersRef` and `onChangeRef` refs so the closure always reads current state without causing extra re-renders or resetting pagination

### Transaction List (scrollable)

`components/transactions/TransactionGroup.tsx`

- Transactions grouped by month; each group rendered by `TransactionGroup`
- **Month heading** (sticky): `{Month name} | Opening ₹X | Debits –₹X | Credits +₹X | Closing ₹X | ⚠ Balance mismatch`
- Opening and closing balances fetched from `GET /api/transactions/balances` on filter/account change — not derived from transaction data on the client
- 20 transactions per page
- Columns: Date · Merchant · Category · Method · Amount
- Edit icon on row hover
- Blue dot on rows with amendments (`is_amended: true`)

### Pagination (sticky at bottom)

`components/transactions/Pagination.tsx`

- Shows `{offset + 1}–{offset + pageSize} of {total} transactions`
- Previous / Next buttons; disabled at boundaries

---

## Analytics Panel

`components/analytics/AnalyticsPanel.tsx`

Four-tab breakdown of spending across different dimensions. All data comes from deterministic SQL via `POST /api/analytics` — no LLM.

### Tabs

| Tab | Dimension | Chart type | Filters |
|---|---|---|---|
| Merchants | Top 15 merchants by spend | `bar` | months, transaction type, category |
| Payment Methods | Spend by method over time (pivoted wide) | `multi_bar` | months, transaction type |
| Subcategories | Top 15 subcategories by spend | `bar` | months, transaction type, category |
| Debit vs Credit | Monthly debit/credit comparison | `comparison_bar` | months |

### Filters

- **Month range** — Last 3 / 6 / 12 months
- **Transaction type** — Debits / Credits / All (hidden on Debit vs Credit tab)
- **Category** — populated from `GET /api/transactions/categories` (shown on Merchants and Subcategories tabs)

### Persistence

- Active tab stored in `localStorage` under `oikos_analytics_active_tab`
- Filters stored per account per tab under `oikos_analytics_{accountId}_{tab}`
- Filters restored on tab switch and account switch; fall back to defaults if no saved state

---

## Insights Panel

`components/insights/InsightsPanel.tsx`

### Chat Interface

- Message history persisted per account in `sessionStorage` (`insights_turns_{accountId}`)
- Conversation restored on mount and on account switch
- Quick question buttons: Monthly trend · Biggest expenses · Credits vs Debits · Top merchants · Spending by category

### Input Bar

- Text input with Enter-to-send
- Speaker button (audio toggle for browser TTS) — hidden when voice is active
- Voice button (connect/disconnect) — disabled when `NEXT_PUBLIC_VOICE_ENABLED !== "true"`
- Date filter toggle — persisted per account in `sessionStorage` (`insights_filter_{accountId}`)

### TurnCard

`components/insights/TurnCard.tsx`

- **User bubble** — dark background, right-aligned
- **Assistant bubble** — suppressed when content is empty and SQL/results are present (voice mode data cards)
- **Chart card** — open by default, collapsible; renders `InsightsChart` based on `chart_type`
- **Table card** — open by default, collapsible
- **SQL card** — collapsed by default, expandable with copy button
- **Cached badge** — `⚡ cached` appears inside bubble when `cached: true`
- **Suggestions** — clickable buttons that trigger cached query lookup

### InsightsChart

`components/insights/InsightsChart.tsx`

Supported chart types:

| Type | X-axis detection | Y-axis |
|---|---|---|
| `line` | Key containing "day", "week", "month", "date" | All numeric columns (single series) |
| `bar` | `category` or `normalized_merchant` | `total` or `amount` column |
| `horizontal_bar` | same as bar | same as bar |
| `comparison_bar` | `month` | `debits` and `credits` |
| `multi_bar` | `month` / `week` / `day` / `date` | All remaining numeric columns as grouped bar series |
| `pie` | `category` | `total` with `percentage` |
| `table` | — | All columns, max 20 rows |
| `none` | — | Not rendered |

Line chart uses `connectNulls={true}` to bridge sparse date sequences. Single-point line charts fall back to bar. `multi_bar` derives series keys dynamically from column names — used for the payment methods tab where column names vary by account.

---

## Voice Interface

`components/insights/InsightsPanel.tsx` (voice section)

### Connection Flow

1. `connectVoice()` — warmup mic → fetch ephemeral key → open WebSocket → send `session.update`
2. Greeting sent after mic connected via `response.create`
3. VAD detects speech → `input_audio_buffer.speech_started` → cancel timer, mute gain, send `response.cancel` + `conversation.item.truncate`
4. Transcription completed → store in `lastTranscriptRef`, start 500ms timer
5. Tool call fires → cancel timer, add user turn, call `handleQuery(question, undefined, true, true)`
6. Timer fires (no tool call) → conversational turn added
7. Tool result sent back → `response.create` if not in progress
8. `end_conversation` tool → 300ms delay → set `awaitingFarewellResponse` → `response.create`
9. `response.done` with `awaitingFarewellResponse` → promote to `shouldDisconnectAfterResponse` → disconnect after audio drains

### Voice vs Text Mode Differences

| Behaviour | Text mode | Voice mode |
|---|---|---|
| Text bubble | Shows streamed content | Suppressed (content = "") |
| Data card (SQL + chart) | Always shown | Always shown |
| Suggestions | Shown | Suppressed |
| Off-topic canned message | Shown | Suppressed (model handles via audio) |
| Audio playback | Optional via speaker button | Always on (via Realtime API) |
| Speaker button | Visible | Hidden |
| Input cleared after query | On submit | After transcript timer / tool call |

### Barge-in

- Server-side VAD with `interrupt_response: true` handles auto-cancellation
- Client-side: on `speech_started`, GainNode gain set to 0 (mutes buffered audio), `mutedItemId` set to skip in-flight deltas
- `conversation.item.truncate` sent with `audio_end_ms` = samples played × (1000/24000)
- `response.created` restores gain to 1 for the new response
- `response_cancel_not_active` errors suppressed silently

### Audio Pipeline

```
Mic → AudioWorklet (PCM 16kHz) → WebSocket → OpenAI
OpenAI → audio delta (PCM 24kHz) → AudioBufferSourceNode → GainNode → destination
```

- `audioSamplesPlayed` ref tracks playback position for truncation
- `currentAssistantItemId` ref tracks active item
- `lastAudioScheduledEndTimeRef` used for disconnect timing

---

## State Management

| Concern | Mechanism |
|---|---|
| Server data | SWR with `keepPreviousData: true` |
| Upload polling | `setInterval` every 1s |
| Selected account | `localStorage` + `AccountsContext` |
| Filter state | `useState` in `TransactionsPanel`, reset on account switch |
| Per-month balances | `useState` in `TransactionsPanel`, fetched from `/api/transactions/balances` on filter/account change |
| Analytics filters | `localStorage` per account per tab, restored on tab/account switch |
| Analytics active tab | `localStorage` under `oikos_analytics_active_tab` |
| Insights turns | `sessionStorage` per account, restored on mount and account switch |
| Date filter | `sessionStorage` per account |
| Voice refs | `useRef` (never causes re-renders) for WebSocket, AudioContext, timers, flags |
| Audio enabled | `useState` + `useRef` (ref used inside WebSocket closure to avoid stale closure) |

---

## Amendment Flow

1. Edit icon on transaction row opens `AmendTransactionModal`
2. Immutable fields shown read-only; editable: merchant, category, subcategory, payment method
3. Only changed fields submitted as amendments
4. `POST /api/transactions/[id]/amend` writes to `transaction_amendments`
5. If `normalized_merchant` changed and passes validation, `merchants` table upserted
6. Blue dot appears on row; SWR revalidates transaction list

---

## Upload Flow

1. Upload Statement button opens modal
2. SHA-256 hash computed client-side
3. `POST /api/upload` → `uploads` row created, CSV streamed to S3, Lambda invoked async
4. `setInterval` polls `GET /api/upload/{id}` every 1s
5. Modal shows: Uploading → Parsing → Normalising → Embedding → Complete
6. On complete: row count shown, balance warning badge if `balance_verified === false`
7. Modal auto-closes after 2s; `mutateTransactions()` and `mutateMonths()` called
8. Cancel during polling: `DELETE /api/upload/{id}` — 409 means race condition (upload just completed), modal transitions to success

---

## Upload History

`components/uploads/UploadHistoryModal.tsx`

- Opened via history clock icon on selected account in sidebar
- Table: filename · uploaded date · row count · balance badge · status badge · delete button
- Delete disabled for `pending`/`processing` uploads
- Confirm-to-delete flow with `DELETE /api/upload/{id}?force=true`
- After deletion: SWR global `mutate` revalidates all `/api/transactions*` caches
