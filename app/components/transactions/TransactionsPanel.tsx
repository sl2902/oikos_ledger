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
  const storageKey = selectedAccountId ? `oikos_filters_acc_${selectedAccountId}` : null

  const [filters, setFilters] = useState<TransactionFilters>(() => {
    if (typeof window !== "undefined" && storageKey) {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        try { return JSON.parse(saved).filters || {} } catch { return {} }
      }
    }
    return {}
  })

  const [selectedMonth, setSelectedMonth] = useState<string | null>(() => {
    if (typeof window !== "undefined" && storageKey) {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        try { return JSON.parse(saved).selectedMonth || null } catch { return null }
      }
    }
    return null
  })

  const [page, setPage] = useState<number>(() => {
    if (typeof window !== "undefined" && storageKey) {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        try { return JSON.parse(saved).page || 1 } catch { return 1 }
      }
    }
    return 1
  })

  const prevAccountId = useRef<string | null>(selectedAccountId)
  const isInitializingRef = useRef<string | null>(null)
  const prevMonthsCountRef = useRef<number | null>(null)

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId)
  const currencySymbol =
    SUPPORTED_CURRENCIES.find((c) => c.code === selectedAccount?.currency)?.symbol ?? "₹"

  const { availableMonths, mutate: mutateMonths } = useAvailableMonths(selectedAccountId)

  // Effect A: Restore filters when account switches
  useEffect(() => {
    if (selectedAccountId && selectedAccountId !== prevAccountId.current) {
      prevAccountId.current = selectedAccountId
      isInitializingRef.current = selectedAccountId

      const saved = localStorage.getItem(`oikos_filters_acc_${selectedAccountId}`)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          setFilters(parsed.filters || {})
          setSelectedMonth(parsed.selectedMonth || null)
          setPage(parsed.page || 1)
          setTimeout(() => { isInitializingRef.current = null }, 0)
          return
        } catch {}
      }
      setFilters({})
      setSelectedMonth(null)
      setPage(1)
      setTimeout(() => { isInitializingRef.current = null }, 0)
    }
  }, [selectedAccountId])

  // Effect B: Persist filters to localStorage on every change
  useEffect(() => {
    if (storageKey && isInitializingRef.current !== selectedAccountId) {
      localStorage.setItem(storageKey, JSON.stringify({ filters, selectedMonth, page }))
    }
  }, [filters, selectedMonth, page, storageKey, selectedAccountId])

  // Effect C: Default to most recent month only if nothing was restored
  useEffect(() => {
    if (availableMonths.length > 0) {
      const availableKeys = availableMonths.map(m => m.key)
      const saved = storageKey ? localStorage.getItem(storageKey) : null
      let storedMonth: string | null = null
      if (saved) {
        try { storedMonth = JSON.parse(saved).selectedMonth || null } catch {}
      }

      // If restored month no longer exists in available months, reset to most recent
      if (storedMonth && storedMonth !== "custom" && !availableKeys.includes(storedMonth)) {
        setSelectedMonth(availableMonths[0].key)
        setFilters(prev => ({
          ...prev,
          month: availableMonths[0].key,
          date_from: undefined,
          date_to: undefined,
        }))
        return
      }

      if (storedMonth && selectedMonth !== storedMonth && isInitializingRef.current === selectedAccountId) {
        setSelectedMonth(storedMonth)
        return
      }

      if (!selectedMonth && !storedMonth) {
        setSelectedMonth(availableMonths[0].key)
      }
    }
  }, [availableMonths, selectedMonth, storageKey, selectedAccountId])

  function handleMonthChange(month: string) {
    setSelectedMonth(month)
    setPage(1)
    if (month !== "custom") {
      setFilters((prev) => ({ ...prev, month, date_from: undefined, date_to: undefined }))
    } else {
      setFilters((prev) => ({ ...prev, month: undefined }))
    }
  }

  function handleFilterChange(newFilters: TransactionFilters) {
    setFilters(newFilters)
    setPage(1)
  }

  const transactionFilters = useMemo<TransactionFilters>(() => {
    const activeMonthFilter = selectedMonth === "custom"
      ? undefined
      : (selectedMonth ?? (availableMonths[0]?.key || undefined))
    return {
      ...filters,
      month: activeMonthFilter,
      page,
    }
  }, [filters, selectedMonth, page, availableMonths])

  const {
    transactions,
    total,
    total_pages,
    isLoading,
    isError,
    mutate: mutateTransactions,
    balanceVerified,
    balanceDiscrepancy: _balanceDiscrepancy,
  } = useTransactions(selectedAccountId, transactionFilters)

  const [balanceByMonth, setBalanceByMonth] = useState<
    Record<string, { opening: string | null; closing: string | null }>
  >({})

  useEffect(() => {
    if (!selectedAccountId) return

    let dateFrom: string | undefined
    let dateTo: string | undefined

    if (transactionFilters.month && transactionFilters.month !== "custom") {
      const [y, m] = transactionFilters.month.split("-").map(Number)
      dateFrom = `${y}-${String(m).padStart(2, "0")}-01`
      const nextM = m === 12 ? 1 : m + 1
      const nextY = m === 12 ? y + 1 : y
      dateTo = `${nextY}-${String(nextM).padStart(2, "0")}-01`
    } else if (transactionFilters.date_from || transactionFilters.date_to) {
      dateFrom = transactionFilters.date_from
      dateTo = transactionFilters.date_to
    }

    if (!dateFrom) return

    const params = new URLSearchParams({ account_id: selectedAccountId })
    if (dateFrom) params.set("date_from", dateFrom)
    if (dateTo) params.set("date_to", dateTo)

    fetch(`/api/transactions/balances?${params}`)
      .then(r => r.json())
      .then(json => setBalanceByMonth(prev => ({
        ...prev,
        ...(json.balances ?? {}),
      })))
      .catch(() => {})
  }, [selectedAccountId, transactionFilters.month, transactionFilters.date_from, transactionFilters.date_to, isLoading])

  // Reset when no months available (transactions deleted)
  useEffect(() => {
    const prevCount = prevMonthsCountRef.current
    prevMonthsCountRef.current = availableMonths.length
    if (prevCount !== null && prevCount > 0 && availableMonths.length === 0) {
      setFilters({})
      setPage(1)
      setSelectedMonth(null)
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
          onChange={handleFilterChange}
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
          grouped.map(([key, group]) => {
            console.log("[grouped keys]", grouped.map(([key]) => key))
            console.log("[balanceByMonth keys]", Object.keys(balanceByMonth))
            const monthBalance = balanceByMonth[key]
            return (
              <TransactionGroup
                key={key}
                month={group.label}
                transactions={group.transactions}
                showHeader={true}
                mutateTransactions={mutateTransactions}
                balanceVerified={balanceVerified}
                openingBalance={monthBalance?.opening ?? null}
                closingBalance={monthBalance?.closing ?? null}
              />
            )
          })
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
