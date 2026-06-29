import { auth } from "@/auth"
import { db, dbReadonly } from "@/lib/db/client"
import { sql } from "drizzle-orm"
import OpenAI from "openai"

export const dynamic = "force-dynamic"

const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
})

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
    const result = (await dbReadonly.execute(sql.raw(`
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
    const result = (await dbReadonly.execute(sql.raw(`
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
    const result = (await dbReadonly.execute(sql.raw(`
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

const AGENT_SYSTEM_PROMPT = (
  userId: string,
  accountId: string,
  currency: string,
  dateContext: string,
) => {
  const today = new Date().toISOString().split("T")[0]
  const currentYear = today.slice(0, 4)
  return `You are a personal finance assistant for an app called Oikos Ledger. You have access to the user's transaction data via the run_sql tool.

Today's date is ${today}. The current year is ${currentYear}.
When the user refers to a month by name only (e.g. "March",
"last month"), ALWAYS use ${currentYear} unless a different
year is explicitly stated by the user.

${dateContext ? `Active date filter: ${dateContext}` : ""}

Database table: transactions
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

SQL Rules (always enforced):
  - Only SELECT queries
  - Always include:
    WHERE user_id = '${userId}' AND account_id = '${accountId}'
  - Never use DROP, DELETE, UPDATE, INSERT, TRUNCATE, ALTER
  - Add LIMIT 100 unless aggregating
  - Use TO_CHAR(transaction_date, 'YYYY-MM') for month grouping
  - "Last N months" means from the start of the month N months ago,
    not N×30 days ago. Always use:
    DATE_TRUNC('month', CURRENT_DATE) - INTERVAL 'N months'
    NOT CURRENT_DATE - INTERVAL 'N months'
  - NEVER pass a string literal to DATE_TRUNC. Always use CURRENT_DATE
    or a column reference, never a quoted date string.
  - CORRECT: DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'
  - WRONG: DATE_TRUNC('month', '2026-06-01') - INTERVAL '3 months'
  - ALWAYS add an upper bound of AND transaction_date <= CURRENT_DATE
    to prevent fetching future-dated transactions
  - Example: "last 3 months" →
    transaction_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'
    AND transaction_date <= CURRENT_DATE
  - DO NOT include 'currency' in SELECT unless explicitly asked
  - Use ILIKE '%value%' for merchant/category text matching
  - Do NOT expand category words into sub-arrays
  - If joining unaggregated columns with aggregates, include
    all unaggregated columns in GROUP BY
  - CRITICAL: Always alias time columns as EXACTLY 'day', 'week',
  or 'month' with no exceptions:
  TO_CHAR(transaction_date, 'YYYY-MM-DD') AS day
  TO_CHAR(transaction_date, 'YYYY-WW') AS week  
  TO_CHAR(transaction_date, 'YYYY-MM') AS month
  Never use 'transaction_day', 'transaction_date', 'order_date'
  or any other alias for time columns.
- Always alias value columns as exactly 'total' or 'amount':
  SUM(amount) AS total
  Never use 'total_amount', 'sum_amount', or other variants.
- "payment method" refers to how a transaction was made (UPI,
  NEFT, IMPS, cash etc.) — this is NOT a column in the database.
  If the user asks about payment method, explain that this
  information is not available in the transaction data, and
  offer to break down by merchant or category instead.
- The following questions should always be answered with run_sql:
  "credits vs debits", "credits versus debits", "income vs expenses" → 
  query debits and credits grouped by month

Behaviour:
  - Use run_sql when the user asks about their financial data
  - If the question is a follow-up, use conversation history
    to carry forward all relevant filters (merchant, category,
    date range) unless the user explicitly changes them
  - If the question is ambiguous and context doesn't resolve
    it, respond directly with a short clarifying question
    (do NOT call run_sql)
  - If the question is clearly unrelated to personal finance,
    respond directly: "I can only answer questions about your transactions and spending."
  - Keep all direct responses to 1-2 sentences
  - Always use ${currency} for currency amounts
  - Lead with the answer, never repeat the question back`
}

type AgentResult =
  | { type: "sql_result"; sql: string; rows: Record<string, unknown>[]; summary: string; chartType: string }
  | { type: "direct_response"; response: string }

async function runAgentLoop(
  question: string,
  userId: string,
  accountId: string,
  history: HistoryEntry[],
  dateContext: string,
  currency: string,
): Promise<AgentResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: AGENT_SYSTEM_PROMPT(userId, accountId, currency, dateContext),
    },
    ...history.map(h => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: question },
  ]

  const tools: OpenAI.Chat.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "run_sql",
        description: "Execute a SELECT query against the user's transactions",
        parameters: {
          type: "object" as const,
          properties: {
            sql: {
              type: "string",
              description: "The PostgreSQL SELECT query to execute",
            },
            chart_type: {
              type: "string",
              enum: ["line", "bar", "horizontal_bar", "comparison_bar", "pie", "table", "none"],
              description: `Pick the best visualization for the query result:
              - line: ALWAYS use when query groups by day/week/month over time — any time series, trends, "by month", "by day", "by week", "over time", "last N months"
              - bar: category or merchant ranked by total amount (vertical bars) — use when comparing named groups, NOT time periods
              - horizontal_bar: top merchants ranked by spend (horizontal) — use when there are many items or long labels
              - comparison_bar: exactly two numeric values per time period (debits AND credits by month)
              - pie: category breakdown showing proportions/percentages of a whole
              - table: multi-dimension results, raw transaction lists, or anything with 3+ columns
              - none: single scalar answer (one number, e.g. "total spent in March")

              CRITICAL: If the query has a time column (day/week/month/date), ALWAYS use line, bar, or comparison_bar — never table.`,
            },
          },
          required: ["sql", "chart_type"],
        },
      },
    },
  ]

  // First LLM call — may or may not call the tool
  let firstResponse = ""
  let toolCallId = ""
  let toolCallArgs = ""
  let toolCallName = ""

  const firstStream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    stream: true,
    user: "oikos-ledger",
    messages,
    tools,
    tool_choice: "auto",
  })

  for await (const chunk of firstStream) {
    const delta = chunk.choices[0]?.delta
    if (delta?.content) {
      firstResponse += delta.content
    }
    if (delta?.tool_calls?.[0]) {
      const tc = delta.tool_calls[0]
      if (tc.id) toolCallId = tc.id
      if (tc.function?.name) toolCallName = tc.function.name
      if (tc.function?.arguments) toolCallArgs += tc.function.arguments
    }
  }

  // No tool call — direct response (clarification or off-topic)
  if (!toolCallId || toolCallName !== "run_sql") {
    console.log("Agent direct response:", firstResponse.trim())
    return { type: "direct_response", response: firstResponse.trim() }
  }

  // Parse and validate SQL
  let parsedSQL = ""
  let inferredAgentChart = ""
  try {
    const parsed = JSON.parse(toolCallArgs) as { sql: string; chart_type?: string }
    parsedSQL = parsed.sql?.trim() ?? ""
    inferredAgentChart = parsed.chart_type?.trim().toLowerCase() ?? ""
    console.log("tool args parsed:", JSON.stringify({ parsedSQL: parsedSQL.slice(0, 80), chart_type: inferredAgentChart }))
    console.log("agent SQL:", parsedSQL, "Agent structural chart:", inferredAgentChart)
  } catch {
    return {
      type: "direct_response",
      response: "I had trouble generating the query. Could you rephrase?",
    }
  }

  const validation = validateSQL(parsedSQL)
  if (!validation.valid) {
    return {
      type: "direct_response",
      response: "I can only run SELECT queries on your transaction data.",
    }
  }

  if (!parsedSQL.toLowerCase().includes("limit")) {
    parsedSQL = `${parsedSQL.replace(/;+$/, "")} LIMIT 100`
  }

  // Execute SQL
  const results = (await dbReadonly.execute(
    sql.raw(parsedSQL),
  )) as unknown as { rows: Record<string, unknown>[] }
  const rows = results.rows ?? []

  // Second LLM call — synthesize result
  const toolResultMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...messages,
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: toolCallId,
          type: "function" as const,
          function: { name: "run_sql", arguments: toolCallArgs },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: toolCallId,
      content: JSON.stringify({ rows: rows.slice(0, 20) }),
    },
  ]

  const totalDebits = rows.reduce((sum, r) => sum + Number(r.debits ?? 0), 0)
  const totalCredits = rows.reduce((sum, r) => sum + Number(r.credits ?? 0), 0)
  const inferredChartType = inferredAgentChart || "table"

  const synthesisMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...toolResultMessages,
    {
      role: "user",
      content: `Summarize the results in 1-2 sentences.
The data is being rendered as a "${inferredChartType}" in the UI.
${totalDebits > 0 || totalCredits > 0 ? `Pre-computed totals — debits: ${totalDebits.toFixed(2)}, credits: ${totalCredits.toFixed(2)}` : ""}
Lead with the answer. Use ${currency} for amounts.`,
    },
  ]

  let summary = ""
  const synthesisStream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    stream: true,
    user: "oikos-ledger",
    messages: synthesisMessages,
  })

  for await (const chunk of synthesisStream) {
    summary += chunk.choices[0]?.delta?.content ?? ""
  }

  return {
    type: "sql_result",
    sql: parsedSQL,
    rows,
    summary: summary.trim(),
    chartType: inferredChartType,
  }
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

  console.log("date_from:", date_from)
  console.log("date_to:", date_to)
  console.log("dateFilter:", dateFilter)

  // Display command — re-plot without re-querying
  if (question && last_results && last_results.length > 0) {
    const q = question.toLowerCase()
    const hasDisplayPhrase = (
      q.includes("re-plot") || q.includes("replot") ||
      (q.includes("show") && q.includes("as")) ||
      q.includes("switch to") ||
      q.includes("change to") ||
      (q.includes("use") && (q.includes("pie chart") || q.includes("bar chart") || q.includes("line chart")))
    )
    const hasChartKeyword = (
      q.includes("pie") || q.includes("donut") ||
      q.includes("bar") || q.includes("line") || q.includes("table")
    )

    if (hasDisplayPhrase && hasChartKeyword) {
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
  }

  // Natural language → pre-built intent mapping
  // Catches conversational variants that don't go through quick buttons
  const resolvedIntent = intent ?? (() => {
    const q = (question ?? "").toLowerCase()
    if (!q) return null
    if (q.includes("credit") && (q.includes("debit") || q.includes("expense")))
      return "credits_vs_debits"
    if ((q.includes("monthly") || q.includes("month")) &&
        (q.includes("trend") || q.includes("over time") || q.includes("chart")))
      return "monthly_trend"
    if (q.includes("biggest") || q.includes("largest") || q.includes("top expense"))
      return "biggest_expenses"
    if (q.includes("top merchant") || q.includes("top merchants") ||
      q.includes("most spent") || q.includes("where did i spend") ||
      ((q.includes("top") || q.includes("most")) && q.includes("merchant")))
      return "top_merchants"
    if (q.includes("spending by category") || q.includes("category breakdown") ||
        q.includes("breakdown by category"))
      return "spending_by_category"
    return null
  })()

  // Two-tier cache lookup
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
  const similarHits = await getSimilarCacheHits(userId, account_id, embedding, queryHash)
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

  // Pre-built intent fast path — bypasses agent entirely
  const isPrebuilt = resolvedIntent && INTENTS[resolvedIntent as keyof typeof INTENTS]

  if (isPrebuilt) {
    const intentConfig = INTENTS[resolvedIntent as keyof typeof INTENTS]
    let querySQL = intentConfig.sql(userId, account_id, dateFilter)
    const chartType = intentConfig.chart_type
    let intentLabel = intentConfig.label
    let intentDescription = intentConfig.description
    const isCustom = false
    const finalIntent = resolvedIntent

    // Monthly trend: pick daily / weekly / monthly based on data span
    if (finalIntent === "monthly_trend") {
      console.log("Final querySQL:", querySQL)
      console.log("dateFilter:", dateFilter)
      console.log("account_id:", account_id)
      const rangeResult = (await dbReadonly.execute(sql.raw(`
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
      const results = (await dbReadonly.execute(
        sql.raw(querySQL),
      )) as unknown as { rows: Record<string, unknown>[] }
      const rows = results.rows ?? []

      const totalDebits = rows.reduce((sum, r) => sum + Number(r.debits ?? 0), 0)
      const totalCredits = rows.reduce((sum, r) => sum + Number(r.credits ?? 0), 0)

      const currencyResult = (await dbReadonly.execute(sql.raw(`
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
              intent: finalIntent,
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
              intent: finalIntent,
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

  // Custom query — run agent loop
  const currencyResult = (await dbReadonly.execute(sql.raw(`
    SELECT DISTINCT currency FROM transactions
    WHERE user_id = '${userId}' AND account_id = '${account_id}'
    LIMIT 1
  `))) as unknown as { rows: Record<string, unknown>[] }
  const currency = currencyResult.rows[0]?.currency as string ?? "INR"

  let agentResult: AgentResult
  try {
    agentResult = await runAgentLoop(
      question,
      userId,
      account_id,
      dedupedHistory,
      dateContext,
      currency,
    )
  } catch (error) {
    console.error("Agent loop failed:", error)
    return Response.json(
      { error: "Query failed", detail: String(error) },
      { status: 500 },
    )
  }

  // Direct response — clarification or off-topic
  if (agentResult.type === "direct_response") {
    return Response.json({
      type: "complete",
      question,
      intent: "finance_custom",
      intent_label: "Response",
      intent_description: "",
      is_custom: true,
      sql: "",
      results: [],
      response: agentResult.response,
      chart_type: "none",
      row_count: 0,
      cached: false,
    })
  }

  // SQL result — stream back with metadata
  const { sql: querySQL, rows, summary, chartType } = agentResult
  const intentLabel = "Custom query"
  const intentDescription = "Natural language → SQL"
  const isCustom = true
  const customQueryIntent = "finance_custom"

  const encoder = new TextEncoder()
  let fullResponseText = ""

  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        const metadata = {
          type: "metadata",
          intent: customQueryIntent,
          intent_label: intentLabel,
          intent_description: intentDescription,
          is_custom: isCustom,
          sql: querySQL,
          results: rows,
          chart_type: chartType,
          row_count: rows.length,
          cached: false,
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`)
        )

        // Stream the already-computed summary word by word
        const words = summary.split(" ")
        for (const word of words) {
          const text = word + " "
          fullResponseText += text
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "text", text })}\n\n`
            )
          )
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()

        const responsePayload = {
          question,
          intent: customQueryIntent,
          intent_label: intentLabel,
          intent_description: intentDescription,
          is_custom: isCustom,
          sql: querySQL,
          results: rows,
          response: summary,
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
}
