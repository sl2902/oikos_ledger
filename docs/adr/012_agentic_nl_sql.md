# ADR 012 — Agentic NL→SQL with run_sql Tool over Classify → GenerateSQL Two-Step

**Date:** 2026-06-18
**Status:** Accepted

---

## Context

The Insights page allows users to query their financial data in natural language. An initial two-step approach was implemented:

1. `classifyIntent` — LLM call to classify the query as a pre-built intent or custom query
2. `generateSQL` — LLM call to produce a SELECT statement from the classified intent and conversation history

This produced several problems in practice.

---

## Problems with the Two-Step Approach

**Context loss on follow-up queries** — `classifyIntent` and `generateSQL` were separate LLM calls. The intent classifier operated on the current question alone; by the time SQL was generated, context from prior turns was not being carried forward reliably. "How much in April?" after discussing Swiggy spending would generate a general SUM query without the merchant filter.

**Year hallucination** — Without today's date injected into the prompt, `generateSQL` defaulted to 2023 for month-only queries, returning zero results for data that existed in 2026.

**No graceful ambiguity handling** — If the query was ambiguous, the system generated SQL anyway and returned wrong results. There was no path to ask for clarification.

**Off-topic queries returned SQL** — The intent classifier sometimes misclassified off-topic questions as custom queries, generating nonsensical SQL.

---

## Decision

Replace `classifyIntent` + `generateSQL` with a single `runAgentLoop` function using OpenAI function calling with a `run_sql` tool.

---

## Architecture

```
runAgentLoop(question, history, userId, accountId, currency, dateContext)
  │
  ├─ GPT-4o-mini + run_sql tool + full conversation history
  │    run_sql parameters: { sql: string, chart_type: enum }
  │
  ├─ Tool call → validateSQL → execute → synthesize → stream SSE
  │
  └─ No tool call → return direct response (clarification / off-topic)
```

**Key properties:**

- The LLM decides whether to call the tool or respond directly. Off-topic queries return a direct text response without ever generating SQL.
- Full conversation history is sent on every call — follow-up context is preserved natively.
- `chart_type` is a required structured parameter in the tool schema (enum: line, bar, horizontal_bar, comparison_bar, pie, table, none). The agent specifies visualization alongside the query, eliminating brittle column-name inference.
- Today's date and current year are injected into the system prompt, eliminating year hallucination.
- Pre-built intents (monthly_trend, biggest_expenses, etc.) bypass the agent entirely — they use hardcoded optimised SQL.
- The two-tier query cache (SHA-256 exact → pgvector similarity) runs before the agent.

---

## Consequences

- Single LLM call per custom query instead of two — lower latency and cost
- Conversation context preserved reliably across follow-up turns
- Ambiguous queries trigger a clarifying question rather than wrong SQL
- Off-topic queries handled gracefully without SQL generation
- `chart_type` reliability improved — agent specifies it from query intent, not post-hoc column name inspection
- `classifyIntent` and `generateSQL` functions removed from `route.ts`
