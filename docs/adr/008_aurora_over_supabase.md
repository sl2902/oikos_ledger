# ADR 008: Aurora PostgreSQL over Supabase

## Status
Accepted

## Context
Initial development used Supabase (PostgreSQL hosted service)
for convenience. During testing, a persistent stale read issue
was discovered: the upload status API returned "pending" even
after Lambda had written "complete" to the database. Multiple
attempts to fix this via SWR cache configuration, dedupingInterval,
and connection string changes all failed.

Root cause: Supabase uses PgBouncer in transaction pooling mode
(port 6543). Lambda writes via Python/SQLModel on one connection,
Next.js reads via Drizzle/pg on a different pooled connection.
PgBouncer in transaction mode does not guarantee read-your-writes
consistency across different client connections.

The session pooler (port 5432 on pooler.supabase.com) was tried
but also failed. The direct connection requires IPv6 which was
not available on the development network.

## Decision
Migrate to AWS Aurora PostgreSQL Serverless v2 (ap-south-1).
Aurora uses direct connections without PgBouncer intermediary,
guaranteeing read-your-writes consistency.

## Configuration
- Min ACU: 0 (dev) — pauses after 5 min inactivity
- Max ACU: 4
- SSL: rejectUnauthorized=false (global-bundle.pem path
  issues unresolved — TODO for production)
- No RDS Proxy — acceptable at hackathon scale

## Consequences
- Stale read issue resolved
- Upload modal auto-close works correctly
- Aurora pauses during dev — cold start adds 5-30s on
  first connection. Set min ACU to 0.5 before demo.
- Additional AWS cost: ~$0.06/ACU-hour when active
- Within $100 AWS credit budget
