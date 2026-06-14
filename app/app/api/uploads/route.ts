import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { uploads } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const account_id = searchParams.get("account_id")
  if (!account_id) {
    return Response.json({ error: "account_id required" }, { status: 400 })
  }

  const rows = await db
    .select({
      id: uploads.id,
      filename: uploads.filename,
      status: uploads.status,
      row_count: uploads.row_count,
      balance_verified: uploads.balance_verified,
      balance_discrepancy: uploads.balance_discrepancy,
      opening_balance: uploads.opening_balance,
      closing_balance: uploads.closing_balance,
      dropped_rows: uploads.dropped_rows,
      uploaded_at: uploads.uploaded_at,
      completed_at: uploads.completed_at,
    })
    .from(uploads)
    .where(
      and(
        eq(uploads.user_id, session.user.id),
        eq(uploads.account_id, account_id),
      ),
    )
    .orderBy(desc(uploads.uploaded_at))

  return Response.json({ uploads: rows })
}
