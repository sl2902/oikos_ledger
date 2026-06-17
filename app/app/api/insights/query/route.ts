import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { sql } from "drizzle-orm"
import OpenAI from "openai"

export const dynamic = "force-dynamic"

const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
})

const OFF_TOPIC_RESPONSE =
  "I can only answer questions about your transactions and spending. Try asking about your top merchants, monthly trends, or spending by category."

const BLOCKED_KEYWORDS = [
  "drop", "delete", "update", "insert", "truncate",
  "alter", "create", "grant", "revoke", "exec",
  "execute", "pg_", "information_schema",
]

const INTENTS = {
  monthly_trend: {
    label: "Monthly trend",
    description: "Time-series aggregation across your statement period",
    sql: (userId: string, accountId: string, dateFilter = "") => `
      SELECT
        TO_CHAR(transaction_date, 'YYYY-MM') AS month,
        SUM(CASE WHEN transaction_type = 'debit' THEN amount ELSE 0 END) AS debits,
        SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE 0 END) AS credits,
        SUM(CASE WHEN transaction_type = 'debit' THEN -amount ELSE amount END) AS net
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${accountId}'
        ${dateFilter}
      GROUP BY TO_CHAR(transaction_date, 'YYYY-MM')
      ORDER BY month ASC
    `,
    chart_type: "line",
  },
  biggest_expenses: {
    label: "Biggest expenses",
    description: "SUM + GROUP BY category with RANK() window function",
    sql: (userId: string, accountId: string, dateFilter = "") => `
      SELECT
        category,
        SUM(amount) AS total,
        COUNT(*) AS transaction_count,
        RANK() OVER (ORDER BY SUM(amount) DESC) AS rank
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${accountId}'
        AND transaction_type = 'debit'
        ${dateFilter}
      GROUP BY category
      ORDER BY total DESC
      LIMIT 10
    `,
    chart_type: "bar",
  },
  credits_vs_debits: {
    label: "Credits vs Debits",
    description: "Conditional aggregation by transaction type",
    sql: (userId: string, accountId: string, dateFilter = "") => `
      SELECT
        TO_CHAR(transaction_date, 'YYYY-MM') AS month,
        SUM(CASE WHEN transaction_type = 'debit' THEN amount ELSE 0 END) AS debits,
        SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE 0 END) AS credits
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${accountId}'
        ${dateFilter}
      GROUP BY TO_CHAR(transaction_date, 'YYYY-MM')
      ORDER BY month ASC
    `,
    chart_type: "comparison_bar",
  },
  top_merchants: {
    label: "Top merchants",
    description: "SUM + GROUP BY merchant with DENSE_RANK() window function",
    sql: (userId: string, accountId: string, dateFilter = "") => `
      SELECT
        normalized_merchant,
        SUM(amount) AS total,
        COUNT(*) AS transaction_count,
        DENSE_RANK() OVER (ORDER BY SUM(amount) DESC) AS rank
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${accountId}'
        AND transaction_type = 'debit'
        ${dateFilter}
      GROUP BY normalized_merchant
      ORDER BY total DESC
      LIMIT 10
    `,
    chart_type: "horizontal_bar",
  },
  spending_by_category: {
    label: "Spending by category",
    description: "Category breakdown with pgvector semantic grouping",
    sql: (userId: string, accountId: string, dateFilter = "") => `
      SELECT
        category,
        subcategory,
        SUM(amount) AS total,
        COUNT(*) AS transaction_count,
        ROUND(
          SUM(amount) * 100.0 /
          SUM(SUM(amount)) OVER (),
          2
        ) AS percentage
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${accountId}'
        AND transaction_type = 'debit'
        ${dateFilter}
      GROUP BY category, subcategory
      ORDER BY total DESC
    `,
    chart_type: "pie",
  },
}

type HistoryEntry = { role: string; content: string }

