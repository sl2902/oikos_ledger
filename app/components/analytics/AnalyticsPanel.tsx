"use client"

import { useState, useEffect, useCallback } from "react"
import { useAccounts } from "@/components/accounts/AccountsContext"
import { InsightsChart } from "@/components/insights/InsightsChart"
import { useTransactionCategories } from "@/lib/hooks/useTransactionCategories"

type Dimension = "merchants" | "payment_methods" | "subcategories" | "debit_credit"

const TABS: { id: Dimension; label: string }[] = [
  { id: "merchants", label: "Merchants" },
  { id: "payment_methods", label: "Payment Methods" },
  { id: "subcategories", label: "Subcategories" },
  { id: "debit_credit", label: "Debit vs Credit" },
]

const MONTHS_OPTIONS = [
  { value: 3, label: "Last 3 months" },
  { value: 6, label: "Last 6 months" },
  { value: 12, label: "Last 12 months" },
]

interface AnalyticsFilters {
  months: number
  category: string
  transaction_type: string
}

function getStorageKey(accountId: string, tab: Dimension) {
  return `oikos_analytics_${accountId}_${tab}`
}

function getCachedFilters(accountId: string, tab: Dimension): AnalyticsFilters | null {
  try {
    const raw = localStorage.getItem(getStorageKey(accountId, tab))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function setCachedFilters(accountId: string, tab: Dimension, filters: AnalyticsFilters) {
  try {
    localStorage.setItem(getStorageKey(accountId, tab), JSON.stringify(filters))
  } catch {}
}

const DEFAULT_FILTERS: AnalyticsFilters = {
  months: 3,
  category: "",
  transaction_type: "debit",
}

export function AnalyticsPanel() {
  const { selectedAccountId, setSelectedAccountId, accounts } = useAccounts()
  const { categories } = useTransactionCategories(selectedAccountId)

  const [activeTab, setActiveTab] = useState<Dimension>(() => {
    if (typeof window === "undefined") return "merchants"
    try {
      return (localStorage.getItem("oikos_analytics_active_tab") as Dimension) ?? "merchants"
    } catch { return "merchants" }
  })

  const [filters, setFilters] = useState<AnalyticsFilters>(() => {
    if (typeof window === "undefined" || !selectedAccountId) return DEFAULT_FILTERS
    return getCachedFilters(selectedAccountId, activeTab) ?? DEFAULT_FILTERS
  })

  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!selectedAccountId) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: selectedAccountId,
          dimension: activeTab,
          months: filters.months,
          category: filters.category || undefined,
          transaction_type: filters.transaction_type,
        }),
      })
      if (!res.ok) throw new Error("Failed to fetch analytics")
      const json = await res.json()
      setData(json.rows ?? [])
    } catch {
      setError("Failed to load analytics. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }, [selectedAccountId, activeTab, filters])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!selectedAccountId) return
    setCachedFilters(selectedAccountId, activeTab, filters)
  }, [filters, selectedAccountId, activeTab])

  useEffect(() => {
    try { localStorage.setItem("oikos_analytics_active_tab", activeTab) } catch {}
  }, [activeTab])

  useEffect(() => {
    if (!selectedAccountId) return
    const saved = getCachedFilters(selectedAccountId, activeTab)
    setFilters(saved ?? DEFAULT_FILTERS)
  }, [activeTab, selectedAccountId])

  const chartType = activeTab === "debit_credit"
    ? "comparison_bar"
    : activeTab === "payment_methods"
    ? "line"
    : "bar"

  const showCategoryFilter = activeTab === "merchants" || activeTab === "subcategories"
  const showTypeFilter = activeTab !== "debit_credit"

  if (!selectedAccountId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an account to view analytics.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4 shrink-0">
        <div>
          <h2 className="text-base font-semibold">Analytics</h2>
          <p className="text-xs text-muted-foreground">
            Multi-dimensional spending breakdown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedAccountId ?? ""}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm
              focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank_name} · {a.account_nickname ?? a.account_type}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b shrink-0 px-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 border-b px-6 py-3 shrink-0">
        <select
          value={filters.months}
          onChange={(e) => setFilters(prev => ({
            ...prev, months: Number(e.target.value)
          }))}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-xs
            focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {MONTHS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {showTypeFilter && (
          <select
            value={filters.transaction_type}
            onChange={(e) => setFilters(prev => ({
              ...prev, transaction_type: e.target.value
            }))}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-xs
              focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="debit">Debits</option>
            <option value="credit">Credits</option>
            <option value="all">All</option>
          </select>
        )}

        {showCategoryFilter && (
          <select
            value={filters.category}
            onChange={(e) => setFilters(prev => ({
              ...prev, category: e.target.value
            }))}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-xs
              focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        <button
          onClick={fetchData}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground
            underline underline-offset-2"
        >
          Refresh
        </button>
      </div>

      {/* Chart */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : error ? (
          <div className="flex h-48 items-center justify-center text-sm text-destructive">
            {error}
            <button onClick={fetchData} className="ml-2 underline">Retry</button>
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No data found for the selected filters.
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {activeTab === "merchants" && `Top ${data.length} merchants by spend`}
              {activeTab === "payment_methods" && "Spend by payment method over time"}
              {activeTab === "subcategories" && "Spend by subcategory"}
              {activeTab === "debit_credit" && "Monthly debit vs credit trend"}
            </p>
            <InsightsChart chartType={chartType} data={data} />
          </div>
        )}
      </div>
    </div>
  )
}
