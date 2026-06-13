"use client"

import { useState } from "react"
import { BankAccountsSection } from "@/components/bank_accounts/BankAccountsSection"
import { TransactionList } from "@/components/transactions/TransactionList"

export function DashboardClient() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

  return (
    <>
      <BankAccountsSection
        selectedAccountId={selectedAccountId ?? undefined}
        onAccountSelect={setSelectedAccountId}
      />

      {selectedAccountId && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Transactions</h2>
          <TransactionList accountId={selectedAccountId} />
        </section>
      )}
    </>
  )
}
