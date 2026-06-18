# Oikos Ledger — Security

## Transmission Security

All data in transit is encrypted via TLS.

| Path | Mechanism |
|---|---|
| Browser → Vercel | HTTPS enforced; HTTP redirected automatically by Vercel |
| Browser → OpenAI Realtime API | WSS (WebSocket Secure) — ephemeral key fetched server-side, expires in 60s |
| Next.js → Aurora | TLS on all PostgreSQL connections via `sslmode=require` |
| Next.js → S3 | HTTPS via AWS SDK (cannot be disabled) |
| Next.js → OpenAI API | HTTPS |
| Lambda → Aurora | TLS on all PostgreSQL connections |
| Lambda → S3 | HTTPS via AWS SDK |

---

## Storage Security

### S3 (CSV uploads)

Bucket: `oikos-ledger-uploads`

| Setting | Value |
|---|---|
| Default encryption | SSE-S3 (AES-256, AWS-managed keys) |
| Per-object encryption | `ServerSideEncryption: "AES256"` set on every `PutObject` call |
| Public access | Fully blocked — all four "Block Public Access" settings enabled |
| Bucket versioning | Disabled |

CSV files are the most sensitive data in the system. Stored in S3 for Lambda processing only; never served back to users.

### Database — Development (Aurora PostgreSQL)

Aurora PostgreSQL encrypts data at rest by default (AES-256, AWS KMS with AWS-managed keys). This applies to storage volumes, snapshots, read replicas, and automated backups.

Previously used Supabase free tier (no encryption at rest) — now replaced by Aurora for all environments.

### Query Cache

Cached query results stored in `query_cache` table include SQL queries and result data scoped to `user_id` and `account_id`. Cache entries expire after 24 hours and are only accessible to the authenticated user who created them.

---

## Authentication and Authorisation

### User Authentication

- Google OAuth via NextAuth v5 (Auth.js)
- JWT session strategy — no session tokens stored in the database
- JWT signed with `AUTH_SECRET` — must be rotated in production
- Sessions expire per NextAuth default (30 days)

### Voice Session Security

- OpenAI Realtime API ephemeral keys fetched server-side via `POST /api/insights/session`
- Ephemeral key expires in 60 seconds — client must connect immediately
- Full OpenAI API key never exposed to the browser
- Session creation requires authenticated session

### API Authorisation

- Every Route Handler calls `auth()` and rejects unauthenticated requests with `401`
- All database queries filter by `user_id` extracted from the verified session
- Users can only access their own data — no cross-user data path
- `account_id` in requests validated against the authenticated user — users cannot query another user's account

### AWS Credentials

- IAM credentials stored in environment variables, never committed to version control
- `.env.local` is in `.gitignore`
- Lambda uses an IAM execution role — no hardcoded credentials in Lambda code

---

## Data Privacy

### What Is Stored

| Data | Location |
|---|---|
| Email address (from Google OAuth) | `users` table |
| Bank account metadata (bank name, type, nickname) | `bank_accounts` table |
| Transaction data: date, merchant name, amount, category | `transactions` table |
| Raw bank narration strings | `transactions.raw_description` |
| Transaction embeddings (vector representations) | `transactions.embedding` |
| Uploaded CSV files | S3 (encrypted at rest, 90-day expiry planned) |
| NL query cache with SQL and results | `query_cache` table |

### What Is Not Stored

- Bank account numbers
- Passwords or PINs
- Bank statement PDFs
- Raw CSV content in the database (S3 only)
- Google OAuth tokens (NextAuth does not persist these)
- Voice audio recordings (streamed to OpenAI Realtime API; not persisted)

### Data Minimisation

- Bank account number never stored anywhere in the system
- Embeddings are mathematical representations and cannot be reversed to recover raw text
- Query cache scoped per user and account; expires in 24 hours

---

## Known Security Gaps

| # | Gap | Risk | Mitigation / Fix |
|---|---|---|---|
| 1 | `rejectUnauthorized: false` for Aurora SSL | Certificate not verified — encrypted but not authenticated | Bundle `global-bundle.pem` in Lambda Docker image and Vercel repo |
| 2 | No rate limiting on API routes | Upload endpoint could be abused | Add rate limiting middleware before production launch |
| 3 | No file content validation beyond extension check | Malicious file uploaded as CSV | Lambda handles parsing errors gracefully; no execution of uploaded content |
| 4 | `AUTH_SECRET` rotation not enforced | If compromised, all active sessions affected | Rotate secret; all sessions automatically invalidated |
| 5 | No audit log for data access | No visibility into who accessed what | `transaction_amendments` provides a partial trail; full access logging is a future feature |
| 6 | No RDS Proxy | Lambda uses long-lived IAM credentials with direct Aurora connections | Add RDS Proxy for production |
| 7 | OpenAI API key in environment variable | If Vercel environment is compromised, key is exposed | Use secrets manager (AWS Secrets Manager or Vercel secrets) for production |

---

## Compliance Notes

**PCI DSS** — Not applicable. No payment card processing occurs.

**RBI data localisation** — Data stored on AWS `ap-south-1` (Mumbai region), satisfying Indian data residency requirements.

**DPDP Act (India)** — Data deletion (right to erasure) and explicit consent management are planned features, not yet implemented. Full compliance requires these before any public launch.
