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
  if (!accountId)
    return NextResponse.json({ error: "account_id required" }, { status: 400 })

  const { rows } = await db.execute(sql.raw(`
    SELECT DISTINCT category
    FROM transactions
    WHERE user_id = '${session.user.id}'
      AND account_id = '${accountId}'
      AND category IS NOT NULL
    ORDER BY category
  `))

  return NextResponse.json(rows.map((r: Record<string, unknown>) => r.category))
}