async function classifyIntent(
  question: string,
  knownIntent: string | null,
  history: HistoryEntry[] = [],
): Promise<{
  intent: string
  is_off_topic: boolean
  is_display_command: boolean
}> {
    if (knownIntent && INTENTS[knownIntent as keyof typeof INTENTS]) {
        return { intent: knownIntent, is_off_topic: false, is_display_command: false }
      }

      // Last few turns only — enough to resolve a follow-up reference,
      // not so much that a stale topic or a closed-off exchange biases
      // classification of the current question.
      const recentHistory = history.slice(-6)
      const historyContext = recentHistory.length > 0
        ? `\nRecent conversation (most recent last):\n${recentHistory
            .map(h => `${h.role}: ${h.content}`)
            .join("\n")}\n`
        : ""

      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        stream: true,
        user: "oikos-ledger",
        messages: [
          {
            role: "system",
            content: `Classify the CURRENT user query into exactly one category.
    Note: this may be a voice query so be lenient with casual phrasing — if it COULD relate to personal finance, classify it as finance_custom rather than off_topic.

    The current query may be a short follow-up, refinement, or affirmation
    that only makes sense in light of the recent conversation below. Use that
    context to resolve what the query is actually asking before classifying.
    Examples:
    - Recent: "assistant: You spent ₹6,900 on food in April 2026."
      Current: "What about May?"
      Correct: finance_custom (a date-range follow-up, not off_topic)
    - Recent: "user: Show me top merchants"
      Current: "Only food ones"
      Correct: finance_custom (refining the prior finance question)
    ${historyContext}
    Categories:
    - monthly_trend: asking to SEE or PLOT spending over time
    - biggest_expenses: asking about largest expenses
    - credits_vs_debits: asking about income vs spending
    - top_merchants: asking about where money was spent
    - spending_by_category: asking about category breakdown
    - finance_custom: any question that could relate to personal finance, transactions, spending, balances, merchants, unusual activity, alerts, or account summaries. When in doubt, or when the current query is a follow-up/refinement of a recent finance question, use this.
    - display_command: requests to change visualization ("re-plot", "show as pie", "use bar chart")
    - off_topic: ONLY if the current query, read together with recent context, is clearly unrelated to finance (weather, sports, jokes, cooking)

    Return ONLY the category name, nothing else.`,
          },
          { role: "user", content: question },
        ],
      })

  let classification = ""
  for await (const chunk of stream) {
    classification += chunk.choices[0]?.delta?.content ?? ""
  }
  classification = classification.trim().toLowerCase()

  return {
    intent: classification,
    is_off_topic: classification === "off_topic",
    is_display_command: classification === "display_command",
  }
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().trim().replace(/[?!.,]/g, "").replace(/\s+/g, " ")
}

function dedupeConsecutive(history: HistoryEntry[]): HistoryEntry[] {
  const deduped: HistoryEntry[] = []
  for (const entry of history) {
    const prev = deduped[deduped.length - 1]
    const isRepeat = prev
      && prev.role === entry.role
      && normalizeForCompare(prev.content) === normalizeForCompare(entry.content)
    if (!isRepeat) deduped.push(entry)
  }
  return deduped
}

async function hashQuery(text: string): Promise<string> {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[?!.,]/g, "")
    .replace(/\s+/g, " ")
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)
}

async function generateEmbedding(text: string): Promise<number[]> {
  const client = openai
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    dimensions: 1536,
    user: "oikos-ledger",
  })
  return response.data[0].embedding
}

