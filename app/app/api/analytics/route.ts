import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { sql } from "drizzle-orm"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { account_id, dimension, months = 3, category, transaction_type = "debit" } =
    await req.json()

  if (!account_id || !dimension)
    return NextResponse.json({ error: "account_id and dimension required" }, { status: 400 })

  const userId = session.user.id

  const dateFilter = `
    AND transaction_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '${months - 1} months'
    AND transaction_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
  `

  const typeFilter = transaction_type === "all"
    ? ""
    : `AND transaction_type = '${transaction_type}'`

  let rows: unknown[] = []

  if (dimension === "merchants") {
    const categoryFilter = category ? `AND category = '${category}'` : ""
    const result = await db.execute(sql.raw(`
      SELECT
        normalized_merchant,
        SUM(amount) AS total,
        COUNT(*) AS txn_count
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${account_id}'
        ${typeFilter}
        ${dateFilter}
        ${categoryFilter}
        AND normalized_merchant IS NOT NULL
        AND normalized_merchant != ''
      GROUP BY normalized_merchant
      ORDER BY total DESC
      LIMIT 15
    `))
    rows = result.rows

  } else if (dimension === "payment_methods") {
    const result = await db.execute(sql.raw(`
      SELECT
        TO_CHAR(transaction_date, 'YYYY-MM') AS month,
        COALESCE(payment_method, 'Other') AS payment_method,
        SUM(amount) AS total
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${account_id}'
        ${typeFilter}
        ${dateFilter}
      GROUP BY month, payment_method
      ORDER BY month, total DESC
    `))
    const raw = result.rows as Record<string, unknown>[]
    const months_list = [...new Set(raw.map(r => r.month as string))].sort()
    const methods = [...new Set(raw.map(r => r.payment_method as string))]
    const pivoted = months_list.map(m => {
      const row: Record<string, unknown> = { month: m }
      for (const method of methods) {
        const found = raw.find(r => r.month === m && r.payment_method === method)
        row[method] = found ? Number(found.total) : 0
      }
      return row
    })
    rows = pivoted

  } else if (dimension === "subcategories") {
    const categoryFilter = category ? `AND category = '${category}'` : ""
    const result = await db.execute(sql.raw(`
      SELECT
        COALESCE(subcategory, 'Uncategorised') AS subcategory,
        SUM(amount) AS total,
        COUNT(*) AS txn_count
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${account_id}'
        ${typeFilter}
        ${dateFilter}
        ${categoryFilter}
        AND subcategory IS NOT NULL
      GROUP BY subcategory
      ORDER BY total DESC
      LIMIT 15
    `))
    rows = result.rows

  } else if (dimension === "debit_credit") {
    const result = await db.execute(sql.raw(`
      SELECT
        TO_CHAR(transaction_date, 'YYYY-MM') AS month,
        SUM(CASE WHEN transaction_type = 'debit' THEN amount ELSE 0 END) AS debits,
        SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE 0 END) AS credits
      FROM transactions
      WHERE user_id = '${userId}'
        AND account_id = '${account_id}'
        ${dateFilter}
      GROUP BY month
      ORDER BY month
    `))
    rows = result.rows
  }

  return NextResponse.json({ rows, dimension })
}
