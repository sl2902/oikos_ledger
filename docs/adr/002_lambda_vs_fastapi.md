# ADR 002 — Ingestion Runtime: AWS Lambda vs. FastAPI

**Status:** Accepted

## Context

The ingestion pipeline needs a Python runtime to receive CSV uploads, normalise merchant names via an LLM, generate embeddings, geocode merchants, and write to Aurora. The trigger is an S3 event fired when a user uploads a file. The workload is bursty and infrequent — a user might upload once a month.

## Options Considered

### FastAPI on a persistent server (EC2 / ECS / App Runner)

A FastAPI service would require a long-running process — either an EC2 instance, an ECS task, or an App Runner service. This introduces:

- **Always-on cost** — a process running 24/7 for a workload that fires a handful of times per month.
- **Operational overhead** — container builds, health checks, auto-scaling configuration, separate deployment pipeline outside Vercel.
- **Architectural mismatch** — FastAPI's request-response model is the wrong primitive for batch processing. Uploading a CSV triggers a multi-step pipeline that can run for 30–120 seconds. A synchronous HTTP response is not the right model.

A FastAPI service would also need to live outside Vercel, adding a second deployment target with no compensating benefit at this scale.

### AWS Lambda

Lambda is event-driven by design. The natural wiring is:

1. User uploads CSV → Next.js route handler streams the file to S3 and invokes Lambda asynchronously.
2. Lambda receives the S3 event, downloads the file, and runs the full pipeline.
3. Lambda writes normalised transactions, embeddings, and insights to Aurora.

Lambda's key properties match the workload exactly:

- **Pay-per-invocation** — zero cost between uploads.
- **Scales to zero** — no idle infrastructure.
- **S3 event trigger** — native, no polling or webhook setup required.
- **AWS-native** — IAM roles, VPC access to Aurora, and S3 access are all first-class.
- **Timeout up to 15 minutes** — sufficient for a full ingestion run.

## Decision

AWS Lambda is the ingestion runtime.

## Consequences

- Cold start latency (~1–3s) is acceptable for async ingestion — the user is not waiting on a synchronous response.
- The Lambda package must stay within the 250 MB unzipped limit. `uv export` generates `requirements.txt`; a Docker-based Lambda image removes the size constraint if needed.
- Aurora connection pooling is handled via RDS Proxy — Lambda creates new connections on each cold start, and RDS Proxy prevents exhausting Aurora's connection limit.
- The ingestion pipeline is triggered by the Next.js upload route handler via `InvokeCommand` (async invocation), not directly by an S3 event trigger, so the route handler can pass structured metadata along with the S3 key.
