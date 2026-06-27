import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { bank_accounts, transaction_amendments, transactions, uploads } from "@/lib/db/schema"
import { and, eq, inArray } from "drizzle-orm"

export const dynamic = "force-dynamic"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ account_id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Prevent guest user from deleting accounts
  if (session.user.id === process.env.GUEST_USER_ID) {
    return Response.json(
      { error: "Account deletion is disabled in guest mode." },
      { status: 403 }
    )
  }

  const { account_id } = await params

  // Verify account belongs to user
  const account = await db
    .select()
    .from(bank_accounts)
    .where(
      and(
        eq(bank_accounts.id, account_id),
        eq(bank_accounts.user_id, session.user.id),
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!account) {
    return Response.json({ error: "Account not found" }, { status: 404 })
  }

  // Check no uploads are in progress
  const inProgressUploads = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(
      and(
        eq(uploads.account_id, account_id),
        inArray(uploads.status, ["pending", "processing"]),
      )
    )

  if (inProgressUploads.length > 0) {
    return Response.json(
      { error: "Cannot delete account with uploads in progress" },
      { status: 409 }
    )
  }

  // Get all transaction IDs for this account
  const accountTransactions = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.account_id, account_id))

  const transactionIds = accountTransactions.map((t) => t.id)

  // Cascade delete: amendments → transactions → uploads → account
  if (transactionIds.length > 0) {
    await db
      .delete(transaction_amendments)
      .where(inArray(transaction_amendments.transaction_id, transactionIds))
  }

  await db
    .delete(transactions)
    .where(eq(transactions.account_id, account_id))

  await db
    .delete(uploads)
    .where(eq(uploads.account_id, account_id))

  await db
    .delete(bank_accounts)
    .where(eq(bank_accounts.id, account_id))

  return Response.json({
    account_id,
    status: "deleted",
    transactions_deleted: transactionIds.length,
  })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ account_id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { account_id } = await params

  // Return account stats for confirmation dialog
  const account = await db
    .select()
    .from(bank_accounts)
    .where(
      and(
        eq(bank_accounts.id, account_id),
        eq(bank_accounts.user_id, session.user.id),
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!account) {
    return Response.json({ error: "Account not found" }, { status: 404 })
  }

  const uploadCount = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(eq(uploads.account_id, account_id))
    .then((rows) => rows.length)

  const transactionCount = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.account_id, account_id))
    .then((rows) => rows.length)

  return Response.json({
    account_id,
    bank_name: account.bank_name,
    account_type: account.account_type,
    account_nickname: account.account_nickname,
    upload_count: uploadCount,
    transaction_count: transactionCount,
  })
}
