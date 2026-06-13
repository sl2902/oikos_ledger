# Security

This document describes the current security posture of Oikos Ledger, including
transmission security, storage security, authentication, data privacy, known gaps,
and compliance notes.

---

## Transmission Security

All data in transit is encrypted via TLS.

| Path | Mechanism |
|------|-----------|
| Browser → Vercel | HTTPS enforced; HTTP redirected automatically by Vercel |
| Next.js → Supabase/Aurora | TLS on all PostgreSQL connections via `sslmode=require` in connection string |
| Next.js → S3 | HTTPS via AWS SDK (default; cannot be disabled) |
| Lambda → Supabase/Aurora | TLS on all PostgreSQL connections via `sslmode=require` |
| Lambda → S3 | HTTPS via AWS SDK |

No unencrypted transmission paths exist in the architecture.

---

## Storage Security

### S3 (CSV uploads)

Bucket: `oikos-ledger-uploads`

| Setting | Value |
|---------|-------|
| Default encryption | SSE-S3 (AES-256, AWS-managed keys) — configured in AWS console |
| Per-object encryption | `ServerSideEncryption: "AES256"` set on every `PutObject` call — enforced in code regardless of bucket default |
| Public access | Fully blocked — all four "Block Public Access" settings enabled |
| Bucket versioning | Disabled |
| Bucket policy | Private; accessible only via IAM credentials |

CSV files are the most sensitive data in the system — they contain raw bank statement
narrations including merchant names and amounts. They are stored in S3 for Lambda
processing only and are never served back to users.

### Database — Development (Supabase free tier)

Supabase free tier does not encrypt data at rest. This is a known gap.

Mitigation: Supabase is used for development only. The production path uses Aurora
PostgreSQL, which encrypts at rest by default.

### Database — Production (Aurora PostgreSQL)

| Setting | Value |
|---------|-------|
| Encryption at rest | Enabled at cluster creation (AES-256) |
| Coverage | Storage volumes, snapshots, read replicas, automated backups |
| Key management | AWS KMS with AWS-managed keys |

---

## Authentication and Authorization

### User Authentication

- Google OAuth via NextAuth v5 (Auth.js)
- JWT session strategy — no session tokens stored in the database
- JWT signed with `AUTH_SECRET` — must be rotated in production
- Sessions expire per NextAuth default (30 days)

### API Authorization

- Every Route Handler calls `auth()` and rejects unauthenticated requests with `401`
- All database queries filter by `user_id` extracted from the verified session
- Users can only access their own data — there is no cross-user data path
- No admin interface exists; no elevated privilege paths

### AWS Credentials

- IAM credentials stored in environment variables, never committed to version control
- `.env.local` is in `.gitignore`
- Lambda uses an IAM execution role — no hardcoded credentials in Lambda code
- S3 bucket policy restricts access to the specific IAM user or role

---

## Data Privacy

### What Is Stored

| Data | Location |
|------|----------|
| Email address (from Google OAuth) | `users` table |
| Bank account metadata (bank name, account type, nickname) | `bank_accounts` table |
| Transaction data: date, merchant name, amount, category | `transactions` table |
| Raw bank narration strings | `transactions.raw_description` |
| Transaction embeddings (vector representations) | `transactions.embedding` |
| Uploaded CSV files | S3 (encrypted at rest) |

### What Is Not Stored

- Bank account numbers — only bank name and account type are stored
- Passwords or PINs
- Full bank statement PDFs
- Raw CSV files in the database — only in S3
- Google OAuth tokens — NextAuth does not persist these

### Data Minimization

- Bank account number is never stored anywhere in the system
- CSV files in S3 are used for Lambda processing only — not served to users
- Embeddings are mathematical representations and cannot be reversed to recover raw text

---

## Known Security Gaps

These are documented honestly as production hardening items.

| # | Gap | Risk | Mitigation |
|---|-----|------|------------|
| 1 | Supabase free tier has no encryption at rest | Development data is unencrypted on disk | Development only; switch to Aurora for production |
| 2 | No rate limiting on API routes | Upload endpoint could be abused | Add rate limiting middleware before production launch |
| 3 | No file content validation beyond `.csv` extension check | Malicious file uploaded as CSV | Lambda handles parsing errors gracefully; no execution of uploaded content |
| 4 | `AUTH_SECRET` rotation not enforced | If compromised, all active sessions are compromised | Rotate secret; all sessions are automatically invalidated |
| 5 | No audit log for data access | No visibility into who accessed what data | `transaction_amendments` table provides a partial trail; full access logging is a future feature |
| 6 | S3 presigned URLs not implemented | Lambda accesses S3 via long-lived IAM credentials | Use presigned URLs with short expiry for Lambda access — future hardening item |

---

## Compliance Notes

Oikos Ledger is not currently compliant with the following standards. This is
expected for a hackathon-stage product.

**PCI DSS** — Not applicable. No payment card processing occurs.

**RBI data localization** — Data is stored on AWS `ap-south-1` (Mumbai region),
which satisfies Indian data residency requirements for this use case.

**DPDP Act (India)** — Data deletion (right to erasure) and explicit consent
management are planned features, not yet implemented. Full compliance requires
these before any public launch.
