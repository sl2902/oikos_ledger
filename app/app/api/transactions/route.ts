import { auth } from "@/auth"
import { and, asc, desc, eq, gte, ilike, lt, lte, or, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { transactions, uploads } from "@/lib/db/schema"
import { getLatestAmendments } from "@/lib/db/queries/transactions"

function computePaymentMethod(rawDescription: string): string {
  const d = rawDescription.toLowerCase()
  if (d.includes("upi-") || d.includes("/upi/") || d.includes("upi/")) return "UPI"
  if (d.includes("neft")) return "NEFT"
  if (d.includes("imps")) return "IMPS"
  if (d.includes("rtgs")) return "RTGS"
  if (d.includes("atm") || d.includes("atw")) return "ATM"
  if (d.includes("pos/") || d.includes("/pos")) return "POS"
  if (d.includes("billpay") || d.includes("bill pay") || d.includes("nach dr")) return "Bill Pay"
  if (d.includes("sal cr") || d.includes("salary cr")) return "Salary"
  if (d.includes("emi")) return "EMI"
  return "Transfer"
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const account_id = searchParams.get("account_id")
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const offset = (page - 1) * limit

  const search = searchParams.get("search")
  const category = searchParams.get("category")
  const month = searchParams.get("month")
  const date_from = searchParams.get("date_from")
  const date_to = searchParams.get("date_to")
  const amount_min = searchParams.get("amount_min")
  const amount_max = searchParams.get("amount_max")
  const transaction_type = searchParams.get("transaction_type")

  if (!account_id) {
    return Response.json({ error: "account_id is required" }, { status: 400 })
  }

  const userId = session.user.id
  const accountId = account_id

  const conditions = [
    eq(transactions.user_id, userId),
    eq(transactions.account_id, accountId),
  ]

  let monthFilter = ""
  if (month) {
    const [y, m] = month.split("-").map(Number)
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`
    const nextM = m === 12 ? 1 : m + 1
    const nextY = m === 12 ? y + 1 : y
    const nextMonthStart = `${nextY}-${String(nextM).padStart(2, "0")}-01`
    conditions.push(gte(transactions.transaction_date, monthStart))
    conditions.push(lt(transactions.transaction_date, nextMonthStart))
    monthFilter = `AND transaction_date >= '${monthStart}' AND transaction_date < '${nextMonthStart}'`
  }

  if (search) {
      const searchCondition = or(
        ilike(transactions.normalized_merchant, `%${search}%`),
        ilike(transactions.raw_description, `%${search}%`)
      )
    if (searchCondition) conditions.push(searchCondition)
  }
  if (category) conditions.push(eq(transactions.category, category))
  if (date_from) conditions.push(gte(transactions.transaction_date, date_from))
  if (date_to) conditions.push(lte(transactions.transaction_date, date_to))
  if (amount_min) conditions.push(gte(transactions.amount, amount_min))
  if (amount_max) conditions.push(lte(transactions.amount, amount_max))
  
  if (transaction_type === "debit" || transaction_type === "credit") {
    conditions.push(eq(transactions.transaction_type, transaction_type))
  }

  const where = and(...conditions)

  // Fetch all matching transactions — used for month totals and stable balance computation
  const allRows = await db
    .select()
    .from(transactions)
    .where(where)
    .orderBy(desc(transactions.transaction_date), desc(transactions.row_number))

  const total = allRows.length
  const total_pages = Math.ceil(total / limit)

  // Paginate in memory to avoid a second DB round-trip
  const rows = allRows.slice(offset, offset + limit)

  const transactionIds = rows.map((r) => r.id)
  const latestAmendments = await getLatestAmendments(transactionIds)

  // Build amendment map: transactionId → { fieldName → newValue }
  const amendmentMap = new Map<string, Map<string, string>>()
  for (const amendment of latestAmendments) {
    if (!amendmentMap.has(amendment.transaction_id)) {
      amendmentMap.set(amendment.transaction_id, new Map())
    }
    amendmentMap.get(amendment.transaction_id)!.set(amendment.field_name, amendment.new_value)
  }

  const effectiveTransactions = rows.map((txn) => {
    const amendments = amendmentMap.get(txn.id)
    return {
      ...txn,
      normalized_merchant: amendments?.get("normalized_merchant") ?? txn.normalized_merchant,
      category: amendments?.get("category") ?? txn.category,
      subcategory: amendments?.get("subcategory") ?? txn.subcategory,
      payment_method:
        amendments?.get("payment_method") ?? txn.payment_method ?? computePaymentMethod(txn.raw_description),
      is_amended: !!amendments,
    }
  })

  // Month totals from full unpaginated result
  const totalDebits = allRows
    .filter((t) => t.transaction_type === "debit")
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const totalCredits = allRows
    .filter((t) => t.transaction_type === "credit")
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const latestUpload = await db
    .select({
      balance_verified: uploads.balance_verified,
      balance_discrepancy: uploads.balance_discrepancy,
    })
    .from(uploads)
    .where(and(
      eq(uploads.user_id, userId),
      eq(uploads.account_id, accountId),
      eq(uploads.status, "complete"),
    ))
    .orderBy(desc(uploads.uploaded_at))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return Response.json({
    transactions: effectiveTransactions,
    total,
    page,
    limit,
    total_pages,
    closing_balance: null,
    opening_balance: null,
    balance_verified: latestUpload?.balance_verified ?? null,
    balance_discrepancy: latestUpload?.balance_discrepancy ?? null,
    month_total_debits: totalDebits.toFixed(2),
    month_total_credits: totalCredits.toFixed(2),
  })
}
