# Oikos Ledger — Deployment

## Environments

| Environment | Frontend | Database | Notes |
|---|---|---|---|
| Development | `localhost:3000` | Aurora PostgreSQL (ap-south-1) | `.env.local` |
| Production | Vercel (auto-deploy on push to `main`) | Aurora PostgreSQL (ap-south-1) | Vercel environment variables |

---

## Frontend (Vercel)

Deployments are triggered automatically on push to `main`.

**Environment variables required on Vercel:**

| Variable | Description |
|---|---|
| `DATABASE_URL` | Aurora Transaction pooler connection string (port 6543) |
| `AUTH_SECRET` | NextAuth JWT signing secret |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `OPENAI_API_KEY` | OpenAI proxy key (dataexpert.io) — or omit to use direct |
| `OPENAI_BASE_URL` | Proxy base URL — omit to use `api.openai.com` directly |
| `OPENAI_REALTIME_API_KEY` | Direct OpenAI key (`sk-proj-...`) — used when `OPENAI_BASE_URL` is unset |
| `AWS_ACCESS_KEY_ID` | For S3 upload and Lambda invoke |
| `AWS_SECRET_ACCESS_KEY` | |
| `AWS_REGION` | `ap-south-1` |
| `AWS_S3_BUCKET` | `oikos-ledger-uploads` |
| `AWS_LAMBDA_FUNCTION_NAME` | `oikos-ledger-ingestion` |
| `NEXT_PUBLIC_VOICE_ENABLED` | `"true"` to enable voice button |

**OpenAI client fallback logic** (`app/lib/openai.ts`):
- `OPENAI_BASE_URL` set → use proxy with `OPENAI_API_KEY`
- `OPENAI_BASE_URL` unset → use `api.openai.com` with `OPENAI_REALTIME_API_KEY`

---

## Ingestion Pipeline (AWS Lambda)

The ingestion pipeline is deployed as a Docker container image to AWS Lambda.

**Function:** `oikos-ledger-ingestion`  
**Region:** `ap-south-1`  
**Runtime:** Python 3.12 container image  
**Timeout:** 300s · **Memory:** 512 MB

### First-time setup

```bash
chmod +x scripts/setup_lambda_role.sh
./scripts/setup_lambda_role.sh
# Script prints the role ARN and the attach command

chmod +x scripts/deploy_lambda.sh
./scripts/deploy_lambda.sh
```

### Subsequent deployments

```bash
./scripts/deploy_lambda.sh
```

### What the deploy script does

| Step | Action |
|---|---|
| 1 | Create ECR repository if it doesn't exist |
| 2 | Authenticate Docker to ECR |
| 3 | Build image for `linux/amd64` |
| 4 | Tag and push image to ECR |
| 5 | Update Lambda function code |
| 6 | Wait for update to complete |
| 7 | Update timeout and memory |
| 8 | Set all environment variables from `.env.local` |

### Local testing (without Lambda)

```bash
python -m ingestion.lambda_handler \
  <upload_id> <account_id> <user_id> <bank_name> <path/to/file.csv>
```

Bypasses S3 and reads the CSV from the local filesystem.

### IAM permissions

Lambda execution role (`oikos-ledger-lambda-role`) requires:
- `AWSLambdaBasicExecutionRole` — CloudWatch Logs
- Inline policy `oikos-ledger-s3-access` — `s3:GetObject` and `s3:PutObject` on `arn:aws:s3:::oikos-ledger-uploads/*`

---

## Database (Aurora PostgreSQL)

**Cluster:** `oikos-ledger` (ap-south-1)  
**Engine:** Aurora PostgreSQL Serverless v2  
**Extensions:** pgvector, postgis, pg_trgm

### Before demo recording

Set minimum ACU to 0.5 to prevent cold-start pauses:

```bash
aws rds modify-db-cluster \
  --db-cluster-identifier oikos-ledger \
  --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=4
```

Reset to 0 after demo to minimise cost:

```bash
aws rds modify-db-cluster \
  --db-cluster-identifier oikos-ledger \
  --serverless-v2-scaling-configuration MinCapacity=0,MaxCapacity=4
```

### Schema changes

While tables are empty: update SQLModel model → `python scripts/drop_tables.py` → `python scripts/create_tables.py`.

Once tables contain data: write a proper migration and apply it manually.

### Clearing the query cache

To force fresh insight queries (e.g. after chart_type fix):

```sql
DELETE FROM query_cache
WHERE user_id = '<user_id>'
AND account_id = '<account_id>';
```

---

## Runbook

### Re-run a failed ingestion

```bash
python -m ingestion.lambda_handler \
  <upload_id> <account_id> <user_id> <bank_name> <path/to/file.csv>
```

The pipeline is fully idempotent — re-running produces the same result.

### Roll back a Lambda deploy

```bash
# List versions
aws lambda list-versions-by-function --function-name oikos-ledger-ingestion

# Update to a specific image digest
aws lambda update-function-code \
  --function-name oikos-ledger-ingestion \
  --image-uri <ecr-uri>@<digest>
```

### Rotate AUTH_SECRET

Update `AUTH_SECRET` on Vercel. All active JWT sessions are immediately invalidated — users will need to sign in again.
