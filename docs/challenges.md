# Technical Challenges and Known Limitations

## 1. Bank Narration Normalization

Indian bank narrations are one of the most varied and
unpredictable text formats in financial technology. Unlike
Western banking systems where merchant names are standardized
at the point-of-sale terminal, Indian bank narrations encode
payment method, merchant identity, gateway provider, VPA,
IFSC codes, and reference numbers into a single concatenated
string with no consistent delimiter or schema.

### Same merchant, different formats

```
UPI-SWIGGY-SWIGGY@HDFCBANK-HDFC0000001-612535829269-UPI SEND MONEY
K4UXS7UOARZ2DOWVCI/PAYUSWIGGYIN
60521705841704606721/PAYTMSWIGGYCOM
```

All three represent a Swiggy food delivery transaction but
require completely different parsing strategies.

### Specific challenges encountered

**No standard delimiter**

Gateways concatenate prefix + merchant + suffix with no
separator: `PAYTMSWIGGYCOM` = `PAYTM` + `SWIGGY` + `COM`.
Indistinguishable without a merchant whitelist.

**Domain suffixes as word endings**

`COM` in `BESCOM` (Bangalore Electricity Supply Company) vs `COM`
as domain suffix in `SWIGGYCOM` — indistinguishable without
context. Hardcoded BESCOM exception required.

**Numeric prefixes in UPI strings**

Merchant IDs embedded before merchant name: `15779 APOLLO
PHARMAC`. Stripped via regex but may incorrectly strip
legitimate numeric merchant names.

**Gateway code bleeding**

Random alphanumeric gateway transaction codes prefix the
merchant name in some formats.

**LLM inconsistency**

Same narration can produce different category assignments
across LLM calls. Mitigated by `temperature=0` and merchant
registry caching, but stale registry entries can persist
incorrect values.

**Truncated merchant names**

HDFC truncates merchant names: `APOLLO PHARMAC` instead of
`APOLLO PHARMACY`. Conservative LLM prompt prevents expansion
but leaves truncated names in the registry.

### Mitigation strategy

Two-stage normalization: deterministic rules handle ~70% of
transactions, LLM handles the rest. Merchant registry caches
correct normalizations. User amendments correct mistakes and
feed back into the registry. Known limitations are documented —
the amendment UI exists precisely because normalization is
imperfect.

### What would generalise

A fine-tuned model trained on millions of Indian bank narrations
with ground truth merchant/category labels. Companies like Setu,
Finvu, and Perfios have built exactly this. It is a significant
data collection and training investment, not feasible in a
23-day hackathon.

---

## 2. Aurora Connection During Development

Aurora Serverless v2 with minimum ACU=0 pauses after 5 minutes
of inactivity. Cold start adds 5–30 seconds to the first request
after a pause. This is intentional during development to minimize
cost but must be changed before a demo recording.

**Fix before demo:** Set minimum ACU to 0.5 via AWS CLI:
```
aws rds modify-db-cluster --db-cluster-identifier oikos-ledger \
  --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=4
```

---

## 3. SSL Certificate for Aurora

Aurora requires SSL. The AWS global CA bundle (`global-bundle.pem`)
was downloaded but Next.js could not locate it reliably due to
`process.cwd()` resolving to different directories in different
execution contexts (local dev vs. Vercel build vs. Lambda).

**Current workaround:** `rejectUnauthorized: false` — SSL
encryption is active but certificate verification is skipped.

**Production fix:** Bundle `global-bundle.pem` in the Lambda
Docker image and configure an absolute path. For Next.js on
Vercel, embed the cert in the repo and reference it via
`path.join(process.cwd(), 'certs/global-bundle.pem')` with a
fallback to `NODE_EXTRA_CA_CERTS`.

---

## 4. HDFC CSV Comma in Narration

HDFC exports narrations without quoting even when they contain
commas. Standard `csv.DictReader` splits on every comma causing
a column shift for affected rows — the narration spills into the
date or amount columns.

**Fix:** `HDFCParser` overrides `parse_csv()` to detect column
overflow and rejoin split narration fields. The fix assumes the
last 5 columns are always: Value Date · Debit · Credit · Ref ·
Balance.

**Risk:** If HDFC changes column order this assumption breaks.
Defensive validation via `closing_balance` parse check is
recommended — if the final column cannot be parsed as a decimal
the row is likely malformed.

---

## 5. No RDS Proxy

Lambda and Next.js both connect directly to Aurora without a
connection pooling intermediary. At hackathon scale (single user,
low concurrency) this is acceptable. Under production load with
many concurrent Lambda invocations each opening a new connection,
Aurora's connection limit (~90 at 0.5 ACU) could be exhausted,
causing `connection refused` errors.

**Production fix:** Add RDS Proxy between Lambda/Next.js and
Aurora. RDS Proxy maintains a warm connection pool and multiplexes
client connections. Cost: ~$0.015/vCPU-hour. See ADR 002 for
prior discussion.

---

## 6. Merchant Registry Stale Entries

The merchant registry stores LLM normalization results. If an
early LLM call returns an incorrect category (e.g. Medical for a
bill payment), that value is cached and served on all subsequent
uploads until the registry is manually cleared or overwritten.

**Partial mitigation:** Deterministic categorization always
overrides LLM category when it returns a non-Other result. But
if the cached incorrect category is specific (not Other), the
override does not fire.

**Full fix:** Periodic registry revalidation pass, or confidence
scoring to detect and re-evaluate low-confidence entries. User
amendments that correct `normalized_merchant` already update the
registry — extending this to `category` amendments would close
the gap.

---

## 7. Axis Bank, SBI, ICICI Parsers

SBI, ICICI, and Axis parsers are stubbed but not tested with real
data. Column formats are assumed from public documentation and may
differ from actual bank CSV exports — column ordering, header
spelling, and date formats all vary between banks and sometimes
between export versions of the same bank.

**Required before production support:** End-to-end test with real
statements from each bank. Each parser needs its own fixture file
(analogous to `tests/test_parser.py` for HDFC) and validation
that `row_count`, `closing_balance`, and `reference_number` parse
correctly across at least 3 months of real data.
