import { auth } from "@/auth"
import { and, eq } from "drizzle-orm"
import { randomUUID } from "crypto"
import { db } from "@/lib/db/client"
import { transactions } from "@/lib/db/schema"
import {
  createAmendments,
  upsertMerchantFromAmendment,
} from "@/lib/db/queries/transactions"
import type { AmendmentRequest } from "@/types"

const AMENDABLE_FIELDS = new Set([
  "normalized_merchant",
  "category",
  "subcategory",
  "payment_method",
])

function cleanMerchantName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[^a-zA-Z0-9]+$/, "")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

function isValidMerchantName(
  name: string,
  rawDescription: string,
): { valid: boolean; error?: string } {
  const trimmed = name.trim()

  if (trimmed.length < 3) {
    return { valid: false, error: "Merchant name must be at least 3 characters" }
  }

  if (trimmed.length > 50) {
    return { valid: false, error: "Merchant name must be 50 characters or less" }
  }

  if (trimmed.toLowerCase() === rawDescription.toLowerCase()) {
    return { valid: false, error: "Merchant name cannot be the same as the raw description" }
  }

  // Reject bare payment gateway codes — random uppercase-alphanumeric strings over 8 chars
  if (/^[A-Z0-9]{8,}$/i.test(trimmed)) {
    return { valid: false, error: "Merchant name appears to be a payment code, not a name" }
  }

  // Reject payment gateway prefix pattern — ALPHANUM6+/something
  if (/^[A-Z0-9]{6,}\//.test(trimmed)) {
    return { valid: false, error: "Merchant name contains a payment gateway code" }
  }

  return { valid: true }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ transaction_id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { transaction_id } = await params

  const [txn] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, transaction_id), eq(transactions.user_id, session.user.id)))
    .limit(1)

  if (!txn) {
    return Response.json({ error: "Transaction not found" }, { status: 404 })
  }

  const body = (await request.json()) as AmendmentRequest
  const { amendments, reason } = body

  if (!amendments || amendments.length === 0) {
    return Response.json({ error: "No amendments provided" }, { status: 400 })
  }

  for (const amendment of amendments) {
    if (!AMENDABLE_FIELDS.has(amendment.field_name)) {
      return Response.json(
        { error: `Field "${amendment.field_name}" is not amendable` },
        { status: 400 },
      )
    }
  }

  const amendmentGroupId = randomUUID()

  await createAmendments(transaction_id, session.user.id, amendments, amendmentGroupId, reason)

  const merchantAmendment = amendments.find((a) => a.field_name === "normalized_merchant")
  if (merchantAmendment) {
    const cleaned = cleanMerchantName(merchantAmendment.new_value)
    const validation = isValidMerchantName(cleaned, txn.raw_description)

    if (validation.valid) {
      const categoryAmendment = amendments.find((a) => a.field_name === "category")
      await upsertMerchantFromAmendment(
        merchantAmendment.old_value,
        cleaned,
        categoryAmendment?.new_value ?? txn.category,
      )
    }
    // If invalid — amendment is still saved to transaction_amendments above.
    // Merchants table upsert is skipped silently; the correction is not shared.
  }

  // Subcategories are private per user — they exist only in
  // transaction_amendments scoped to user_id.
  // They are never written to the merchants table or any shared
  // reference table. This is intentional — subcategory is a
  // personal interpretation of a transaction, not a shared fact.

  return Response.json({ success: true, amendment_group_id: amendmentGroupId })
}
