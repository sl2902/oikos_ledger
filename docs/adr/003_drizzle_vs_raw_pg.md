# ADR 003 — TypeScript ORM: Drizzle ORM vs. Raw pg

**Status:** Accepted

## Context

The Next.js frontend queries Aurora PostgreSQL from Route Handlers. The query layer needs to be fast in a serverless environment (Vercel), type-safe, and straightforward to maintain. Three options were evaluated.

## Options Considered

### Raw pg / postgres.js

Full SQL control with zero abstraction. The downside is that query results are `any` — there is no type safety between column definitions and the TypeScript types used in components and API responses. Schema drift (adding a column to the database but not to the TypeScript type) produces silent runtime errors rather than compile-time failures.

### Prisma

Prisma provides strong type safety and a mature migration tooling story. However:

- Its runtime is heavy (~5 MB) and includes a query engine binary, causing slow cold starts on Vercel serverless functions.
- Its schema is defined in a custom DSL (`schema.prisma`) rather than TypeScript, so it does not serve as TypeScript documentation.
- The `prisma generate` step adds toolchain complexity.

For a latency-sensitive B2C app on Vercel, the cold-start penalty is a real cost.

### Drizzle ORM

Drizzle is lightweight (~100 KB), TypeScript-native, and serverless-first:

- **Type safety without magic** — `schema.ts` is plain TypeScript. Every column definition produces an inferred TypeScript type used directly in queries and API responses. No code generation step needed at runtime.
- **Close to raw SQL** — the query builder is a thin typed wrapper. There are no hidden N+1 queries, no lazy loading, no implicit joins. What you write is close to what executes.
- **Schema as documentation** — `app/lib/db/schema.ts` is the single source of truth for the database structure on the TypeScript side. Reviewers can read it like a table definition, not like ORM magic.
- **Vercel-optimised** — no binary dependency, minimal cold-start overhead, compatible with Vercel's Edge Runtime if needed.

## Decision

Drizzle ORM is the TypeScript query layer for Next.js Route Handlers.

## Consequences

- All TypeScript database access goes through `app/lib/db/client.ts` which exports a single `db` instance backed by a `pg` connection pool.
- `drizzle.config.ts` points at the direct connection string (`DATABASE_URL_DIRECT`) for `drizzle-kit generate` and `drizzle-kit migrate`.
- The Drizzle schema (`schema.ts`) must be kept in sync with the SQLModel models (`ingestion/models/`) — see ADR 004.
- `drizzle-kit studio` provides a visual table browser during development.
