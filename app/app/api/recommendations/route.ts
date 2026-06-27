import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { sql } from "drizzle-orm"
import OpenAI from "openai"

export const dynamic = "force-dynamic"

const DISCRETIONARY = ["Food", "Shopping", "Entertainment", "Transport", "Travel", "Health"]
const UTILITY_ANOMALY_THRESHOLD = 2.0
const HEALTH_ANOMALY_THRESHOLD = 1.5

const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { account_id } = await req.json()
  if (!account_id) return NextResponse.json({ error: "account_id required" }, { status: 400 })

  const userId = session.user.id
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
  const dayOfMonth = now.getDate()
  const elapsedFraction = dayOfMonth / daysInMonth
  const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, "0")}`

  // Check if user has any data at all
  const { rows: checkRows } = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt
    FROM transactions
    WHERE user_id = '${userId}'
      AND account_id = '${account_id}'
  `))
  if (!checkRows.length || Number((checkRows[0] as any).cnt) === 0) {
    return NextResponse.json({
      recommendations: [],
      positive: false,
      total_savings: 0,
      message: "",
      current_month: currentMonthKey,
      insufficient_data: true,
      baseline_months_available: 0,
      warning: null,
    })
  }

  const { rows } = await db.execute(sql.raw(`
    SELECT
      category,
      TO_CHAR(transaction_date, 'YYYY-MM') AS month,
      SUM(amount) AS total
    FROM transactions
    WHERE user_id = '${userId}'
      AND account_id = '${account_id}'
      AND transaction_type = 'debit'
      AND transaction_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'
      AND transaction_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
      AND category != 'Other'
    GROUP BY category, month
    ORDER BY category, month
  `))

  const categoryMap: Record<string, { baseline: number[]; current: number }> = {}

  for (const row of rows) {
    const cat = row.category as string
    const month = row.month as string
    const total = Number(row.total)

    if (!categoryMap[cat]) categoryMap[cat] = { baseline: [], current: 0 }

    if (month === currentMonthKey) {
      categoryMap[cat].current = total
    } else {
      categoryMap[cat].baseline.push(total)
    }
  }

  // Check if current month has any discretionary spend — fall back to last uploaded month if not
  const hasCurrentMonthSpend = DISCRETIONARY.some((cat) => categoryMap[cat]?.current > 0)

  let analysisMonthKey = currentMonthKey
  let isStale = false

  if (!hasCurrentMonthSpend) {
    const { rows: recentMonthRows } = await db.execute(sql.raw(`
      SELECT TO_CHAR(MAX(transaction_date), 'YYYY-MM') AS recent_month
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${account_id}'
        AND transaction_type = 'debit'
    `))

    const recentMonth = (recentMonthRows[0] as any)?.recent_month as string | null

    if (recentMonth && recentMonth !== currentMonthKey) {
      analysisMonthKey = recentMonth
      isStale = true

      const { rows: fallbackRows } = await db.execute(sql.raw(`
        SELECT
          category,
          TO_CHAR(transaction_date, 'YYYY-MM') AS month,
          SUM(amount) AS total
        FROM transactions
        WHERE user_id = '${userId}'
          AND account_id = '${account_id}'
          AND transaction_type = 'debit'
          AND transaction_date >= DATE_TRUNC('month', TO_DATE('${recentMonth}', 'YYYY-MM')) - INTERVAL '3 months'
          AND transaction_date < DATE_TRUNC('month', TO_DATE('${recentMonth}', 'YYYY-MM')) + INTERVAL '1 month'
          AND category != 'Other'
        GROUP BY category, month
        ORDER BY category, month
      `))

      for (const key of Object.keys(categoryMap)) delete categoryMap[key]
      for (const row of fallbackRows as any[]) {
        const cat = row.category as string
        const month = row.month as string
        const total = Number(row.total)
        if (!categoryMap[cat]) categoryMap[cat] = { baseline: [], current: 0 }
        if (month === analysisMonthKey) {
          categoryMap[cat].current = total
        } else {
          categoryMap[cat].baseline.push(total)
        }
      }
    }
  }

  // Stale month is complete; current calendar month uses real elapsed fraction
  const effectiveElapsedFraction = isStale ? 1.0 : elapsedFraction
  console.log("[recs] dayOfMonth:", dayOfMonth, "daysInMonth:", daysInMonth, "elapsedFraction:", elapsedFraction, "isStale:", isStale, "effectiveElapsedFraction:", effectiveElapsedFraction)

  // Derive baseline month count from the fetched rows
  const distinctMonths = new Set(
    (rows as any[]).map((r: any) => r.month as string)
  )
  distinctMonths.delete(analysisMonthKey)
  const baselineMonthCount = distinctMonths.size

  const hasInsufficientData = baselineMonthCount === 0
  const hasLimitedData = baselineMonthCount < 3

  if (hasInsufficientData) {
    return NextResponse.json({
      recommendations: [],
      positive: false,
      total_savings: 0,
      message: "",
      current_month: currentMonthKey,
      analysis_month: analysisMonthKey,
      is_stale: isStale,
      insufficient_data: true,
      baseline_months_available: 0,
      warning: null,
    })
  }

  const warning = hasLimitedData
    ? `Recommendations are based on ${baselineMonthCount} month${baselineMonthCount === 1 ? "" : "s"} of history instead of 3. Upload more statements for more accurate insights.`
    : null

  const recommendations: {
    category: string
    baseline_monthly: number
    current_spend: number
    projected_spend: number
    variance: number
    top_merchants: string[]
    day_of_month: number
    days_in_month: number
    is_stale: boolean
    insight: string
    impact: string
    action: string
    is_positive: boolean
  }[] = []

  const categoriesToCheck = [...DISCRETIONARY, "Utilities"]

  for (const category of categoriesToCheck) {
    const data = categoryMap[category]
    if (!data || data.baseline.length === 0) continue

    const baselineMonthly = data.baseline.reduce((a, b) => a + b, 0) / data.baseline.length
    const projectedSpend = effectiveElapsedFraction > 0 ? data.current / effectiveElapsedFraction : data.current
    const variance = projectedSpend - baselineMonthly

    if (category === "Utilities") {
      if (baselineMonthly === 0) continue
      if (projectedSpend / baselineMonthly < UTILITY_ANOMALY_THRESHOLD) continue
    }

    if (category === "Health") {
      if (baselineMonthly === 0) continue
      if (projectedSpend / baselineMonthly < HEALTH_ANOMALY_THRESHOLD) continue
    }

    if (variance <= baselineMonthly * 0.05) continue

    const { rows: merchantRows } = await db.execute(sql.raw(`
      SELECT
        t.normalized_merchant,
        SUM(t.amount) AS total,
        m.subcategory
      FROM transactions t
      LEFT JOIN merchants m ON LOWER(m.canonical_name) = LOWER(t.normalized_merchant)
      WHERE t.user_id = '${userId}'
        AND t.account_id = '${account_id}'
        AND t.transaction_type = 'debit'
        AND t.category = '${category}'
        AND TO_CHAR(t.transaction_date, 'YYYY-MM') = '${analysisMonthKey}'
      GROUP BY t.normalized_merchant, m.subcategory
      ORDER BY total DESC
      LIMIT 2
    `))

    const topMerchants = merchantRows.map((r: any) =>
      r.subcategory
        ? `${r.normalized_merchant} (${r.subcategory})`
        : r.normalized_merchant as string
    )

    recommendations.push({
      category,
      baseline_monthly: baselineMonthly,
      current_spend: data.current,
      projected_spend: projectedSpend,
      variance,
      top_merchants: topMerchants,
      day_of_month: dayOfMonth,
      days_in_month: daysInMonth,
      is_stale: isStale,
      insight: "",
      impact: "",
      action: "",
      is_positive: false,
    })
  }

  recommendations.sort((a, b) => b.variance - a.variance)
  const top3 = recommendations.slice(0, 3)

  // Always compute savings breakdown for under-baseline categories
  let totalSavings = 0
  const categoryBreakdown: {
    category: string
    baseline_monthly: number
    current_spend: number
    projected_spend: number
    saving: number
  }[] = []

  for (const category of DISCRETIONARY) {
    const data = categoryMap[category]
    if (!data || data.baseline.length === 0) continue
    if (data.current === 0) continue
    const baselineMonthly = data.baseline.reduce((a, b) => a + b, 0) / data.baseline.length
    const projected = effectiveElapsedFraction > 0
      ? data.current / effectiveElapsedFraction
      : data.current
    const saving = baselineMonthly - projected
    if (saving <= 0) continue
    if (saving > 0) totalSavings += saving
    categoryBreakdown.push({
      category,
      baseline_monthly: Math.round(baselineMonthly),
      current_spend: Math.round(data.current),
      projected_spend: Math.round(projected),
      saving: Math.round(saving),
    })
  }

  const prompt = `You are a personal finance advisor for Indian users.
Generate concise, actionable recommendations for overspending categories.
Use Indian Rupee (₹). Be specific, warm, and practical.
Reference the top merchants if provided.
Keep each field to 1-2 sentences maximum.
CRITICAL: Use ONLY the exact numbers provided in the data below.
Do NOT compute or estimate your own figures.
Use projected_spend, variance, and current_spend exactly as given.
Do not round differently or substitute your own calculations.
${isStale
  ? "IMPORTANT: This data is for a COMPLETED past month. Write insight in past tense — what happened, not what might happen. Action should focus on the upcoming month."
  : "This is the current month in progress. Write insight to reflect ongoing spending."}
For Health category specifically: acknowledge that health spending can be unpredictable and avoid making the user feel guilty. Frame the insight as awareness, not criticism. Suggest practical steps like checking if purchases were necessary or could be optimised (e.g. generic medicines vs branded).

Respond with a JSON array of objects with these exact keys:
insight, action

Do NOT include impact — it will be generated separately.

Categories data:
${JSON.stringify(top3.map(r => ({
  category: r.category,
  baseline_monthly: Math.round(r.baseline_monthly),
  current_spend: Math.round(r.current_spend),
  projected_spend: Math.round(r.projected_spend),
  variance: Math.round(r.variance),
  top_merchants: r.top_merchants,
  days_elapsed: dayOfMonth,
  days_in_month: daysInMonth,
})), null, 2)}

Respond with JSON array only, no other text.`

  try {
    const llmResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 600,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    })

    const text = llmResponse.choices[0].message.content || "[]"
    const start = text.indexOf("[")
    const end = text.lastIndexOf("]") + 1
    const cards = JSON.parse(text.slice(start, end))

    top3.forEach((rec, i) => {
      if (cards[i]) {
        rec.insight = cards[i].insight || ""
        rec.action = cards[i].action || ""
      }
      // Generate impact programmatically using exact numbers
      const projectedFmt = Math.round(rec.projected_spend).toLocaleString("en-IN")
      const varianceFmt = Math.round(rec.variance).toLocaleString("en-IN")
      const baselineFmt = Math.round(rec.baseline_monthly).toLocaleString("en-IN")
      rec.impact = rec.is_stale
        ? `You spent ₹${varianceFmt} more than your usual baseline of ₹${baselineFmt}.`
        : `At this pace, you are projected to spend ₹${projectedFmt} — ₹${varianceFmt} above your baseline of ₹${baselineFmt}.`
    })
  } catch {
    top3.forEach((rec) => {
      rec.insight = `You've spent ₹${Math.round(rec.current_spend).toLocaleString("en-IN")} on ${rec.category} so far this month.`
      const projectedFmt = Math.round(rec.projected_spend).toLocaleString("en-IN")
      const varianceFmt = Math.round(rec.variance).toLocaleString("en-IN")
      const baselineFmt = Math.round(rec.baseline_monthly).toLocaleString("en-IN")
      rec.impact = rec.is_stale
        ? `You spent ₹${varianceFmt} more than your usual baseline of ₹${baselineFmt}.`
        : `At this pace, you are projected to spend ₹${projectedFmt} — ₹${varianceFmt} above your baseline of ₹${baselineFmt}.`
      rec.action = `Review your ${rec.category.toLowerCase()} spending and identify what you can reduce.`
    })
  }

  const isFullyPositive = top3.length === 0

  return NextResponse.json({
    recommendations: top3,
    positive: isFullyPositive,
    total_savings: totalSavings,
    message: isFullyPositive
      ? `You're beating your 3-month baseline across every discretionary category. Projected to save ₹${Math.round(totalSavings).toLocaleString("en-IN")} extra this month.`
      : categoryBreakdown.length > 0
      ? `You're overspending in some areas but saving in others. Keep it up on the wins!`
      : "",
    current_month: currentMonthKey,
    analysis_month: analysisMonthKey,
    is_stale: isStale,
    category_breakdown: categoryBreakdown,
    insufficient_data: false,
    baseline_months_available: baselineMonthCount,
    warning,
  })
}
