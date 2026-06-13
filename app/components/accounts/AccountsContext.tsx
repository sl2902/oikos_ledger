"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useBankAccounts } from "@/lib/hooks/useBankAccounts"
import type { BankAccount } from "@/types"

interface AccountsContextValue {
  selectedAccountId: string | null
  setSelectedAccountId: (id: string) => void
  accounts: BankAccount[]
  isLoading: boolean
  mutate: () => void
}

export const AccountsContext = createContext<AccountsContextValue>({
  selectedAccountId: null,
  setSelectedAccountId: () => {},
  accounts: [],
  isLoading: true,
  mutate: () => {},
})

export function AccountsProvider({ children }: { children: ReactNode }) {
  const { accounts, isLoading, mutate } = useBankAccounts()
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(null)

  useEffect(() => {
    if (isLoading) return
    const stored = localStorage.getItem("oikos_selected_account_id")
    if (stored && accounts.find((a) => a.id === stored)) {
      setSelectedAccountIdState(stored)
    } else if (accounts.length > 0) {
      setSelectedAccountIdState(accounts[0].id)
    }
  }, [isLoading, accounts])

  const setSelectedAccountId = (id: string) => {
    setSelectedAccountIdState(id)
    localStorage.setItem("oikos_selected_account_id", id)
  }

  return (
    <AccountsContext.Provider value={{ selectedAccountId, setSelectedAccountId, accounts, isLoading, mutate }}>
      {children}
    </AccountsContext.Provider>
  )
}

export function useAccounts() {
  return useContext(AccountsContext)
}
