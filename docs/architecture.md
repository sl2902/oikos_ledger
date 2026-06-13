# Oikos Ledger — Architecture

## Overview

Oikos Ledger has two primary runtimes connected by a shared PostgreSQL database:

- **Python (AWS Lambda)** — data ingestion, LLM-based normalisation, embedding generation, geolocation enrichment, insight computation, recommendation generation
- **Next.js (Vercel)** — user interface, authentication, Route Handlers, real-time dashboard queries

Both runtimes talk to the same Aurora PostgreSQL database. Python owns all writes; Next.js owns all reads.

---

## System Diagram

```
Browser
  │
  ▼
Next.js (Vercel)
  ├── App Router pages (React Server Components)
  ├── Route Handlers (API layer)
  └── Drizzle ORM ──────────────────────────────────────────────────────┐
                                                                         │
CSV upload ──► S3 bucket                                                 ▼
                 │                                               Aurora PostgreSQL
                 ▼                                               (Supabase in dev)
             Lambda                                                      ▲
             (ingestion pipeline)                                        │
               ├── parser                                                │
               ├── normalizer (Anthropic)                                │
               ├── embedder (OpenAI)                                     │
               ├── geocoder                                              │
               └── SQLModel ──────────────────────────────────────────┘
```

---

## Components

### Frontend — Next.js / Vercel

- App Router with route groups: `(auth)` for unauthenticated pages, `(dashboard)` for protected pages
- Drizzle ORM connects to Aurora/Supabase via the Transaction pooler connection string (`DATABASE_URL`)
- shadcn/ui component library with Tailwind CSS
- Route Handlers at `app/api/` serve all data to the frontend

**Constants layer** — `app/lib/constants/` holds reference data not yet stored in the database:
- `banks.ts` — 4 supported Indian banks (Axis Bank, HDFC Bank, ICICI Bank, State Bank of India), sorted lexicographically, with display names and domains. Each bank has a confirmed CSV export format and a deterministic parser planned for Iteration 2. Additional banks can be added when their CSV format is confirmed and a deterministic parser is implemented. Domain is used to fetch logos via the Google favicon API.
- `currencies.ts` — supported currencies with ISO code, display name, and symbol. Currently INR only; structured for multi-currency extension.

**Bank logos** — `BankLogo` component fetches from `https://www.google.com/s2/favicons?domain={domain}&sz=64`. No API key required. `onError` falls back to `public/fallback-bank-icon.svg`. Standard `<img>` (not `next/image`) is used so the `onError` handler fires correctly for cross-origin favicon responses.

### Authentication — NextAuth v5 (Auth.js)

- **Provider:** Google OAuth only — no email/password
- **Session strategy:** JWT (stateless). No `sessions` table exists in the database. The session is a signed JWT stored in a cookie; the server never reads a DB row to validate a request.
- **User provisioning:** On the first Google sign-in, the `signIn` callback checks whether a row exists in the `users` table (by email). If not, it creates one with `country_code = "IN"` and `currency = "INR"`. Subsequent sign-ins are no-ops.
- **Session enrichment:** The `jwt` callback stores the database `user.id` (UUID) in the JWT on initial sign-in. The `session` callback surfaces `session.user.id` for Route Handlers.
- **Middleware:** `middleware.ts` uses an edge-safe auth config (`auth.config.ts`, no `pg` imports) to protect routes. Unauthenticated requests to non-auth routes are redirected to `/login`. Authenticated users visiting `/login` are redirected to `/`.
- **Why not database sessions:** JWT sessions avoid an extra DB round-trip per request. The app is single-user (personal finance), so the simplicity of JWT outweighs the inability to invalidate individual sessions server-side.

**File layout:**
```
app/auth.config.ts          — edge-safe config (used by middleware)
app/auth.ts                 — full config (Google provider + DB callbacks)
app/middleware.ts           — protects /(dashboard)/* routes
app/app/api/auth/[...nextauth]/route.ts  — NextAuth route handler
```

### Ingestion Pipeline — AWS Lambda

Implemented in Iteration 2. Pipeline stages:

1. **`parsers/`** — one deterministic CSV parser per bank (`hdfc.py`, `sbi.py`, `icici.py`, `axis.py`). Each parser defines a `column_map` mapping canonical field names to possible CSV header variants. `parser.py` routes by `bank_name` with fallback header-signature detection.
2. **`normalizer.py`** — two-stage normalization:
   - Stage 1 (deterministic): `detect_payment_method()` classifies UPI/NEFT/IMPS/ATM/etc. For UPI, `parse_upi_narration()` extracts merchant, VPA, app, and counterparty bank via regex. `categorize_transaction()` scores 18 keyword categories.
   - Stage 2 (LLM): Only called when Stage 1 returns category "Other" or merchant is unknown. Uses Claude Haiku via `anthropic.AsyncAnthropic`. Concurrent via `asyncio.gather` with semaphore cap of 5.
   - ~70-80% of Indian transactions match deterministic rules; LLM cost is proportionally low.
