# Oikos Ledger — Technical Challenges and Known Limitations

## 1. Bank Narration Normalisation

Indian bank narrations are among the most varied text formats in financial technology. Unlike Western banking systems where merchant names are standardised at the point-of-sale terminal, Indian bank narrations encode payment method, merchant identity, gateway provider, VPA, IFSC codes, and reference numbers into a single concatenated string with no consistent delimiter or schema.

### Same merchant, different formats

```
UPI-SWIGGY-SWIGGY@HDFCBANK-HDFC0000001-612535829269-UPI SEND MONEY
K4UXS7UOARZ2DOWVCI/PAYUSWIGGYIN
60521705841704606721/PAYTMSWIGGYCOM
```

All three are Swiggy food delivery transactions requiring completely different parsing strategies.

### Specific challenges

**No standard delimiter** — gateways concatenate prefix + merchant + suffix with no separator: `PAYTMSWIGGYCOM` = `PAYTM` + `SWIGGY` + `COM`. Indistinguishable without a merchant whitelist.

**Domain suffixes as word endings** — `COM` in `BESCOM` (Bangalore Electricity Supply Company) vs `COM` as domain suffix in `SWIGGYCOM`. Hardcoded BESCOM exception required.

**Numeric prefixes in UPI strings** — merchant IDs embedded before name: `15779 APOLLO PHARMAC`. Stripped via regex but may incorrectly strip legitimate numeric merchant names.

**Truncated merchant names** — HDFC truncates: `APOLLO PHARMAC` instead of `APOLLO PHARMACY`. Conservative LLM prompt prevents expansion but leaves truncated names in the registry.

**Category inconsistency across banks** — same merchant category labelled differently by different parsers (e.g. "Health" vs "Medical"). Requires parser-level normalisation to a canonical category set — planned for Iteration 6.

**LLM inconsistency** — same narration can produce different category assignments across calls. Mitigated by `temperature=0` and merchant registry caching; stale registry entries can persist incorrect values.

### Mitigation strategy

Two-stage normalisation: deterministic rules handle ~70% of transactions, LLM handles the rest. Merchant registry caches correct normalisations. User amendments correct mistakes and feed back into the registry. The amendment UI exists precisely because normalisation is imperfect.

---

## 2. Agentic NL→SQL — Year Hallucination

When users specify a month without a year (e.g. "March"), `gpt-4o-mini` defaults to 2023 instead of the current year. This causes queries to return zero results for months that have data in 2026.

**Fix:** Today's date and current year injected into `AGENT_SYSTEM_PROMPT` at request time. Agent instructed to always use the current year unless a different year is explicitly stated.

**Residual risk:** Cached query results from before this fix have stale `chart_type` or date filters baked in. Cache entries are invalidated after 24 hours; clearing `query_cache` manually resolves immediately.

---

## 3. Voice Interface — Barge-In and Audio Overlap

With a WebSocket connection, the OpenAI Realtime API streams audio faster than it plays. When the user barge-ins, the server cancels the response but audio chunks already in flight continue playing briefly.

**Current approach:**
- `interrupt_response: true` in `turn_detection` — server auto-cancels on VAD start
- `conversation.item.truncate` sent with `audio_end_ms` = samples actually played
- GainNode mute (gain = 0) on `speech_started` — silences buffered chunks immediately
- `mutedItemId` ref — skips delta scheduling for the truncated item's in-flight chunks
- `response.created` restores gain for the new response

**Residual overlap:** Small audio window between mute and the last in-flight chunk being scheduled can still result in brief bleed-through. Acceptable for hackathon demo; production fix would require a more granular AudioBufferSourceNode cancellation strategy.

---

## 4. Voice Interface — Chart Type Communication

The Realtime model (`gpt-realtime-2`) has no visibility into the Next.js UI. It cannot know whether the `InsightsChart` component rendered a line chart or a table. When users say "show me a chart instead of a table", the model retries the same query with rephrased instructions, believing it controls the rendering.

**Fix:** `chart_type` added as a structured parameter to the `run_sql` tool schema in `runAgentLoop`. The agent specifies the chart type as part of the tool call; the UI renders accordingly. The Realtime model is told in its system prompt that chart rendering is handled by the app automatically.

**Residual issue:** Multi-series queries (time + dimension + value, e.g. daily spending by merchant) cannot be rendered as a chart — they require pivoting to wide format which is not yet implemented. These fall back to table. Agent system prompt explains this to the model.

---

## 5. Aurora Connection During Development

Aurora Serverless v2 with minimum ACU=0 pauses after 5 minutes of inactivity. Cold start adds 5–30 seconds to the first request after a pause.

**Fix before demo:** Set minimum ACU to 0.5:
```bash
aws rds modify-db-cluster --db-cluster-identifier oikos-ledger \
  --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=4
```

---

## 6. Aurora SSL Certificate

`rejectUnauthorized: false` used in Next.js and Lambda connections due to CA cert path resolution issues across execution contexts (local dev vs Vercel build vs Lambda container).

**Production fix:** Bundle `global-bundle.pem` in the Lambda Docker image and configure an absolute path. For Next.js on Vercel, embed the cert in the repo and reference via `path.join(process.cwd(), 'certs/global-bundle.pem')` with `NODE_EXTRA_CA_CERTS` fallback.

---

## 7. HDFC CSV Comma in Narration

HDFC exports narrations without quoting even when they contain commas. Standard `csv.DictReader` splits on every comma, causing a column shift for affected rows.

**Fix:** `HDFCParser` overrides `parse_csv()` to detect column overflow and rejoin split narration fields. Assumes the last 5 columns are always: Value Date · Debit · Credit · Ref · Balance.

---

## 8. No RDS Proxy

Lambda and Next.js connect directly to Aurora without connection pooling. At hackathon scale this is acceptable. Under production load, Aurora's connection limit (~90 at 0.5 ACU) could be exhausted.

**Production fix:** Add RDS Proxy (~$0.015/vCPU-hour). See ADR 002.

---

## 9. Merchant Registry Stale Entries

If an early LLM call returns an incorrect category, that value is cached and served on all subsequent uploads until manually cleared or overwritten.

**Partial mitigation:** Deterministic categorisation always overrides LLM category when it returns a non-Other result. User amendments that correct `normalized_merchant` update the registry.

---

## 10. SBI, ICICI, Axis Parsers

Parsers implemented but not tested against real bank statement data. Column formats assumed from public documentation and may differ from actual exports.

**Required before production support:** End-to-end test with real statements from each bank and parser fixture files analogous to `tests/test_parser.py` for HDFC.

---

## 11. OpenAI Proxy Token Limits

The dataexpert.io proxy (`OPENAI_BASE_URL`) has monthly token limits. When exhausted, the API returns a 401 with `"Monthly token limit exceeded"`.

**Workaround:** Comment out `OPENAI_BASE_URL` in `.env.local`. Client falls back to `api.openai.com` using `OPENAI_REALTIME_API_KEY` (standard `sk-proj-` key).

---

## 12. Query Cache Stale Chart Types

Cache entries written before the `chart_type` agent parameter was implemented store `chart_type: "table"` for all custom queries. These are served from cache with the wrong chart type until they expire (24h TTL) or until the cache is cleared.

**Fix:** `DELETE FROM query_cache WHERE user_id = '...' AND account_id = '...'` to force fresh queries.
