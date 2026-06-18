# Oikos Ledger — Project Plan

## Overview

Oikos Ledger is a personal finance intelligence app for Indian bank account holders. Users upload bank CSV exports, and the app normalises, enriches, and analyses transactions using LLMs, pgvector semantic search, and macroeconomic context from RBI/World Bank data to produce actionable recommendations.

**Hackathon:** AWS + Vercel Hackathon — Track 1 B2C  
**Deadline:** 29 June 2026

## Iterations

| # | Name | Status |
|---|------|--------|
| 0 | Foundation — environment, data model, database, scripts | **Complete** (2026-06-10) |
| 1 | User auth and account setup — Google OAuth, JWT sessions, bank account CRUD | **Complete** (2026-06-10) |
| 2 | CSV ingestion pipeline — parser, normalizer, embedder, balance verification | **Complete** |
| 3 | Transaction display — dashboard, list view, filters, amendments | **Complete** |
| 4 | Spending insights — agentic NL→SQL, voice interface, chart rendering | **Complete** |
| 5 | AI recommendations — RBI benchmark comparison, LLM cards, voice | **In Progress** |
| 6 | Demo prep — seed data, Aurora scaling, video, Devpost write-up | Planned |

---

## Iteration 0 — Foundation

**Goal:** Get everything needed to start building in place. No application features.

**Deliverables:**
- Python environment configured with `uv` and `pyproject.toml`
- Next.js app initialised with App Router, TypeScript, Tailwind CSS, shadcn/ui, Drizzle ORM
- Supabase as the PostgreSQL provider for development; Aurora PostgreSQL for production
- All 13 SQLModel tables created via `scripts/create_tables.py`
- Drizzle schema mirrors all 13 tables in TypeScript
- `.env.local` wired to Supabase connection strings
- `pydantic-settings` config module with validated settings at startup
- All Iteration 0 DoD checks pass

**Definition of Done:**
- [x] `uv sync` installs all Python dependencies without errors
- [x] `npm install` in `app/` installs all Node dependencies without errors
- [x] `python scripts/test_connection.py` shows pgvector and PostGIS active on Supabase
- [x] `python scripts/create_tables.py` creates all 13 tables without errors
- [x] `python scripts/drop_tables.py` drops all tables after confirmation
- [x] `python scripts/create_tables.py` runs again cleanly after drop
- [x] `npm run dev` starts Next.js on localhost:3000 without errors
- [x] Drizzle client connects to Supabase without errors on app start
- [x] All 13 tables visible in Supabase table editor

### Deviations and Notes

- **`pydantic-settings` added; `python-dotenv` removed** — a centralised `Settings` class with startup validation was chosen over ad-hoc `os.getenv()` calls. All environment variables are validated when the ingestion layer first imports `ingestion.config`.

- **Supabase is the current database provider** — Aurora PostgreSQL will replace it when AWS credits arrive. The switch requires only changing `DATABASE_URL` and `DATABASE_URL_DIRECT` in `.env.local`; no code changes are needed.

- **Session pooler used for scripts and local development** — Supabase's Transaction pooler does not support the extended query protocol needed by SQLAlchemy. Scripts use the Session pooler endpoint (port 5432) which is IPv4 compatible. Lambda and Next.js Route Handlers use the Transaction pooler (port 6543) which is serverless compatible.

- **`drizzle-orm` updated to latest** — resolved SQL injection vulnerability GHSA-gpj5-g38j-94v9 present in the initially installed version.

- **`esbuild` and `postcss` vulnerabilities deferred** — fixes require a breaking Next.js version downgrade. Noted and deferred until upstream Next.js ships a resolution.

- **`spatial_ref_sys` is a PostGIS system table** — it appears in the Supabase table editor alongside the 13 custom tables but is not part of the Oikos Ledger schema. 13 custom tables confirmed correct.

---

## Iteration 1 — User Auth and Account Setup

**Goal:** Users can sign up, sign in with Google, and create bank accounts. The authenticated shell of the app is in place.