3. **`embedder.py`** — batched `text-embedding-3-small` calls via OpenAI. Batch size 100. Falls back to zero vector on error.
4. **`geocoder.py`** — stub returning None. Implemented in Iteration 5.
5. **`balance_verifier.py`** — runs after CSV parsing, before normalization. Verifies that closing balances are mathematically consistent row by row (tolerance: ₹0.01 for rounding). Opening balance is derived from the first row: `first_closing + first_debit - first_credit`. On failure the upload proceeds; the discrepancy is flagged in the UI. Results (`opening_balance`, `closing_balance`, `balance_verified`, `balance_discrepancy`) are stored on the `uploads` row.
6. **`lambda_handler.py`** — orchestrates all stages. Implements idempotency guard (aborts if upload status is not `pending`). Supports `local_file_path` event key for testing without S3.

Lambda is triggered asynchronously by the Next.js upload Route Handler after the CSV is stored in S3. When AWS is not configured, the Route Handler creates the upload row and skips S3/Lambda gracefully.

**Source attribution:** `constants.py`, `upi_parser.py`, `categorizer.py`, `parsers/base.py` are adapted from [statementsparser](https://github.com/iharshlalakiya/statementparser) by Harsh Lalakiya (MIT License).

### Database — Aurora PostgreSQL (Supabase in development)

**Current provider:** Supabase is used during development while AWS credits are pending. Aurora PostgreSQL replaces it in production. The switch requires only changing connection strings in environment variables — no code changes.

**Extensions:**
- **pgvector** — `VECTOR(1536)` columns on `transactions.embedding`, `merchants.embedding`, and `query_cache.query_embedding`. Enables cosine similarity search for semantic transaction lookup and cache hit detection.
- **PostGIS** — `GEOMETRY(Point, 4326)` columns on `transactions.location` and `merchants.location`. Enables radius and bounding-box geospatial queries on merchant and transaction positions.

**Connection strategy:**

| Context | Connection string | Pooler |
|---|---|---|
| Scripts and local development | `DATABASE_URL_DIRECT` | Session pooler (port 5432) — IPv4 compatible, supports extended query protocol |
| Lambda (production) | `DATABASE_URL` | RDS Proxy (Aurora) / Transaction pooler (Supabase, port 6543) — serverless compatible |
| Next.js Route Handlers | `DATABASE_URL` | Transaction pooler (port 6543) — serverless compatible |

The Session pooler is required for scripts because SQLAlchemy uses the extended query protocol, which the Transaction pooler does not support.

### File Storage — AWS S3

Not yet provisioned. Planned:
- Raw CSV uploads stored under a per-user prefix
- Lifecycle policy to expire raw uploads after 90 days
- Lambda reads from S3 using the object key passed by the Route Handler

---

## Data Flow

### CSV upload and ingestion (planned — Iteration 1)

1. User selects a CSV file in the browser
2. Next.js `POST /api/upload` receives the file, streams it to S3, records the upload in the `uploads` table, and asynchronously invokes Lambda
3. Lambda downloads the file from S3 and runs parser → normalizer → embedder → geocoder → recommender
4. Lambda writes transactions, merchants, embeddings, insights, and recommendations to Aurora
5. Lambda updates `uploads.status` to `complete` (or `failed`)

### Dashboard query and render (planned — Iteration 2)

1. Browser requests the dashboard page
2. Next.js Route Handlers query Aurora via Drizzle for transactions, insights, and recommendations
3. RSC renders the page with data; client components handle interactivity

---

## Key Design Decisions

| Decision | ADR |
|---|---|
| Aurora PostgreSQL over Aurora DSQL and DynamoDB | [ADR 001](adr/001_aws_database_choice.md) |
| AWS Lambda over FastAPI for ingestion | [ADR 002](adr/002_lambda_vs_fastapi.md) |
| Drizzle ORM over raw pg client | [ADR 003](adr/003_drizzle_vs_raw_pg.md) |
| SQLModel + Drizzle instead of a single ORM | [ADR 004](adr/004_two_schema_approach.md) |
| Deterministic bank-specific parsers over LLM-based format detection | [ADR 005](adr/005_deterministic_parser.md) |
| Full pipeline idempotency at the database level | [ADR 006](adr/006_idempotency.md) |
| Two-stage normalization — deterministic first, LLM second | [ADR 007](adr/007_two_stage_normalization.md) |
