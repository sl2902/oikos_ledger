import { useState } from "react"
import { AlertTriangle, Pencil, Eye, EyeOff } from "lucide-react"
import { SUPPORTED_CURRENCIES } from "@/lib/constants/currencies"
import type { EffectiveTransaction } from "@/types"
import { CategoryBadge } from "./CategoryBadge"
import { MethodBadge } from "./MethodBadge"
import { AmendTransactionModal } from "./AmendTransactionModal"

interface Props {
  month: string
  transactions: EffectiveTransaction[]
  showHeader?: boolean
  mutateTransactions?: () => void
  balanceVerified?: boolean | null
  openingBalance?: string | null
  closingBalance?: string | null
}

export function TransactionGroup({ month, transactions, showHeader, mutateTransactions, balanceVerified, openingBalance, closingBalance }: Props) {
  const [amendingTransaction, setAmendingTransaction] = useState<EffectiveTransaction | null>(null)
  const [balanceVisible, setBalanceVisible] = useState(true)

  const currencySymbol = transactions[0]
    ? (SUPPORTED_CURRENCIES.find((c) => c.code === transactions[0].currency)?.symbol ?? "₹")
    : "₹"

  const totalDebit = transactions
    .filter((t) => t.transaction_type === "debit")
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const totalCredit = transactions
    .filter((t) => t.transaction_type === "credit")
    .reduce((sum, t) => sum + Number(t.amount), 0)

  return (
    <div>
      {/* Month heading */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-y bg-slate-100 px-6 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{month}</span>
          {balanceVerified === false && (
            <span className="flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
              <AlertTriangle className="h-3 w-3" />
              Balance mismatch
            </span>
          )}
        </div>
        <div className="flex items-center gap-6 text-sm">
          {openingBalance != null && (
            <span className="text-muted-foreground">
              Opening{" "}
              <span className="font-medium text-slate-700">
                {balanceVisible
                  ? `${currencySymbol}${Number(openingBalance).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : "••••••"}
              </span>
            </span>
          )}
          <span className="text-muted-foreground">
            Debits{" "}
            <span className="font-medium text-red-500">
              –{currencySymbol}
              {totalDebit.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </span>
          <span className="text-muted-foreground">
            Credits{" "}
            <span className="font-medium text-green-600">
              +{currencySymbol}
              {totalCredit.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </span>
          {closingBalance != null && (
            <span className="flex items-center gap-1 text-muted-foreground">
              Closing{" "}
              <span className="font-medium text-slate-700">
                {balanceVisible
                  ? `${currencySymbol}${Number(closingBalance).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : "••••••"}
              </span>
              <button
                onClick={() => setBalanceVisible(prev => !prev)}
                className="ml-1 text-muted-foreground hover:text-slate-700 transition-colors"
                title={balanceVisible ? "Hide balances" : "Show balances"}
              >
                {balanceVisible
                  ? <EyeOff className="h-3.5 w-3.5" />
                  : <Eye className="h-3.5 w-3.5" />}
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <table className="w-full border-collapse">
        {showHeader && (
          <thead className="sticky top-[37px] z-10 bg-slate-50">
            <tr>
              <th className="w-24 px-6 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                Date
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                Merchant
              </th>
              <th className="w-32 px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                Category
              </th>
              <th className="w-24 px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                Method
              </th>
              <th className="w-28 px-6 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                Amount
              </th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
        )}
        <tbody>
          {transactions.map((txn) => (
            <tr
              key={txn.id}
              className="group border-b transition-colors hover:bg-muted/30"
            >
              <td className="w-24 px-6 py-3 text-sm text-muted-foreground whitespace-nowrap">
                {new Date(txn.transaction_date + "T00:00:00").toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                })}
              </td>
              <td className="px-4 py-3 text-sm font-medium">
                <div className="flex items-center gap-1.5">
                  <span className="block truncate max-w-lg">
                    {txn.normalized_merchant}
                  </span>
                  {txn.is_amended && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400"
                      title="This transaction has been corrected"
                    />
                  )}
                </div>
              </td>
              <td className="w-32 px-4 py-3 text-right">
                <CategoryBadge category={txn.category} />
              </td>
              <td className="w-24 px-4 py-3 text-right">
                <MethodBadge method={txn.payment_method} />
              </td>
              <td
                className={`w-28 px-6 py-3 text-right text-sm font-medium whitespace-nowrap ${
                  txn.transaction_type === "debit" ? "text-red-500" : "text-green-600"
                }`}
              >
                {txn.transaction_type === "debit" ? "–" : "+"}
                {currencySymbol}
                {Number(txn.amount).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </td>
              <td className="w-8 px-2 py-3">
                <button
                  onClick={() => setAmendingTransaction(txn)}
                  className="invisible rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground group-hover:visible"
                  title="Correct this transaction"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {amendingTransaction && (
        <AmendTransactionModal
          transaction={amendingTransaction}
          onSuccess={() => {
            mutateTransactions?.()
            setAmendingTransaction(null)
          }}
          onClose={() => setAmendingTransaction(null)}
        />
      )}
    </div>
  )
}
