# ADR 001 — AWS Database Choice: Aurora PostgreSQL

**Status:** Accepted

## Context

Oikos Ledger requires a database that can handle relational aggregations over transaction history, time-series queries, vector similarity search (for semantic query cache retrieval), and geospatial queries (for merchant location enrichment). Three AWS-managed options were evaluated.

## Options Considered

### Aurora DSQL

Aurora DSQL is a distributed, active-active database designed for globally distributed, high-availability workloads that cannot tolerate regional failure. It trades away PostgreSQL feature completeness in exchange for that distribution model — no stored procedures, a restricted SQL surface, and critically, no support for extensions.

Oikos Ledger is a single-region B2C application. The active-active consistency guarantees DSQL provides are overkill for this use case and the cost of those guarantees is steep: pgvector and PostGIS — both extensions central to the architecture — are not supported. DSQL is the wrong tool.

### DynamoDB

DynamoDB excels at key-value and document access patterns at massive scale with predictable single-digit millisecond latency. That profile fits event ingestion pipelines, session stores, and leaderboards.

Oikos Ledger's core read operations are the opposite of DynamoDB's strengths: multi-table relational joins, GROUP BY aggregations over date ranges, window functions for spending trend analysis, nearest-neighbor vector search, and bounding-box geospatial queries. These access patterns require either a relational engine or significant application-side workarounds that would substantially increase complexity and cost without a compensating benefit at Oikos Ledger's scale.

### Aurora PostgreSQL

Aurora PostgreSQL provides full PostgreSQL compatibility, which directly unlocks the capabilities the architecture depends on:

- **pgvector** — stores and queries transaction embeddings and query cache embeddings for semantic similarity search
- **PostGIS** — stores merchant coordinates as geometry and enables radius and bounding-box spatial queries
- **Window functions** — power month-over-month and rolling-average spending trend queries without application-side aggregation
- **Recursive CTEs** — enable hierarchical category rollups in a single query
- **RDS Proxy** — handles connection pooling cleanly for the Lambda runtime, which otherwise would exhaust database connections at scale
- **Mature ecosystem** — SQLModel (Python) and Drizzle (TypeScript) both have first-class PostgreSQL support

## Decision

Aurora PostgreSQL is the database for Oikos Ledger.

## Consequences

- pgvector and PostGIS must be enabled as extensions during cluster provisioning.
- Connection pooling via RDS Proxy for production; Lambda functions should use the proxy endpoint.
- Scripts that run outside Lambda use `DATABASE_URL_DIRECT` to bypass the proxy.

## Note

Initial development used Supabase (PostgreSQL hosted service). A persistent stale read issue was discovered — PgBouncer in transaction pooling mode does not guarantee read-your-writes consistency across different client connections. Migrated to Aurora PostgreSQL Serverless v2 (ap-south-1) which uses direct connections without PgBouncer intermediary. See ADR 008 for full migration context.
