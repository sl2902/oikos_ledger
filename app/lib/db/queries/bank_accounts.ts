import { eq, desc } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { bank_accounts } from "@/lib/db/schema"
import type { NewBankAccount } from "@/types"

export async function getBankAccountsByUserId(userId: string) {
  return db.select()
  .from(bank_accounts)
  .where(eq(bank_accounts.user_id, userId))
  .orderBy(desc(bank_accounts.created_at))
}

export async function createBankAccount(data: NewBankAccount) {
  const [account] = await db.insert(bank_accounts).values(data).returning()
  return account
}
