import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { sql } from "drizzle-orm"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get("account_id")
  const dateFrom = searchParams.get("date_from")
  const dateTo = searchParams.get("date_to")

  if (!accountId)
    return NextResponse.json({ error: "account_id required" }, { status: 400 })

  const userId = session.user.id

  const dateFilter = [
    dateFrom ? `AND transaction_date >= '${dateFrom}'` : "",
    dateTo ? `AND transaction_date <= '${dateTo}'` : "",
  ].join(" ")

  if (!dateFilter.trim())
    return NextResponse.json({ balances: {} })

  // First transaction per month for opening balance
  const { rows: firstRows } = await db.execute(sql.raw(`
    SELECT DISTINCT ON (TO_CHAR(transaction_date, 'YYYY-MM'))
      TO_CHAR(transaction_date, 'YYYY-MM') AS month,
      closing_balance,
      amount,
      transaction_type
    FROM transactions
    WHERE user_id = '${userId}'
      AND account_id = '${accountId}'
      ${dateFilter}
    ORDER BY TO_CHAR(transaction_date, 'YYYY-MM'),
             transaction_date ASC, row_number ASC
  `))

  // Last transaction per month for closing balance
  const { rows: lastRows } = await db.execute(sql.raw(`
    SELECT DISTINCT ON (TO_CHAR(transaction_date, 'YYYY-MM'))
      TO_CHAR(transaction_date, 'YYYY-MM') AS month,
      closing_balance
    FROM transactions
    WHERE user_id = '${userId}'
      AND account_id = '${accountId}'
      ${dateFilter}
    ORDER BY TO_CHAR(transaction_date, 'YYYY-MM'),
             transaction_date DESC, row_number DESC
  `))

  const closingByMonth: Record<string, string> = {}
  for (const row of lastRows as any[]) {
    closingByMonth[row.month] = String(Number(row.closing_balance))
  }

  const balances: Record<string, { opening: string | null; closing: string | null }> = {}
  for (const row of firstRows as any[]) {
    const month = row.month as string
    const firstClosing = Number(row.closing_balance)
    const firstAmount = Number(row.amount)
    const opening = row.transaction_type === "debit"
      ? String(firstClosing + firstAmount)
      : String(firstClosing - firstAmount)
    balances[month] = {
      opening,
      closing: closingByMonth[month] ?? null,
    }
  }

  return NextResponse.json({ balances })
}
