# Oikos Ledger

> *When did you last ask your bank statement a plain English question?*

Oikos Ledger is a conversational personal finance app that turns Indian bank statements into charts, trends, and AI-powered spending insights — just by asking. Built for the AWS + Vercel Hackathon 2026 (Track 1 B2C).

**Live demo:** https://oikosledger.vercel.app

---

## What it does

- **Multi-bank ingestion** — upload CSV statements from HDFC, ICICI, and Axis Bank. The pipeline parses each bank's unique format, normalises merchant names, categorises transactions, and validates opening and closing balances row by row.
- **Conversational insights** — ask questions in plain English or by voice. The app translates natural language to SQL, queries Aurora PostgreSQL, and renders charts. Repeated queries are served from a pgvector semantic cache — no LLM call needed.
- **Spending recommendations** — a rolling 3-month baseline per discretionary category projects end-of-month spend. Overspending cards show which merchants are driving it and what to do before month end.
- **Multi-dimensional analytics** — spend by merchant, payment method, subcategory, and debit vs credit trend across selectable date ranges.
- **Voice advisor** — OpenAI Realtime API enables spoken queries with personalised, data-driven responses and built-in guardrails.

---

## Architecture

![Oikos Ledger Architecture](https://github.com/sl2902/oikos_ledger/blob/main/assets/oikos_ledger_architecture.png)

**Tech stack:**
- Frontend: Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui — deployed on Vercel
- Ingestion: Python 3.12 Lambda, invoked directly by the Next.js upload API route after storing the file in S3
- Database: Aurora PostgreSQL Serverless v2, pgvector extension
- AI: OpenAI GPT-4o-mini (NL→SQL, recommendations), text-embedding-3-small (semantic cache), Realtime API (voice)
- Auth: NextAuth v5, Google OAuth

---

## Data model

![Oikos Ledger Data Model](https://github.com/sl2902/oikos_ledger/blob/main/assets/oikos_ledger_er_v1.png)

---

## For judges

The app is live at **https://oikosledger.vercel.app**.

### Guest access
Click **Try as Guest** on the login page. No Google account required. The guest account is pre-seeded with 3 months of realistic HDFC Bank transactions (April–June 2026) covering food, groceries, pharmacy, utilities, shopping, and dividend income.

### Testing the upload
1. Sign in as guest (or with your own Google account)
2. Download a sample statement: [`demo_hdfc_statement.csv`](https://raw.githubusercontent.com/sl2902/oikos_ledger/refs/heads/main/ingestion/tests/fixtures/demo/demo_hdfc_statement_full.csv)
3. On the Transactions page, click **Upload Statement** in the top right corner
4. Select HDFC Bank and upload the CSV
5. Wait ~30–60 seconds for Lambda to process

### Resetting guest data
If you want to start fresh as a guest:
1. Go to Transactions page
2. Click the upload history icon (🕐) next to the bank account
3. Delete the existing upload
4. Re-upload the demo CSV

### Exploring features
- **Transactions** — filter by month, category, payment method, merchant search, custom date range
- **Insights** — type or speak a question (e.g. *"Plot my food expenses for the last 3 months"*)
- **Recommendations** — spending vs 3-month baseline with projected overspend
- **Analytics** — merchant breakdown, payment method trends, subcategory drilldown, debit vs credit

> Note: Demo statements have been uploaded until July 15 to ensure recommendations show live current-month data during the judging period.

---

## Developer setup

### Prerequisites
- Node.js 20+
- Python 3.11+
- `uv` (Python package manager)
- AWS CLI configured for `ap-south-1`
- PostgreSQL client (psql)

### Clone and install

```bash
git clone https://github.com/<your-repo>/oikos_ledger.git
cd oikos_ledger

# Frontend
cd app
npm install

# Ingestion pipeline
cd ../ingestion
uv sync
```

### Environment variables

#### Frontend (`app/.env.local`)
```env
# Database
DATABASE_URL=postgresql://user:password@your-aurora-endpoint:5432/oikos
DATABASE_URL_DIRECT=postgresql://user:password@your-aurora-endpoint:5432/oikos
DB_PROVIDER=aurora

# Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# OpenAI
OPENAI_API_KEY=sk-proj-...
OPENAI_REALTIME_API_KEY=sk-proj-...

# AWS
AWS_REGION=ap-south-1
AWS_S3_BUCKET=your-s3-bucket
AWS_LAMBDA_FUNCTION_NAME=oikos-ledger-ingestion

# Feature flags
NEXT_PUBLIC_VOICE_ENABLED=true
```

#### Ingestion (`ingestion/.env`)
```env
DATABASE_URL=postgresql://user:password@your-aurora-endpoint:5432/oikos
AWS_S3_BUCKET=your-s3-bucket
AWS_LAMBDA_FUNCTION_NAME=oikos-ledger-ingestion
OPENAI_API_KEY=sk-proj-...
OPENAI_BASE_URL=https://api.openai.com/v1
```

### AWS setup

#### 1. Aurora PostgreSQL Serverless v2
Use the **full configuration** wizard in the AWS console — do not use express creation.

```bash
# Enable pgvector after cluster is ready
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

#### 2. Run database migrations

```bash
cd app
npx drizzle-kit push
```

Then create the demo guest user:

```sql
INSERT INTO users (email, first_name, last_name, country_code, currency)
VALUES ('demo@oikosledger.app', 'Demo', 'User', 'IN', 'INR');

-- Note the generated UUID and use it below
INSERT INTO bank_accounts (user_id, bank_name, account_type, currency)
VALUES ('<user-uuid-from-above>', 'HDFC Bank', 'savings', 'INR');
```

Update `app/auth.ts` with the generated user UUID:
```typescript
// In the Credentials provider authorize() and jwt() callback
token["userId"] = "<your-demo-user-uuid>"
```

#### 3. S3 bucket
```bash
aws s3 mb s3://your-bucket-name --region ap-south-1
aws s3api put-bucket-cors --bucket your-bucket-name --cors-configuration file://infra/s3-cors.json
```

#### 4. Lambda deployment
```bash
cd ingestion
./deploy.sh  # or your deployment script
```

Set these environment variables on the Lambda function:
```
DATABASE_URL
OPENAI_API_KEY
OPENAI_BASE_URL=https://api.openai.com/v1
AWS_S3_BUCKET
```

#### 5. Google OAuth
1. Go to https://console.cloud.google.com → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add authorised redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://your-vercel-domain.vercel.app/api/auth/callback/google`

### Running locally

```bash
cd app
npm run dev
```

The app runs at `http://localhost:3000`. Ingestion runs in Lambda — uploads trigger the Lambda function via S3, so you need the full AWS stack even for local development.

### Deploying to Vercel

```bash
cd app
vercel --prod
```

Set all environment variables from `app/.env.local` in Vercel dashboard → Settings → Environment Variables. Note that Vercel does not support variable interpolation — always paste actual values, never `$VARIABLE_NAME` references.

---

## Known limitations

See [`docs/challenges.md`](./docs/challenges.md) for a full list of known issues, workarounds, and planned fixes.

---

## License

MIT