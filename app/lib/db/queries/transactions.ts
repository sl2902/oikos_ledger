import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { merchants, transaction_amendments, transactions, uploads } from "@/lib/db/schema"
import type { UploadStatus } from "@/types"

export async function getTransactionsByAccount(
  userId: string,
  accountId: string,
  limit = 50,
  offset = 0,
) {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.user_id, userId), eq(transactions.account_id, accountId)))
    .orderBy(desc(transactions.transaction_date))
    .limit(limit)
    .offset(offset)
}

export async function getUploadByHash(userId: string, accountId: string, fileHash: string) {
  return db
    .select()
    .from(uploads)
    .where(
      and(
        eq(uploads.user_id, userId),
        eq(uploads.account_id, accountId),
        eq(uploads.file_hash, fileHash),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export async function createUpload(data: {
  user_id: string
  account_id: string
  filename: string
  file_hash: string
  s3_key: string
  status: UploadStatus
}) {
  const [upload] = await db.insert(uploads).values(data).returning()
  return upload
}

export async function getUploadById(uploadId: string) {
  return db
    .select()
    .from(uploads)
    .where(eq(uploads.id, uploadId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export async function cancelUpload(uploadId: string): Promise<boolean> {
  const [current] = await db
    .select({ status: uploads.status })
    .from(uploads)
    .where(eq(uploads.id, uploadId))
    .limit(1)

  if (!current || current.status === "complete") {
    return false
  }

  await db.delete(transactions).where(eq(transactions.upload_id, uploadId))
  await db.update(uploads).set({ status: "cancelled" }).where(eq(uploads.id, uploadId))

  return true
}

export async function deleteUpload(uploadId: string) {
  const txns = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.upload_id, uploadId))

  const txnIds = txns.map((t) => t.id)

  if (txnIds.length > 0) {
    await db
      .delete(transaction_amendments)
      .where(inArray(transaction_amendments.transaction_id, txnIds))
  }

  await db.delete(transactions).where(eq(transactions.upload_id, uploadId))
  await db.delete(uploads).where(eq(uploads.id, uploadId))
}

export async function getLatestAmendments(transactionIds: string[]) {
  if (transactionIds.length === 0) return []
  const rows = await db
    .select()
    .from(transaction_amendments)
    .where(inArray(transaction_amendments.transaction_id, transactionIds))
    .orderBy(
      transaction_amendments.transaction_id,
      transaction_amendments.field_name,
      desc(transaction_amendments.amended_at),
    )
  // Deduplicate in JS: keep first seen per (transaction_id, field_name) — already sorted desc
  const seen = new Set<string>()
  return rows.filter((a) => {
    const key = `${a.transaction_id}:${a.field_name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function createAmendments(
  transactionId: string,
  userId: string,
  amendments: { field_name: string; old_value: string; new_value: string }[],
  amendmentGroupId: string,
  reason?: string,
) {
  const values = amendments.map((a) => ({
    transaction_id: transactionId,
    amendment_group_id: amendmentGroupId,
    user_id: userId,
    field_name: a.field_name,
    old_value: a.old_value,
    new_value: a.new_value,
    amended_by: "user" as const,
    reason: reason ?? null,
  }))
  return db.insert(transaction_amendments).values(values).returning()
}

export async function upsertMerchantFromAmendment(
  oldCanonicalName: string,
  newCanonicalName: string,
  category: string,
) {
  // Best-effort update of merchant record so future normalizations use the corrected name.
  // Silent no-op if the old name isn't in the registry or the new name already exists.
  try {
    await db
      .update(merchants)
      .set({ canonical_name: newCanonicalName, category })
      .where(eq(merchants.canonical_name, oldCanonicalName))
  } catch {
    // Ignore unique-constraint violations if new canonical_name already exists
  }
}
