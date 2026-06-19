"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAccounts } from "@/components/accounts/AccountsContext"
import { useTransactions, type TransactionFilters } from "@/lib/hooks/useTransactions"
import { useAvailableMonths } from "@/lib/hooks/useAvailableMonths"
import { BankLogo } from "@/components/bank_accounts/BankLogo"
import { getBankDomain } from "@/lib/constants/banks"
import type { SupportedBankName } from "@/lib/constants/banks"
import { SUPPORTED_CURRENCIES } from "@/lib/constants/currencies"
import { UploadStatementModal } from "@/components/uploads/UploadStatementModal"
import { FilterBar } from "./FilterBar"
import { TransactionGroup } from "./TransactionGroup"
import { Pagination } from "./Pagination"

export function TransactionsPanel() {
  const { selectedAccountId, accounts } = useAccounts()
  const [filters, setFilters] = useState<TransactionFilters>({})
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [page, setPage] = useState<number>(1)
  const prevAccountId = useRef<string | null>(null)
  const hasRestoredFilters = useRef(false)
  const prevMonthsCountRef = useRef<number | null>(null)
  const persistRef = useRef({ selectedMonth, filters, page })

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId)
  const currencySymbol =
    SUPPORTED_CURRENCIES.find((c) => c.code === selectedAccount?.currency)?.symbol ?? "₹"

  const { availableMonths, mutate: mutateMonths } = useAvailableMonths(selectedAccountId)

  // Consolidated account change + restore effect
  useEffect(() => {
    if (!selectedAccountId) return

    if (prevAccountId.current && prevAccountId.current !== selectedAccountId) {
      prevAccountId.current = selectedAccountId
      hasRestoredFilters.current = false  // reset for new account
      prevMonthsCountRef.current = null   // reset months-count tracking for new account

      const stored = sessionStorage.getItem(`txn_filters_${selectedAccountId}`)
      if (stored) {
        try {
          const { month, filters: f, page: p } = JSON.parse(stored)
          setSelectedMonth(month ?? null)
          setFilters({
            ...(f ?? {}),
            ...(month ? { month, date_from: undefined, date_to: undefined } : {}),
          })
          setPage(p ?? 1)
          if (month) hasRestoredFilters.current = true
        } catch {
          sessionStorage.removeItem(`txn_filters_${selectedAccountId}`)
          setSelectedMonth(null)
          setFilters({})
          setPage(1)
        }
      } else {
        // No saved state for new account — reset to defaults
        setSelectedMonth(null)
        setFilters({})
        setPage(1)
      }
      return
    }

    if (prevAccountId.current === null) {
      prevAccountId.current = selectedAccountId
      const stored = sessionStorage.getItem(`txn_filters_${selectedAccountId}`)
      if (stored) {
        try {
          const { month, filters: f, page: p } = JSON.parse(stored)
          if (month) {
            setSelectedMonth(month)
            hasRestoredFilters.current = true
          }
          if (f) {
            setFilters({
              ...f,
              ...(month ? { month, date_from: undefined, date_to: undefined } : {}),
            })
          } else if (month) {
            setFilters(prev => ({
              ...prev,
              month,
              date_from: undefined,
              date_to: undefined,
            }))
          }
          if (p) setPage(p)
          console.log("[restore] month:", month, "hasRestored:", hasRestoredFilters.current)
        } catch {
          sessionStorage.removeItem(`txn_filters_${selectedAccountId}`)
        }
      }
    }
  }, [selectedAccountId])

  // Keep persistRef in sync with latest state each render
  useEffect(() => {
    persistRef.current = { selectedMonth, filters, page }
  })

  // Write sessionStorage on unmount or account switch (effect cleanup)
  useEffect(() => {
    return () => {
      if (!selectedAccountId) return
      const { selectedMonth, filters, page } = persistRef.current
      sessionStorage.setItem(
        `txn_filters_${selectedAccountId}`,
        JSON.stringify({ month: selectedMonth, filters, page })
      )
    }
  }, [selectedAccountId])

  // Write sessionStorage on hard refresh / tab close
  useEffect(() => {
    const handleUnload = () => {
      if (!selectedAccountId) return
      const { selectedMonth, filters, page } = persistRef.current
      sessionStorage.setItem(
        `txn_filters_${selectedAccountId}`,
        JSON.stringify({ month: selectedMonth, filters, page })
      )
    }
    window.addEventListener("beforeunload", handleUnload)
    return () => window.removeEventListener("beforeunload", handleUnload)
  }, [selectedAccountId])

  // Default to most recent month once available months load
  useEffect(() => {
    console.log("[availableMonths] length:", availableMonths.length, "selectedMonth:", selectedMonth, "hasRestored:", hasRestoredFilters.current)
    if (availableMonths.length > 0 && selectedMonth === null
        && !hasRestoredFilters.current) {
      const first = availableMonths[0].key
      setSelectedMonth(first)
      setPage(1)
      setFilters((prev) => ({
        ...prev,
        month: first,
        date_from: undefined,
        date_to: undefined,
      }))
    }
    hasRestoredFilters.current = true
  }, [availableMonths])

  function handleMonthChange(month: string) {
    setSelectedMonth(month)
    setPage(1)
    if (month !== "custom") {
      setFilters((prev) => ({ ...prev, month, date_from: undefined, date_to: undefined }))
    } else {
      setFilters((prev) => ({ ...prev, month: undefined }))
    }
  }

  const {
    transactions,
    total,
    total_pages,
    isLoading,
    isError,
    mutate: mutateTransactions,
    balanceVerified,
    balanceDiscrepancy: _balanceDiscrepancy,
  } = useTransactions(selectedAccountId, { ...filters, page })

  // Only reliable on page 1 — hide on subsequent pages to avoid wrong values
  const closingBalance = page === 1 && transactions.length > 0
    ? transactions[0].closing_balance ?? null
    : null

  const openingBalance = page === 1 && transactions.length > 0
    ? (() => {
        const last = transactions[transactions.length - 1]
        if (!last?.closing_balance) return null
        const closing = Number(last.closing_balance)
        const amount = Number(last.amount)
        return last.transaction_type === "debit"
          ? String(closing + amount)
          : String(closing - amount)
      })()
    : null

  // Reset when no months available (transactions deleted)
  useEffect(() => {
    const prevCount = prevMonthsCountRef.current
    prevMonthsCountRef.current = availableMonths.length
    if (prevCount !== null && prevCount > 0 && availableMonths.length === 0) {
      setFilters({})
      setPage(1)
      setSelectedMonth(null)
      hasRestoredFilters.current = false
    }
  }, [availableMonths.length])

  // Client-side payment_method filter uses the effective payment_method from the server
  const displayTransactions = useMemo(() => {
    if (!filters.payment_method) return transactions
    return transactions.filter((t) => t.payment_method === filters.payment_method)
  }, [transactions, filters.payment_method])

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; transactions: typeof displayTransactions }>()
    for (const txn of displayTransactions) {
      const key = txn.transaction_date.slice(0, 7)
      if (!map.has(key)) {
        const [y, m] = key.split("-")
        const label = new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString("en-US", {
          month: "long",
          year: "numeric",
        })
        map.set(key, { label, transactions: [] })
      }
      map.get(key)!.transactions.push(txn)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [displayTransactions])

  if (!selectedAccountId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select an account to view transactions.
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">

      {/* Panel header — OUTSIDE scroll container */}
      {selectedAccount && (
        <div className="flex items-center justify-between border-b bg-background px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <BankLogo
              domain={getBankDomain(selectedAccount.bank_name as SupportedBankName)}
              bankName={selectedAccount.bank_name}
            />
            <div>
              <div className="flex items-center gap-1">
                <h2 className="text-base font-semibold">{selectedAccount.bank_name}</h2>
                <span className="text-sm text-muted-foreground">· {currencySymbol}</span>
              </div>
              <p className="text-xs capitalize text-muted-foreground">
                {selectedAccount.account_nickname ?? selectedAccount.account_type}
              </p>
            </div>
          </div>
          <UploadStatementModal
            bankName={selectedAccount.bank_name}
            onSuccess={() => {
              mutateTransactions()
              mutateMonths()
            }}
          />
        </div>
      )}

      {/* Filter bar — OUTSIDE scroll container */}
      <div className="bg-background shrink-0">
        <FilterBar
          filters={filters}
          onChange={(f) => { setFilters(f); setPage(1) }}
          availableMonths={availableMonths}
          selectedMonth={selectedMonth}
          onMonthChange={handleMonthChange}
        />
      </div>

      {/* Scrollable transaction list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Loading transactions...
          </div>
        ) : isError ? (
          <div className="flex h-32 items-center justify-center text-sm text-destructive">
            Failed to load transactions. Please refresh.
            <button
              onClick={() => mutateTransactions()}
              className="text-sm text-primary underline underline-offset-2"
            >
              Try again
            </button>
          </div>
                ) : displayTransactions.length === 0 ? (
          <div className="flex flex-col h-32 items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              {transactions.length === 0 && selectedMonth !== null
                ? "No transactions found. If you recently deleted data, refresh the page."
                : transactions.length === 0
                ? "No transactions yet. Upload a bank statement to get started."
                : "No transactions match the current filters."}
            </p>
            {transactions.length === 0 && selectedMonth !== null && (
              <button
                onClick={() => window.location.reload()}
                className="text-sm text-primary underline underline-offset-2"
              >
                Refresh
              </button>
            )}
          </div>
        ) : (
          grouped.map(([key, group], index) => (
            <TransactionGroup
              key={key}
              month={group.label}
              transactions={group.transactions}
              showHeader={index === 0}
              mutateTransactions={mutateTransactions}
              balanceVerified={balanceVerified}
              openingBalance={openingBalance}
              closingBalance={closingBalance}
            />
          ))
        )}
      </div>

      {/* Pagination — OUTSIDE scroll container */}
      {!isLoading && !isError && total > 0 && (
        <div className="shrink-0">
          <Pagination
            page={page}
            totalPages={total_pages}
            total={total}
            limit={20}
            onPageChange={setPage}
          />
        </div>
      )}

    </div>
  )
}
