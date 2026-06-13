"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { Transaction } from "@/types"
import { SUPPORTED_CURRENCIES } from "@/lib/constants/currencies"
import { useTransactions } from "@/lib/hooks/useTransactions"

interface Props {
  accountId: string
}

const PAGE_SIZE = 50

function getPaymentMethod(rawDescription: string): string {
  const d = rawDescription.toLowerCase()
  if (d.includes("upi-") || d.includes("/upi/") || d.includes("upi/")) return "UPI"
  if (d.includes("neft")) return "NEFT"
  if (d.includes("imps")) return "IMPS"
  if (d.includes("rtgs")) return "RTGS"
  if (d.includes("atm") || d.includes("atw")) return "ATM"
  if (d.includes("pos/") || d.includes("/pos")) return "POS"
  if (d.includes("billpay") || d.includes("bill pay") || d.includes("nach dr")) return "Bill Pay"
  if (d.includes("sal cr") || d.includes("salary cr")) return "Salary"
  if (d.includes("emi")) return "EMI"
  return "Transfer"
}

const METHOD_COLORS: Record<string, string> = {
  UPI: "bg-purple-100 text-purple-700",
  NEFT: "bg-blue-100 text-blue-700",
  IMPS: "bg-indigo-100 text-indigo-700",
  RTGS: "bg-cyan-100 text-cyan-700",
  ATM: "bg-gray-100 text-gray-700",
  POS: "bg-orange-100 text-orange-700",
  "Bill Pay": "bg-yellow-100 text-yellow-700",
  Salary: "bg-green-100 text-green-700",
  EMI: "bg-red-100 text-red-700",
  Transfer: "bg-slate-100 text-slate-700",
}

export function TransactionList({ accountId }: Props) {
  const { transactions: firstPage, isLoading, isError } = useTransactions(accountId)
  const [extraRows, setExtraRows] = useState<Transaction[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  // Reset extra pages when account switches.
  useEffect(() => {
    setExtraRows([])
    setExhausted(false)
  }, [accountId])

  const rows = [...firstPage, ...extraRows]
  const canLoadMore = !isLoading && !loadingMore && !exhausted && firstPage.length === PAGE_SIZE

  async function loadMore() {
    setLoadingMore(true)
    try {
      const res = await fetch(
        `/api/transactions?account_id=${accountId}&limit=${PAGE_SIZE}&offset=${rows.length}`,
      )
      const data: Transaction[] = await res.json()
      if (data.length > 0) setExtraRows((prev) => [...prev, ...data])
      if (data.length < PAGE_SIZE) setExhausted(true)
    } finally {
      setLoadingMore(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Loading transactions...
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-destructive">
        Failed to load transactions. Please refresh.
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed">
        <p className="text-sm text-muted-foreground">
          No transactions yet. Upload a bank statement to get started.
        </p>
      </div>
    )
  }

  const currencySymbol =
    rows[0]
      ? SUPPORTED_CURRENCIES.find((c) => c.code === rows[0].currency)?.symbol ?? rows[0].currency
      : "₹"

  return (
    <div className="space-y-2">
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Merchant</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Method</th>
              <th className="px-4 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((txn) => {
              const method = getPaymentMethod(txn.raw_description)
              const methodClass = METHOD_COLORS[method] ?? METHOD_COLORS.Transfer
              return (
                <tr key={txn.id} className="hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {new Date(txn.transaction_date).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="max-w-[180px] truncate px-4 py-2.5 font-medium">
                    {txn.normalized_merchant}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{txn.category}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${methodClass}`}>
                      {method}
                    </span>
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-2.5 text-right font-mono font-medium ${
                      txn.transaction_type === "debit" ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    {txn.transaction_type === "debit" ? "−" : "+"}
                    {currencySymbol}
                    {Number(txn.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {canLoadMore && (
        <div className="flex justify-center pt-1">
          <Button variant="outline" size="sm" onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
      {loadingMore && (
        <div className="flex justify-center pt-1">
          <Button variant="outline" size="sm" disabled>
            Loading...
          </Button>
        </div>
      )}
    </div>
  )
}