async function getExactCacheHit(
  userId: string,
  accountId: string,
  queryHash: string,
): Promise<Record<string, unknown> | null> {
  try {
    const result = (await db.execute(sql.raw(`
      SELECT result
      FROM query_cache
      WHERE user_id = '${userId}'
        AND account_id = '${accountId}'
        AND query_hash = '${queryHash}'
        AND expires_at > NOW()
      LIMIT 1
    `))) as unknown as { rows: Record<string, unknown>[] }

    if (result.rows.length > 0) {
      return result.rows[0].result as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

async function getSimilarCacheHits(
  userId: string,
  accountId: string,
  embedding: number[],
  queryHash: string,
): Promise<{ query_text: string; query_hash: string }[]> {
  try {
    const result = (await db.execute(sql.raw(`
      SELECT query_text, query_hash,
        1 - (query_embedding <=> '[${embedding.join(",")}]'::vector)
          AS similarity
      FROM query_cache
      WHERE user_id = '${userId}'
        AND account_id = '${accountId}'
        AND query_hash != '${queryHash}'
        AND expires_at > NOW()
        AND 1 - (query_embedding <=> '[${embedding.join(",")}]'::vector) > 0.85
      ORDER BY query_embedding <=> '[${embedding.join(",")}]'::vector
      LIMIT 3
    `))) as unknown as { rows: Record<string, unknown>[] }

    return result.rows.map(r => ({
      query_text: r.query_text as string,
      query_hash: r.query_hash as string,
    }))
  } catch {
    return []
  }
}

async function getCacheByHash(
  userId: string,
  accountId: string,
  queryHash: string,
): Promise<Record<string, unknown> | null> {
  try {
    const result = (await db.execute(sql.raw(`
      SELECT result
      FROM query_cache
      WHERE user_id = '${userId}'
        AND account_id = '${accountId}'
        AND query_hash = '${queryHash}'
        AND expires_at > NOW()
      LIMIT 1
    `))) as unknown as { rows: Record<string, unknown>[] }

    if (result.rows.length > 0) {
      return result.rows[0].result as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

async function writeCacheEntry(
  userId: string,
  accountId: string,
  queryHash: string,
  queryText: string,
  embedding: number[],
  responseData: Record<string, unknown>,
): Promise<void> {
  try {
    await db.execute(sql.raw(`
      INSERT INTO query_cache (
        user_id, account_id, query_hash, query_text,
        query_embedding, result, expires_at
      )
      VALUES (
        '${userId}',
        '${accountId}',
        '${queryHash}',
        '${queryText.replace(/'/g, "''")}',
        '[${embedding.join(",")}]'::vector,
        '${JSON.stringify(responseData).replace(/'/g, "''")}',
        NOW() + INTERVAL '24 hours'
      )
      ON CONFLICT (user_id, account_id, query_hash)
      DO UPDATE SET
        result = EXCLUDED.result,
        query_embedding = EXCLUDED.query_embedding,
        expires_at = NOW() + INTERVAL '24 hours'
    `))
  } catch (err) {
    console.error("Cache write failed:", err)
  }
}

function validateSQL(query: string): { valid: boolean; reason?: string } {
  const lower = query.toLowerCase()
  for (const keyword of BLOCKED_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { valid: false, reason: `Query contains blocked keyword: ${keyword}` }
    }
  }
  if (!lower.trim().startsWith("select")) {
    return { valid: false, reason: "Only SELECT queries are allowed" }
  }
  return { valid: true }
}

async function generateSQL(
  question: string,
  userId: string,
  accountId: string,
  history: HistoryEntry[] = [],
  dateContext = "",
): Promise<string> {
  const historyContext = history.length > 0
    ? `\nConversation history:\n${history
        .map(h => `${h.role}: ${h.content}`)
        .join("\n")}\n`
    : ""

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    stream: true,
    user: "oikos-ledger",
    messages: [
      {
        role: "system",
        content: `You are a PostgreSQL query generator for a personal finance app.

IMPORTANT: If conversation history is provided, the current question
may be a follow-up or refinement. Use the full context to understand
what the user is asking. Examples:
- Previous: "What is my favorite food app?"
  Current: "I meant with respect to spending"
  Correct: TOP merchants WHERE category = 'Food' ORDER BY SUM(amount) DESC
- Previous: "Show me top merchants"
  Current: "Only show food ones"
  Correct: Same query but add AND category = 'Food'

IMPORTANT: If the current question is a very short affirmation ("yeah",
"yes", "do it", "do that", "go ahead", "sure", "ok", "okay", "sounds good",
"great", "perfect", "alright"), look at the conversation history to understand
what was being discussed and generate SQL for THAT topic.
Do not generate unrelated SQL.
If the context is still unclear, generate:
SELECT 'Please clarify your question' AS message

IMPORTANT: Ignore any part of the question that asks about output
formatting or presentation — e.g. "include the currency", "show the
date range used", "give me a summary". Currency and date context are
handled separately. Only generate SQL for the underlying data the user
actually wants (the amount, category, etc.).

${historyContext}${dateContext}
Table: transactions
Columns:
  - transaction_date (date)
  - normalized_merchant (text)
  - raw_description (text)
  - amount (numeric) — always positive
  - transaction_type (text) — 'debit' or 'credit'
  - category (text)
  - subcategory (text, nullable)
  - closing_balance (numeric, nullable)
  - currency (text)

Rules:
- Only SELECT queries
- Always include WHERE user_id = '${userId}' AND account_id = '${accountId}'
- Never use DROP, DELETE, UPDATE, INSERT, TRUNCATE, ALTER
- Add LIMIT 100 unless aggregating
- Use TO_CHAR(transaction_date, 'YYYY-MM') for month grouping
- CRITICAL: DO NOT include the 'currency' column in your SELECT clause under any circumstances unless explicity asked for.
- CRITICAL: If you select any unaggregated columns alongside an aggregate (like SUM(amount)), you MUST include every unaggregated column in a GROUP BY clause to ensure it runs cleanly on PostgreSQL.
- CRITICAL: Stick strictly to what the user explicitly asked for. Do not expand broad words like "food" into a manual array of sub-categories like ('Groceries', 'Restaurants', 'Delivery', 'Cafes'). If the user asks for food, query: ILIKE '%food%' or category = 'Food'.
- Return ONLY the SQL, no explanation, no markdown`,
      },
      { role: "user", content: question },
    ],
  })

  let sqlText = ""
  for await (const chunk of stream) {
    sqlText += chunk.choices[0]?.delta?.content ?? ""
  }
  return sqlText.trim()
}

export async function POST(request: Request) {
  console.log("POST /api/insights/query called at", new Date().toISOString())
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const {
    question,
    intent,
    account_id,
    conversation_history,
    last_chart_type,
    last_results,
    date_from,
    date_to,
    is_voice,
  } = body

  if (!account_id) {
    return Response.json({ error: "account_id required" }, { status: 400 })
  }

  const userId = session.user.id

  const dedupedHistory = dedupeConsecutive(conversation_history ?? [])

  const dateFilter = [
    date_from ? `AND transaction_date >= '${date_from}'` : "",
    date_to ? `AND transaction_date <= '${date_to}'` : "",
  ].join(" ")

  const dateContext = date_from || date_to
    ? `\nDate filter active: ${date_from ? `from ${date_from}` : ""} ${date_to ? `to ${date_to}` : ""}. Always apply this filter to all queries.\n`
    : ""

  // Step 1: Classify intent
  const classification = await classifyIntent(question, intent, dedupedHistory)

  console.log("classification:", classification)
  console.log("date_from:", date_from)
  console.log("date_to:", date_to)
  console.log("dateFilter:", dateFilter)

  // Step 2: Reject off-topic queries
  if (classification.is_off_topic) {
    return Response.json({
      type: "complete",
      question,
      intent: "off_topic",
      intent_label: "Off topic",
      intent_description: "",
      is_custom: false,
      sql: "",
      results: [],
      response: OFF_TOPIC_RESPONSE,
      chart_type: "none",
      row_count: 0,
      cached: false,
    })
  }

  // Step 3: Handle display commands — re-plot without re-querying
  if (classification.is_display_command) {
    const q = question.toLowerCase()
    let newChartType = last_chart_type ?? "table"

    if (q.includes("pie") || q.includes("donut")) newChartType = "pie"
    else if (q.includes("bar") && q.includes("horizontal")) newChartType = "horizontal_bar"
    else if (q.includes("bar")) newChartType = "bar"
    else if (q.includes("line")) newChartType = "line"
    else if (q.includes("table")) newChartType = "table"

    return Response.json({
      type: "complete",
      question,
      intent: "display_command",
      intent_label: "Display update",
      intent_description: "Chart type changed",
      is_custom: false,
      sql: "",
      results: last_results ?? [],
      response: "Here's the data re-plotted as requested.",
      chart_type: newChartType,
      row_count: (last_results ?? []).length,
      cached: false,
    })
  }

  // Step 4: Two-tier cache lookup
  const cacheText = intent
    ? `intent:${intent}:${date_from ?? ""}:${date_to ?? ""}`
    : question ?? ""

  const queryHash = await hashQuery(cacheText)

  // Tier 1: exact hash match — no embedding needed
  const exactHit = await getExactCacheHit(userId, account_id, queryHash)
  if (exactHit) {
    return Response.json({ ...exactHit, cached: true, type: "complete" })
  }

  // Generate embedding once — used for both Tier 2 and cache write
  const embedding = await generateEmbedding(cacheText)

  // Tier 2: similarity search
  const similarHits = await getSimilarCacheHits(
    userId, account_id, embedding, queryHash,
  )
  if (!is_voice && similarHits.length > 0) {
    console.log("is_voice:", is_voice, "similar hits:", similarHits.length)
    return Response.json({
      type: "suggestions",
      question: question || intent,
      suggestions: similarHits,
      response: "I found similar questions you've asked before. Would you like to use one of these?",
      cached: false,
    })
  }

  // Step 5: Execute query
  let querySQL: string
  let chartType: string
  let intentLabel: string
  let intentDescription: string
  const isCustom = !intent || !INTENTS[intent as keyof typeof INTENTS]
  const resolvedIntent = classification.intent

  if (!isCustom && INTENTS[resolvedIntent as keyof typeof INTENTS]) {
    const intentConfig = INTENTS[resolvedIntent as keyof typeof INTENTS]
    querySQL = intentConfig.sql(userId, account_id, dateFilter)
    chartType = intentConfig.chart_type
    intentLabel = intentConfig.label
    intentDescription = intentConfig.description
  } else {
    querySQL = await generateSQL(
      question, userId, account_id, dedupedHistory, dateContext,
    )

    const validation = validateSQL(querySQL)
    if (!validation.valid) {
      return Response.json(
        { error: `Invalid query: ${validation.reason}` },
        { status: 400 },
      )
    }

    if (!querySQL.toLowerCase().includes("limit")) {
      querySQL = `${querySQL.trim().replace(/;+$/, "")} LIMIT 100`
    }

    chartType = "table"
    intentLabel = "Custom query"
    intentDescription = "Natural language → SQL"
  }


  // Monthly trend: pick daily / weekly / monthly based on data span
  if (resolvedIntent === "monthly_trend") {
    console.log("Final querySQL:", querySQL)
    console.log("dateFilter:", dateFilter)
    console.log("account_id:", account_id)
    const rangeResult = (await db.execute(sql.raw(`
      SELECT
        MIN(transaction_date) AS min_date,
        MAX(transaction_date) AS max_date,
        COUNT(DISTINCT TO_CHAR(transaction_date, 'YYYY-MM')) AS month_count
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${account_id}'
        ${dateFilter}
    `))) as unknown as { rows: Record<string, unknown>[] }

    const range = rangeResult.rows[0]
    const monthCount = Number(range?.month_count ?? 0)

    if (monthCount >= 12) {
      querySQL = `
        SELECT
          TO_CHAR(transaction_date, 'YYYY-MM') AS month,
          SUM(CASE WHEN transaction_type = 'debit'
            THEN amount ELSE 0 END) AS debits,
          SUM(CASE WHEN transaction_type = 'credit'
            THEN amount ELSE 0 END) AS credits,
          SUM(CASE WHEN transaction_type = 'debit'
            THEN -amount ELSE amount END) AS net
        FROM transactions
        WHERE user_id = '${userId}'
          AND account_id = '${account_id}'
          ${dateFilter}
        GROUP BY TO_CHAR(transaction_date, 'YYYY-MM')
        ORDER BY month ASC
      `
      intentLabel = "Monthly trend"
      intentDescription = "Monthly time-series aggregation"
    } else if (monthCount >= 3) {
      querySQL = `
        SELECT
          TO_CHAR(DATE_TRUNC('week', transaction_date), 'YYYY-MM-DD') AS week,
          SUM(CASE WHEN transaction_type = 'debit'
            THEN amount ELSE 0 END) AS debits,
          SUM(CASE WHEN transaction_type = 'credit'
            THEN amount ELSE 0 END) AS credits,
          SUM(CASE WHEN transaction_type = 'debit'
            THEN -amount ELSE amount END) AS net
        FROM transactions
        WHERE user_id = '${userId}'
          AND account_id = '${account_id}'
          ${dateFilter}
        GROUP BY DATE_TRUNC('week', transaction_date)
        ORDER BY week ASC
      `
      intentLabel = "Weekly trend"
      intentDescription = "Weekly time-series aggregation"
    } else {
      querySQL = `
        SELECT
          TO_CHAR(transaction_date, 'YYYY-MM-DD') AS day,
          SUM(CASE WHEN transaction_type = 'debit'
            THEN amount ELSE 0 END) AS debits,
          SUM(CASE WHEN transaction_type = 'credit'
            THEN amount ELSE 0 END) AS credits,
          SUM(CASE WHEN transaction_type = 'debit'
            THEN -amount ELSE amount END) AS net
        FROM transactions
        WHERE user_id = '${userId}'
          AND account_id = '${account_id}'
          ${dateFilter}
        GROUP BY TO_CHAR(transaction_date, 'YYYY-MM-DD')
        ORDER BY day ASC
      `
      intentLabel = "Daily trend"
      intentDescription = "Daily time-series aggregation"
    }
  }

  try {
    const results = (await db.execute(
      sql.raw(querySQL),
    )) as unknown as { rows: Record<string, unknown>[] }
    const rows = results.rows ?? []

    const totalDebits = rows.reduce((sum, r) => sum + Number(r.debits ?? 0), 0)
    const totalCredits = rows.reduce((sum, r) => sum + Number(r.credits ?? 0), 0)

    const currencyResult = (await db.execute(sql.raw(`
      SELECT DISTINCT currency FROM transactions
      WHERE user_id = '${userId}' AND account_id = '${account_id}'
      LIMIT 1
    `))) as unknown as { rows: Record<string, unknown>[] }
    const currency = currencyResult.rows[0]?.currency as string ?? "INR"

    const historyContext = (conversation_history ?? []).length > 0
      ? `Previous conversation:\n${(conversation_history ?? [])
          .map((h: HistoryEntry) => `${h.role}: ${h.content}`)
          .join("\n")}\n\n`
      : ""

    let fullResponseText = ""
    const encoder = new TextEncoder()

    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          const metadata = {
            type: "metadata",
            intent: resolvedIntent,
            intent_label: intentLabel,
            intent_description: intentDescription,
            is_custom: isCustom,
            sql: querySQL.trim(),
            results: rows,
            chart_type: chartType,
            row_count: rows.length,
            cached: false,
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`)
          )

          const synthesisStream = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.3,
            stream: true,
            user: "oikos-ledger",
            messages: [
              {
                role: "system",
                content: `${historyContext}You are a personal finance assistant.
Rules:
- Maximum 1-2 sentences
- Never repeat the question back
- Lead with the answer directly
- Always use ${currency} currency symbol for amounts
- Use standard number formatting
- Round amounts to nearest hundred unless exact matters
- Never say "the data shows" or "based on the results"`,
              },
              {
                role: "user",
                content: `Question: ${question || intentLabel}
${totalDebits > 0 || totalCredits > 0
  ? `Pre-computed totals:
  Total debits: ${totalDebits.toFixed(2)}
  Total credits: ${totalCredits.toFixed(2)}`
  : ""}
Results (sample): ${JSON.stringify(rows.slice(0, 10))}
Summarize these results accurately.`,
              },
            ],
          })

          for await (const chunk of synthesisStream) {
            const text = chunk.choices[0]?.delta?.content ?? ""
            if (text) {
              fullResponseText += text
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text", text })}\n\n`
                )
              )
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()

          const responsePayload = {
            question: question || intentLabel,
            intent: resolvedIntent,
            intent_label: intentLabel,
            intent_description: intentDescription,
            is_custom: isCustom,
            sql: querySQL.trim(),
            results: rows,
            response: fullResponseText,
            chart_type: chartType,
            row_count: rows.length,
            cached: false,
          }
          await writeCacheEntry(
            userId, account_id, queryHash,
            cacheText, embedding, responsePayload,
          )
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`
            )
          )
          controller.close()
        }
      },
    })

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  } catch (error) {
    console.error("Query execution failed. SQL was:\n", querySQL, "\nError:", error)
    return Response.json(
      { error: "Query execution failed", detail: String(error) },
      { status: 500 },
    )
  }
}