**Deliverables:**
- NextAuth v5 with Google OAuth, JWT session strategy
- User row auto-created in `users` table on first Google sign-in
- `app/auth.ts` — central NextAuth config with signIn/jwt/session callbacks
- `app/auth.config.ts` — edge-safe config for middleware
- `app/middleware.ts` — protects dashboard routes, redirects to `/login`
- Login page at `/login` — centered card, "Continue with Google" button
- Dashboard layout — sidebar with nav, user avatar, sign out
- Empty state pages: `/insights`, `/recommendations`, `/macro`
- `POST /api/bank_accounts` — create bank account
- `GET /api/bank_accounts` — list user's bank accounts
- `AddBankAccountModal` — shadcn Dialog form component
- Drizzle queries: `getUserByEmail`, `createUser`, `getBankAccountsByUserId`, `createBankAccount`
- `scripts/seed_categories.py` — idempotent category seeder (10 top-level, 35 subcategories)
- `app/lib/constants/banks.ts` — 4 supported Indian banks with domains for favicon lookup
- `app/lib/constants/currencies.ts` — INR with symbol, structured for multi-currency extension
- `app/components/bank_accounts/BankLogo.tsx` — favicon-backed logo with SVG fallback

**Definition of Done:**
- [x] `npm run dev` starts without errors
- [x] Visiting `http://localhost:3000` redirects to `/login`
- [x] Login page shows "Continue with Google" button
- [x] Clicking redirects to Google OAuth consent screen
- [x] After sign-in, user is redirected to dashboard
- [x] New user row created in `users` table on first sign-in
- [x] Dashboard shows welcome message with user's name
- [x] "Add bank account" modal opens and submits successfully
- [x] Bank account row created in `bank_accounts` table
- [x] GET `/api/bank_accounts` returns the created account
- [x] Signing out redirects to `/login`
- [x] `python scripts/seed_categories.py` populates the `categories` table

### Deviations and Notes

- **SQLModel `server_default` pattern applied to all models (unplanned)** — `default_factory=uuid4` and `default_factory=datetime.utcnow` do not produce PostgreSQL column-level `DEFAULT` expressions in `CREATE TABLE` DDL. All `id` columns now use `server_default=text("gen_random_uuid()")` and all `created_at`/`updated_at` columns use `server_default=text("timezone('utc', now())")`. This ensures the database enforces defaults for inserts from any client, not just Python.

- **Clearbit favicon API rejected** — Clearbit's logo API (`logo.clearbit.com`) was evaluated for bank logos but returned 404 for all 10 Indian bank domains tested. Replaced with the Google favicon API (`https://www.google.com/s2/favicons?domain={domain}&sz=64`), which returned correct logos for all 10 banks. No API key required.

- **Radix UI `SelectValue` limitation worked around** — `SelectValue` does not reliably render complex JSX children (e.g. logo + text) from `SelectItem`. The bank name trigger uses a conditional render: a custom `<span>` with `BankLogo` when a value is selected, `<SelectValue placeholder>` when not. The currency trigger uses an IIFE inside `SelectValue` children to format the selected currency string.

- **`drizzle-orm` security update** — updated to resolve SQL injection vulnerability GHSA-gpj5-g38j-94v9. Applied during Iteration 1 setup; no API changes required.

---

## Iteration 2 — CSV Ingestion Pipeline

**Goal:** Upload a CSV from the UI, store it in S3, trigger Lambda, and parse rows into the `transactions` table.

**Scope note:** Deterministic CSV parsers built for Axis Bank, HDFC Bank, ICICI Bank, and State Bank of India only — the four banks with confirmed CSV export formats.

