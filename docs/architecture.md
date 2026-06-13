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

**Flow**

```
S3 upload → Lambda → Parse CSV → Balance Verify →
Normalize (Deterministic + LLM) → Embed → Write Aurora
```

**Stage 1: CSV Parsing**

- Bank-specific parsers per supported bank
- HDFC parser overrides `base.parse_csv()` to handle narrations with embedded commas (HDFC exports unquoted fields even when narration contains commas)
- Each parsed row assigned a `row_number` — original CSV position used for intra-day ordering
- Closing balance extracted per row for balance verification

**Stage 2: Balance Verification**

- Runs after parsing, before normalization
- Computes opening balance from first row: `opening = first_closing + first_debit - first_credit`
- Verifies each row: `previous_closing ± amount = current_closing`
- Tolerance: ±₹0.01 for floating point rounding
- Results stored in `uploads` table: `opening_balance`, `closing_balance`, `balance_verified`, `balance_discrepancy`
- Verification failure does not reject the upload — flagged in UI with yellow warning badge

**Stage 3: Normalization (Two-Stage)**

*Deterministic path (runs first):*

- Payment gateway detection — regex matches `{ALPHANUM}/{GATEWAY_PREFIX}{MERCHANT}` pattern. Known prefixes: RAZP, PAYU, CCAV, CSHFRE, PAYTM etc. Built dynamically from `PAYMENT_GATEWAY_PREFIXES` sorted longest-first to avoid partial matches
- Bill payment override — `IB BILLPAY DR` pattern matched before LLM. Biller code extracted and mapped to merchant name. Always returns Finance/Credit Card, `needs_llm=False`
- Payment method detection — keyword patterns per method
- UPI parsing — extracts merchant, VPA, app, bank from HDFC dash-separated UPI format
- Keyword categorization — scoring-based, longest match wins. UPI transactions with no keyword match default to Transfer
- Subcategory detection — keyword map per subcategory

*LLM path (only when `needs_llm=True`):*

- Merchant registry lookup by extracted merchant name using `ILIKE` partial match
- Registry hit → return stored values, no LLM call
- Registry miss → call LLM (`gpt-4o-mini`, `temperature=0`)
- Deterministic categorization always overrides LLM category when deterministic returns non-Other result
- Upsert result into `merchants` table

**Stage 4: Embedding**

- OpenAI `text-embedding-3-small`
- 1536 dimensions — matches pgvector column
- Batch of 100 transactions per API call

**Stage 5: Database Write**

- `INSERT ... ON CONFLICT DO NOTHING` for idempotency
- Two unique constraints: `reference_number` and `(date, amount, merchant)`
- Closing balance written per transaction row
- Row number preserved for display ordering

**Normalization Known Limitations**

- Indian bank narrations are unstructured and inconsistent
- Same merchant appears differently across payment methods: `UPI-SWIGGY-...`, `K4UXS7/PAYUSWIGGYIN`, `PAYTMSWIGGYCOM`
- Gateway+merchant+domain concatenated without separators: `PAYTMSWIGGYCOM` — no reliable way to split without merchant whitelist
- BESCOM exception: `COM` is part of company name, not domain suffix — hardcoded exception required
- Numeric prefixes in UPI merchant names stripped via regex
- LLM `temperature=0` for deterministic results but registry may have stale entries from previous runs

Lambda is triggered asynchronously by the Next.js upload Route Handler after the CSV is stored in S3. When AWS is not configured, the Route Handler creates the upload row and skips S3/Lambda gracefully.

**Source attribution:** `constants.py`, `upi_parser.py`, `categorizer.py`, `parsers/base.py` are adapted from [statementsparser](https://github.com/iharshlalakiya/statementparser) by Harsh Lalakiya (MIT License).

### Database — Aurora PostgreSQL (Supabase in development)

**Current provider:** Supabase is used during development while AWS credits are pending. Aurora PostgreSQL replaces it in production. The switch requires only changing connection strings in environment variables — no code changes.

**Cluster:** oikos-ledger (ap-south-1) — Aurora PostgreSQL Serverless v2
- Min ACU: 0 (dev) — set to 0.5 before demo
- Max ACU: 4
- Extensions: pgvector, postgis, pg_trgm
- SSL: `rejectUnauthorized=false` (CA cert path issues in Lambda container) — TODO: configure `global-bundle.pem` for production
- Direct connection (no RDS Proxy) — acceptable for hackathon scale. RDS Proxy documented as production scaling strategy in ADR

**Extensions:**
- **pgvector** — `VECTOR(1536)` columns on `transactions.embedding`, `merchants.embedding`, and `query_cache.query_embedding`. Enables cosine similarity search for semantic transaction lookup and cache hit detection.
- **PostGIS** — `GEOMETRY(Point, 4326)` columns on `transactions.location` and `merchants.location`. Enables radius and bounding-box geospatial queries on merchant and transaction positions.
- **pg_trgm** — trigram similarity index. Planned for fuzzy merchant name matching once the registry has sufficient entries.

**Connection strategy:**

| Context | Connection string | Pooler |
|---|---|---|
| Scripts and local development | `DATABASE_URL_DIRECT` | Session pooler (port 5432) — IPv4 compatible, supports extended query protocol |
| Lambda (production) | `DATABASE_URL` | RDS Proxy (Aurora) / Transaction pooler (Supabase, port 6543) — serverless compatible |
| Next.js Route Handlers | `DATABASE_URL` | Transaction pooler (port 6543) — serverless compatible |

The Session pooler is required for scripts because SQLAlchemy uses the extended query protocol, which the Transaction pooler does not support.

### Lambda

- **Runtime:** Python 3.12 container image
- **Memory:** 512 MB — **Timeout:** 300 s
- **ECR:** `oikos-ledger-ingestion` (ap-south-1)
- **Environment variables:** `DATABASE_URL`, `OPENAI_API_KEY`, `NORMALIZER_PROVIDER`, `NORMALIZER_MODEL`, `NORMALIZER_MAX_CONCURRENCY`, `AWS_S3_BUCKET`
- `AUTH_SECRET` is optional with an empty default (used by Next.js only, not Lambda)
- `AWS_LAMBDA_FUNCTION_NAME` is a reserved key — not set via CLI

### Deployment

`./scripts/deploy_lambda.sh`:

1. Builds Docker image from `ingestion/Dockerfile`
2. Pushes to ECR
3. Updates Lambda function code
4. Updates environment variables (single `--environment` flag with all vars on one line — no newlines, which Lambda CLI rejects)
5. Uses `--output text --query` to suppress verbose JSON output

### File Storage — AWS S3

- Raw CSV uploads stored under a per-user prefix
- Lambda reads from S3 using the object key passed by the Route Handler
- Lifecycle policy to expire raw uploads after 90 days (planned)

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
