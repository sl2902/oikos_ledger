"use client"

import { AddBankAccountModal } from "./AddBankAccountModal"
import { BankLogo } from "./BankLogo"
import { getBankDomain } from "@/lib/constants/banks"
import type { SupportedBankName } from "@/lib/constants/banks"
import { SUPPORTED_CURRENCIES } from "@/lib/constants/currencies"
import { UploadStatementModal } from "@/components/uploads/UploadStatementModal"
import { useBankAccounts } from "@/lib/hooks/useBankAccounts"

interface Props {
  onAccountSelect?: (accountId: string) => void
  selectedAccountId?: string
}

export function BankAccountsSection({ onAccountSelect, selectedAccountId }: Props) {
  const { accounts, isLoading, mutate } = useBankAccounts()

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Bank Accounts</h2>
        <AddBankAccountModal onSuccess={() => mutate()} />
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          Loading...
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">
            No accounts yet. Add your first bank account to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => {
            const isSelected = account.id === selectedAccountId
            return (
              <div
                key={account.id}
                className={`rounded-lg border bg-card p-4 shadow-sm transition-colors ${
                  onAccountSelect ? "cursor-pointer hover:border-primary" : ""
                } ${isSelected ? "border-primary ring-1 ring-primary" : ""}`}
                onClick={() => onAccountSelect?.(account.id)}
              >
                <div className="flex items-center gap-3">
                  <BankLogo
                    domain={getBankDomain(account.bank_name as SupportedBankName)}
                    bankName={account.bank_name}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{account.bank_name}</p>
                    <p className="truncate text-sm capitalize text-muted-foreground">
                      {account.account_type}
                      {account.account_nickname ? ` — ${account.account_nickname}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {SUPPORTED_CURRENCIES.find((c) => c.code === account.currency)?.symbol}{" "}
                      {account.currency}
                    </p>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <UploadStatementModal
                      accountId={account.id}
                      bankName={account.bank_name}
                      onSuccess={() => {
                        mutate()
                        onAccountSelect?.(account.id)
                      }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
