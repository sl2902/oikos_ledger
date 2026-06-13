# ADR 004 — Two-Schema Approach: SQLModel (Python) + Drizzle (TypeScript)

**Status:** Accepted

## Context

Oikos Ledger has two distinct runtimes — a Python Lambda for ingestion writes and a TypeScript Next.js app for reads. Both runtimes talk to the same Aurora PostgreSQL database. Each runtime needs a schema definition for type safety and query building.

## Options Considered

### FastAPI as single backend (Python for reads + writes)

Rather than splitting between Python Lambda and Next.js, one option is to use FastAPI as the single backend for both ingestion writes and dashboard reads. Next.js becomes a thin frontend that calls FastAPI endpoints.

This eliminates the ORM duplication — a single SQLModel definition serves both read and write operations. However:

- FastAPI is a long-running HTTP server. It requires a separate deployment target (EC2, ECS, or App Runner) outside Vercel. Managing two deployment pipelines for a solo project adds friction with no compensating benefit.
- FastAPI's request-response model is the wrong primitive for batch ingestion. A CSV pipeline that runs for 30–120 seconds does not map naturally to an HTTP response.
- Removing Next.js Route Handlers means rebuilding the data layer from scratch in Python rather than using Drizzle's TypeScript types end-to-end in the frontend.

The duplication cost of maintaining two schemas is lower than the operational cost of a separate always-on server deployment.

### Single ORM across both runtimes

No production-grade ORM spans both Python and TypeScript natively. Attempting to generate one from the other (e.g., introspecting the live schema and generating TypeScript types with `drizzle-kit introspect`, or generating Python from a JSON schema) would add a fragile code-generation step to the CI pipeline. The generated output drifts from the source of truth whenever the pipeline breaks or is skipped.

### Raw SQL in one runtime, ORM in the other

Eliminating the duplication by dropping type safety in one runtime is a poor trade. The most complex queries — pgvector cosine similarity scans, PostGIS bounding-box queries, window functions for MoM deltas — live in the Python pipeline. Losing type safety exactly there would introduce the most bugs.

### SQLModel (Python) + Drizzle (TypeScript) — two explicit schema definitions

Each runtime gets a first-class, idiomatic ORM:

- **Python owns writes.** The Lambda pipeline inserts transactions, embeddings, merchants, insights, and recommendations. SQLModel is the natural ORM in the Python ecosystem — it integrates with FastAPI-style validation, handles SQLAlchemy's extension ecosystem (pgvector, geoalchemy2), and generates tables via `create_all`.
- **Next.js owns reads.** Route Handlers query pre-computed aggregations, fetch recommendations, and serve the dashboard. Drizzle is the natural ORM in the TypeScript ecosystem — it's lightweight, type-safe, and serverless-first.
- **Aurora is the single source of truth.** Both ORMs point at the same tables. The schema does not live in either ORM's migration files — it lives in the database. SQLModel's `create_all` is the authoritative table-creation mechanism in development; Alembic will replace it for production migrations.

## Decision

SQLModel defines and creates all tables. Drizzle mirrors those definitions for TypeScript type safety. Both are maintained explicitly — no code generation between them.

## Consequences

- Schema changes require coordinated updates in both `ingestion/models/` and `app/lib/db/schema.ts`. For a solo build, this is a manageable manual step — a PR changing a column in one file should always change it in the other.
- `scripts/create_tables.py` uses SQLModel's `create_all` for development table creation. Production will use Alembic migrations (planned for a later iteration).
- The duplication is explicit and visible in code review. There is no hidden coupling between the two schema files — they are independent definitions of the same ground truth.
- If the project grows to a team, a `drizzle-kit introspect` step can be added to CI to flag drift automatically.
