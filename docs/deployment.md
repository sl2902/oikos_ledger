# Oikos Ledger — Deployment

## Environments

<!-- dev, staging, production — what differs between them -->

## Frontend (Vercel)

<!-- Git-push deploy, environment variable configuration, preview deployments -->

## Ingestion Pipeline (AWS Lambda)

The ingestion pipeline is deployed as a Docker container image to AWS Lambda.
Container images handle complex native dependencies (`pgvector`, `geoalchemy2`,
`psycopg2-binary`) without ZIP size limits or platform compatibility issues.

**Function name:** `oikos-ledger-ingestion`  
**Region:** `ap-south-1`  
**Runtime:** Container image (Python 3.11)  
**Timeout:** 300 seconds  
**Memory:** 512 MB

### First-time setup

1. Run IAM role setup (once per AWS account):

   ```bash
   chmod +x scripts/setup_lambda_role.sh
   ./scripts/setup_lambda_role.sh
   ```

   The script prints the role ARN and the exact `aws lambda update-function-configuration`
   command to attach it to the function.

2. Attach the role to the Lambda function (command printed by the script above).

3. Deploy:

   ```bash
   chmod +x scripts/deploy_lambda.sh
   ./scripts/deploy_lambda.sh
   ```

### Subsequent deployments

```bash
./scripts/deploy_lambda.sh
```

The script builds the image, pushes to ECR, updates the Lambda function code,
and sets all environment variables from `.env.local` automatically.

### What the deploy script does

| Step | Action |
|------|--------|
| 1 | Create ECR repository if it doesn't exist |
| 2 | Authenticate Docker to ECR |
| 3 | Build image for `linux/amd64` |
| 4 | Tag image |
| 5 | Push image to ECR |
| 6 | Update Lambda function code to new image |
| 7 | Wait for code update |
| 8 | Update timeout and memory |
| 9 | Set all environment variables from `.env.local` |

### Environment variables

All environment variables are sourced from `.env.local` and set on the Lambda
function during deployment. Required variables:

| Variable | Source |
|----------|--------|
| `DATABASE_URL` | Supabase pooled connection string |
| `DATABASE_URL_DIRECT` | Supabase direct connection string |
| `AUTH_SECRET` | NextAuth secret (required by `pydantic-settings` validation) |
| `OPENAI_API_KEY` | Used for transaction embeddings |
| `AWS_S3_BUCKET` | Bucket containing uploaded CSVs |
| `NORMALIZER_PROVIDER` | `openai` or `gemini` (default: `openai`) |
| `NORMALIZER_MODEL` | Model name for the chosen provider (default: `gpt-4o-mini`) |

### Local testing

Test the pipeline locally without deploying to Lambda:

```bash
python -m ingestion.lambda_handler \
  <upload_id> <account_id> <user_id> <bank_name> <path/to/file.csv>
```

This bypasses S3 and reads the CSV directly from the local filesystem.

### IAM permissions

The Lambda execution role (`oikos-ledger-lambda-role`) requires:

- `AWSLambdaBasicExecutionRole` — CloudWatch Logs write access
- Inline policy `oikos-ledger-s3-access` — `s3:GetObject` and `s3:PutObject`
  on `arn:aws:s3:::oikos-ledger-uploads/*`

## Database (Aurora PostgreSQL)

<!-- Cluster provisioning, pgvector and PostGIS extension installation, RDS Proxy setup, connection string management -->

## Infrastructure as Code

<!-- Placeholder: Terraform / CDK / manual console — decision pending -->

## CI/CD

<!-- GitHub Actions pipeline: lint → test → build → deploy -->

## Runbook

<!-- How to roll back a bad deploy, how to re-run a failed ingestion job, how to rotate secrets -->