**Deliverables:**
- `ingestion/pipeline/constants.py` — date formats, UPI VPA/IFSC mappings, payment patterns, 18-category keyword lists (adapted from statementsparser, MIT)
- `ingestion/pipeline/upi_parser.py` — UPI narration parser; extracts merchant, VPA, app, counterparty bank, reference
- `ingestion/pipeline/categorizer.py` — scoring-based keyword categorization and payment method detection
- `ingestion/pipeline/parsers/base.py` — abstract `BaseCSVParser` with header detection and amount cleaning
- `ingestion/pipeline/parsers/hdfc.py`, `sbi.py`, `icici.py`, `axis.py` — bank-specific parsers with column maps
- `ingestion/pipeline/parser.py` — router with fallback header-based bank detection
- `ingestion/pipeline/normalizer.py` — two-stage: deterministic first, LLM (`gpt-4o-mini`) only for unknowns
- `ingestion/pipeline/embedder.py` — OpenAI `text-embedding-3-small`, batched, zero-vector fallback
- `ingestion/pipeline/geocoder.py` — stub returning None
- `ingestion/db/client.py` — `write_transactions` (ON CONFLICT DO NOTHING), `update_upload_status`, `get_upload`
- `ingestion/lambda_handler.py` — full pipeline orchestrator; supports `local_file_path` for testing without S3
- `app/app/api/upload/route.ts` — SHA-256 dedup, S3 upload (graceful skip), Lambda invoke (graceful skip)
- `app/app/api/upload/[upload_id]/route.ts` — status polling endpoint
- `app/app/api/transactions/route.ts` — paginated transaction list by account
- `app/components/uploads/UploadStatementModal.tsx` — file select, upload, status polling, completion
- `app/components/transactions/TransactionList.tsx` — date/merchant/category/amount/method table with pagination

**Definition of Done:**
- [x] `python -m pytest ingestion/tests/test_parser.py` passes (12 tests)
- [x] `python -m pytest ingestion/tests/test_normalizer.py` passes (14 tests)
- [x] `python -m pytest ingestion/tests/test_embedder.py` passes (5 tests)
- [x] HDFC CSV parsing works correctly via direct script invocation
- [x] Normalization pipeline runs end to end locally — transactions visible in Aurora
- [x] Upload status transitions work correctly
- [x] Duplicate file detection works — same file rejected with 409
- [x] Transaction list visible in dashboard after upload
- [x] Debit amounts shown in red, credits in green
- [x] Payment method badge visible per transaction
- [x] `docs/architecture.md` updated
- [x] `docs/adr/007_two_stage_normalization.md` created
- [x] `docs/security.md` created
- [x] S3 `PutObjectCommand` hardened with explicit `ServerSideEncryption: "AES256"`

### Deviations and Notes

- **Dashboard split into Server + Client Components** — `page.tsx` is a Server Component that calls `auth()` for the welcome message; `DashboardClient.tsx` holds the `useState` for selected account.
- **Payment method derived from `raw_description` on the frontend** — the `transactions` table has no `payment_method` column. The TransactionList component derives the badge from the raw narration string.
- **Lambda not yet configured** — S3 upload and Lambda invocation are implemented but gracefully skipped when AWS credentials are absent. Local testing: `python -m ingestion.lambda_handler <upload_id> <account_id> <user_id> <bank_name> <path/to/file.csv>`.
- **End-to-end local test result** — 8 rows parsed, 8 normalized, 8 embedded (OpenAI), 6 inserted, 2 skipped (duplicate reference numbers). 43 total transactions visible after test.

---

## Iteration 3 — Transaction Display

**Goal:** Authenticated users can view, filter, search, and amend their uploaded transactions.

**Deliverables:**
- Paginated transaction list with date, merchant, category, amount, payment method columns
- Filter bar: search, category, payment method, amount range, month tabs, custom date range
- Month heading with opening balance, debits, credits, closing balance, balance verification badge
- Amendment modal — correct merchant, category, subcategory, payment method
- Amendment audit trail (`transaction_amendments` table)
- Merchant registry feedback loop — user corrections update `merchants` table
- Upload history modal with force-delete
- Account ordering by most recent upload
- Month-level credit/debit aggregates in month heading

**Definition of Done:**
- [x] Transaction list renders with all columns
- [x] Filter bar filters correctly by all dimensions
- [x] Amendment modal opens, submits, and updates transaction display
- [x] Balance verification badge shown when `balance_verified === false`
- [x] Upload history shows all uploads with status and delete
- [x] Force-delete cascades amendments → transactions → upload row
- [x] Accounts ordered by most recent upload

---

## Iteration 4 — Spending Insights and Voice Interface

**Goal:** Natural language querying of transaction data via text and voice, with automatic chart rendering.

**Architecture:**
- Agentic `runAgentLoop` with `run_sql` tool (replaces classify → generateSQL two-step)
- Two-tier cache: exact SHA-256 hash → pgvector similarity (threshold 0.85)
- OpenAI Realtime API (`gpt-realtime-2`) for voice with VAD, barge-in, tool calling
- Pre-built intents bypass agent: monthly trend, biggest expenses, credits vs debits, top merchants, spending by category

