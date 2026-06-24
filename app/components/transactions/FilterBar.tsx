"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TransactionFilters } from "@/lib/hooks/useTransactions"
import type { MonthTab } from "@/lib/hooks/useAvailableMonths"
import { useCategories } from "@/lib/hooks/useCategories"

const PAYMENT_METHODS = [
  "UPI",
  "NEFT",
  "IMPS",
  "RTGS",
  "ATM",
  "POS",
  "Bill Pay",
  "Salary",
  "EMI",
  "Transfer",
]

interface Props {
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  availableMonths: MonthTab[]
  selectedMonth: string | null
  onMonthChange: (month: string) => void
}

export function FilterBar({ filters, onChange, availableMonths, selectedMonth, onMonthChange }: Props) {
  const { categories } = useCategories()
  const [searchValue, setSearchValue] = useState(filters.search ?? "")
  const filtersRef = useRef(filters)
  useEffect(() => { filtersRef.current = filters }, [filters])

  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  useEffect(() => {
    const t = setTimeout(() => {
      onChangeRef.current({ ...filtersRef.current, search: searchValue || undefined })
    }, 300)
    return () => clearTimeout(t)
  }, [searchValue])

  useEffect(() => {
    if (!filters.search) setSearchValue("")
  }, [filters.search])

  const hasActiveFilters =
    !!filters.search ||
    !!filters.category ||
    !!filters.transaction_type ||
    !!filters.payment_method ||
    filters.amount_min != null ||
    filters.amount_max != null

  function clearFilters() {
    setSearchValue("")
    onChange({
      month: filters.month,
      date_from: filters.date_from,
      date_to: filters.date_to,
    })
  }

  function tabClass(active: boolean) {
    return active
      ? "rounded-full bg-slate-800 px-4 py-1 text-sm text-white"
      : "rounded-full border border-slate-200 bg-white px-4 py-1 text-sm text-slate-600 hover:bg-slate-50"
  }

  return (
    <div className="flex flex-col gap-3 border-b px-4 py-3">
      {/* Row 1: search, category, method, amounts, clear */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search merchants..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="flex-1"
        />

        <Select
          value={filters.category ?? ""}
          onValueChange={(v) => onChange({ ...filters, category: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.name}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.payment_method ?? ""}
          onValueChange={(v) => onChange({ ...filters, payment_method: v || undefined })}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.transaction_type ?? "all"}
          onValueChange={(v) => onChange({ ...filters, transaction_type: v === "all" ? undefined : (v as "debit" | "credit") })}
        >
          <SelectTrigger className="w-28">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="debit">Debits (Dr)</SelectItem>
            <SelectItem value="credit">Credits (Cr)</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            ₹
          </span>
          <Input
            type="number"
            placeholder="Min"
            value={filters.amount_min ?? ""}
            onChange={(e) =>
              onChange({ ...filters, amount_min: e.target.value ? Number(e.target.value) : undefined })
            }
            className="w-24 pl-6"
          />
        </div>

        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            ₹
          </span>
          <Input
            type="number"
            placeholder="Max"
            value={filters.amount_max ?? ""}
            onChange={(e) =>
              onChange({ ...filters, amount_max: e.target.value ? Number(e.target.value) : undefined })
            }
            className="w-24 pl-6"
          />
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      {/* Row 2: month tabs */}
      <div className="flex items-center gap-2">
        {availableMonths.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onMonthChange(tab.key)}
            className={tabClass(selectedMonth === tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <button
          onClick={() => onMonthChange("custom")}
          className={tabClass(selectedMonth === "custom")}
        >
          Custom Range
        </button>
      </div>

      {/* Row 3: date range — only when Custom Range is selected */}
      {selectedMonth === "custom" && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-muted-foreground">From</span>
          <Input
            type="date"
            value={filters.date_from ?? ""}
            onChange={(e) => onChange({ ...filters, date_from: e.target.value || undefined })}
            className="w-36"
          />
          <span className="text-muted-foreground">→</span>
          <span className="shrink-0 text-sm text-muted-foreground">To</span>
          <Input
            type="date"
            value={filters.date_to ?? ""}
            onChange={(e) => onChange({ ...filters, date_to: e.target.value || undefined })}
            className="w-36"
          />
        </div>
      )}
    </div>
  )
}
