"use client"

import { useAccounts } from "@/components/accounts/AccountsContext"
import { AddBankAccountModal } from "@/components/bank_accounts/AddBankAccountModal"
import { BankLogo } from "@/components/bank_accounts/BankLogo"
import { getBankDomain } from "@/lib/constants/banks"
import type { SupportedBankName } from "@/lib/constants/banks"

export function AccountsSidebar() {
  const { accounts, isLoading, selectedAccountId, setSelectedAccountId, mutate } = useAccounts()

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-semibold">Accounts</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
            Loading...
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              No accounts yet. Add your first bank account below.
            </p>
          </div>
        ) : (
          <ul>
            {accounts.map((account) => {
              const isSelected = account.id === selectedAccountId
              return (
                <li key={account.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedAccountId(account.id)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                      isSelected ? "bg-accent" : ""
                    }`}
                  >
                    <BankLogo
                      domain={getBankDomain(account.bank_name as SupportedBankName)}
                      bankName={account.bank_name}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium leading-snug">
                        {account.bank_name}
                      </p>
                      <p className="truncate text-xs capitalize leading-snug text-muted-foreground">
                        {account.account_type}
                        {account.account_nickname ? ` · ${account.account_nickname}` : ""}
                      </p>
                    </div>
                    {isSelected && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="border-t p-3">
        <AddBankAccountModal
          onSuccess={(newId) => {
            mutate()
            setSelectedAccountId(newId)
          }}
        />
      </div>
    </aside>
  )
}
