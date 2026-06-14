import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import type { bank_accounts, transaction_amendments, transactions, uploads, users } from "@/lib/db/schema"

export type User = InferSelectModel<typeof users>
export type NewUser = Omit<InferInsertModel<typeof users>, "id" | "created_at">

export type BankAccount = InferSelectModel<typeof bank_accounts>
export type NewBankAccount = Omit<
  InferInsertModel<typeof bank_accounts>,
  "id" | "created_at"
>

export type AccountType = "checking" | "savings" | "credit"

export type Transaction = InferSelectModel<typeof transactions>
export type Upload = InferSelectModel<typeof uploads>
export type UploadStatus = "pending" | "processing" | "complete" | "failed" | "cancelled"

export type TransactionAmendment = InferSelectModel<typeof transaction_amendments>

export interface EffectiveTransaction extends Transaction {
  payment_method: string
  is_amended: boolean
  closing_balance: string | null
}

export interface UploadStatusResponse {
  upload_id: string
  status: string
  row_count: number | null
  error_message: string | null
}

export interface DroppedRow {
  row_number: number
  date: string
  narration: string
  debit: string
  credit: string
  reference: string
  reason: "zero_amount" | "duplicate_reference" | "malformed_row" | "invalid_date" | "missing_narration"
}

export interface AmendmentRequest {
  amendments: {
    field_name: "normalized_merchant" | "category" | "subcategory" | "payment_method"
    old_value: string
    new_value: string
  }[]
  reason?: string
}
