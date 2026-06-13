import { auth } from "@/auth"
import {
  createBankAccount,
  getBankAccountsByUserId,
} from "@/lib/db/queries/bank_accounts"
import type { AccountType } from "@/types"

const VALID_ACCOUNT_TYPES: AccountType[] = ["checking", "savings", "credit"]

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const accounts = await getBankAccountsByUserId(session.user.id)
  return Response.json(accounts)
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { bank_name, account_type, account_nickname, currency } = body

  if (!bank_name || typeof bank_name !== "string") {
    return Response.json({ error: "bank_name is required" }, { status: 400 })
  }

  if (!VALID_ACCOUNT_TYPES.includes(account_type)) {
    return Response.json(
      { error: "account_type must be checking, savings, or credit" },
      { status: 400 },
    )
  }

  if (!currency || typeof currency !== "string") {
    return Response.json({ error: "currency is required" }, { status: 400 })
  }

  const account = await createBankAccount({
    user_id: session.user.id,
    bank_name,
    account_type: account_type as AccountType,
    account_nickname: account_nickname ?? null,
    currency,
  })

  return Response.json(account, { status: 201 })
}
