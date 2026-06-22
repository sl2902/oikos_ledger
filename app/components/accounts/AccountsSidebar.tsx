"use client"

import { useState } from "react"
import { History, Trash2 } from "lucide-react"
import { mutate as globalMutate } from "swr"
import { useAccounts } from "@/components/accounts/AccountsContext"
import { AddBankAccountModal } from "@/components/bank_accounts/AddBankAccountModal"
import { BankLogo } from "@/components/bank_accounts/BankLogo"
import { UploadHistoryModal } from "@/components/uploads/UploadHistoryModal"
import { DeleteAccountModal } from "@/components/accounts/DeleteAccountModal"
import { getBankDomain } from "@/lib/constants/banks"
import type { SupportedBankName } from "@/lib/constants/banks"

export function AccountsSidebar() {
  const { accounts, isLoading, selectedAccountId, setSelectedAccountId, mutate } = useAccounts()
  const [historyAccountId, setHistoryAccountId] = useState<string | null>(null)
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null)

  const historyAccount = historyAccountId
    ? (accounts.find((a) => a.id === historyAccountId) ?? null)
    : null

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
                  <div
                    className={`group flex items-center transition-colors ${
                      isSelected ? "bg-accent" : "hover:bg-accent"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedAccountId(account.id)}
                      className="flex flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
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
                    <div className="mr-2 flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setHistoryAccountId(account.id)
                        }}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                        title="Upload history"
                      >
                        <History className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeletingAccountId(account.id)
                        }}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                        title="Delete account"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
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

      {historyAccount && (
        <UploadHistoryModal
          accountId={historyAccount.id}
          bankName={historyAccount.bank_name}
          onDelete={() => {
            globalMutate(
              (key: unknown) =>
                typeof key === "string" && key.startsWith("/api/transactions"),
            )
            setHistoryAccountId(null)
          }}
          onClose={() => setHistoryAccountId(null)}
        />
      )}

      {deletingAccountId && (
        <DeleteAccountModal
          accountId={deletingAccountId}
          onDelete={() => {
            if (selectedAccountId === deletingAccountId) {
              const remaining = accounts.filter((a) => a.id !== deletingAccountId)
              if (remaining.length > 0) {
                setSelectedAccountId(remaining[0].id)
              } else {
                setSelectedAccountId("")
              }
            }
            setDeletingAccountId(null)
            mutate()
            globalMutate(
              (key: unknown) =>
                typeof key === "string" && key.startsWith("/api/transactions"),
            )
          }}
          onClose={() => setDeletingAccountId(null)}
        />
      )}
    </aside>
  )
}