**Definition of Done:**
- [x] Insights page with text chat interface and SSE streaming
- [x] Agentic NL→SQL with `run_sql` tool — LLM decides whether to query or clarify
- [x] Agent returns `chart_type` as structured tool parameter (line, bar, horizontal_bar, comparison_bar, pie, table, none)
- [x] Auto chart rendering based on result shape
- [x] Two-tier query cache with pgvector similarity suggestions
- [x] Voice interface — OpenAI Realtime API WebSocket
- [x] VAD barge-in with `conversation.item.truncate` and GainNode mute
- [x] `end_conversation` tool with farewell flow and timed disconnect
- [x] Voice data cards (SQL + chart/table) shown in UI during voice session
- [x] Conversation history persisted per account in sessionStorage
- [x] Date filter with persistence across navigation
- [x] Off-topic guardrail in voice system prompt
- [x] Current year injected into agent prompt (prevents year hallucination)
- [x] `net` column removed from monthly trend pre-built intent

### Deviations and Notes

- **Classify → generateSQL replaced by agentic loop** — the original two-step approach lost context on follow-up queries. The `runAgentLoop` function sends the full conversation history with a `run_sql` tool; the LLM decides when to query and asks for clarification when ambiguous.
- **`chart_type` as tool parameter** — initial approach tried to infer chart type from column names (`inferChartType`), which was too brittle for aliased columns. Chart type is now a required structured parameter in the `run_sql` tool schema; the agent always specifies it.
- **Voice audio gate** — `audioEnabled` state causes stale closure in WebSocket handlers. Added `audioEnabledRef` (`useRef`) to read current value inside closures without re-renders.
- **Barge-in** — `response.cancel` alone is insufficient. `conversation.item.truncate` required to sync server state. GainNode mute + `mutedItemId` ref handles client-side in-flight chunks.
- **OpenAI proxy token limit** — dataexpert.io proxy has monthly token limits. When exhausted, falls back to direct `api.openai.com` by unsetting `OPENAI_BASE_URL`.

---

## Iteration 5 — AI Recommendations (In Progress)

**Goal:** On-demand personalised spending recommendations benchmarked against RBI/HCES 2022-23 data, accessible via text and voice on a dedicated page.

**Architecture:**
- New page: `/app/recommendations`
- New route: `POST /api/recommendations`
- RBI/HCES 2022-23 household expenditure benchmarks hardcoded as reference dataset
- On demand: compute user's spending % by category → compare to benchmarks → LLM generates 3-5 recommendation cards
- Voice: same OpenAI Realtime API pattern as insights, recommendations context in system prompt

**RBI/HCES benchmarks (% of total household expenditure):**
- Food & beverages: 46%
- Transport: 11%
- Health: 6%
- Education: 4%
- Entertainment/recreation: 2%
- Clothing: 5%
- Housing: 10%
- Miscellaneous: 16%

**Deliverables:**
- [ ] `app/app/recommendations/page.tsx`
- [ ] `app/components/recommendations/RecommendationsPanel.tsx`
- [ ] `app/components/recommendations/RecommendationCard.tsx`
- [ ] `app/app/api/recommendations/route.ts`
- [ ] Voice interface on recommendations page
- [ ] Benchmark comparison logic with delta calculation
- [ ] LLM-generated recommendation cards (streamed)
- [ ] Status indicator per card (above/below/on-track)

---

## Iteration 6 — Demo Prep

**Goal:** App is polished, seeded, and ready for judges.

**Deliverables:**
- [ ] `scripts/seed_db.py` — realistic demo transaction data across 3 months
- [ ] Aurora min ACU set to 0.5
- [ ] Parser-level category normalisation (Health vs Medical)
- [ ] Category dropdown fetching from DB (currently hardcoded)
- [ ] Dashboard persistence filter bug fixed (active account + date filter)
- [ ] Demo video recording
- [ ] Devpost submission write-up

---

## Out of Scope (current phase)

- Multi-currency conversion
- Mobile app
- Shared / family accounts
- Export to CSV / PDF
- RDS Proxy (documented as production scaling strategy)
- `pg_trgm` fuzzy merchant matching
- Fine-tuned normalisation model
- Multi-series chart pivoting (time + dimension + value)
