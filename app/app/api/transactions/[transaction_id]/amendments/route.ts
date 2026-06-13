import { auth } from "@/auth"
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { transaction_amendments, transactions } from "@/lib/db/schema"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ transaction_id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { transaction_id } = await params

  const [txn] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, transaction_id), eq(transactions.user_id, session.user.id)))
    .limit(1)

  if (!txn) {
    return Response.json({ error: "Transaction not found" }, { status: 404 })
  }

  const amendments = await db
    .select()
    .from(transaction_amendments)
    .where(eq(transaction_amendments.transaction_id, transaction_id))
    .orderBy(desc(transaction_amendments.amended_at))

  return Response.json({ amendments })
}
