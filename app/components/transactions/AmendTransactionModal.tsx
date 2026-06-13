"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SUPPORTED_CURRENCIES } from "@/lib/constants/currencies"
import type { EffectiveTransaction } from "@/types"
import { useCategories } from "@/lib/hooks/useCategories"

const PAYMENT_METHODS = [
  "UPI",
  "NEFT",
  "IMPS",
  "RTGS",
  "ATM",
  "POS",
  "ACH",
  "Bill Pay",
  "Salary",
  "EMI",
  "Transfer",
  "Other",
]

interface Props {
  transaction: EffectiveTransaction
  onSuccess: () => void
  onClose: () => void
}

export function AmendTransactionModal({ transaction, onSuccess, onClose }: Props) {
  const { categories, subcategories } = useCategories()
  const [merchantName, setMerchantName] = useState(transaction.normalized_merchant)
  const [category, setCategory] = useState(transaction.category ?? "")
  const [subcategory, setSubcategory] = useState<string | null>(transaction.subcategory ?? null)
  const [paymentMethod, setPaymentMethod] = useState(transaction.payment_method)

  const filteredSubcategories = subcategories.filter(
    (s) => categories.find((c) => c.id === s.parent_id && c.name === category),
  )
  const [reason, setReason] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currencySymbol =
    SUPPORTED_CURRENCIES.find((c) => c.code === transaction.currency)?.symbol ?? "₹"
  const sign = transaction.transaction_type === "debit" ? "–" : "+"
  const formattedAmount = `${sign}${currencySymbol}${Number(transaction.amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  const formattedDate = new Date(
    transaction.transaction_date + "T00:00:00",
  ).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })

  async function handleSubmit() {
    const amendments: { field_name: string; old_value: string; new_value: string }[] = []

    if (merchantName.trim() !== transaction.normalized_merchant) {
      amendments.push({
        field_name: "normalized_merchant",
        old_value: transaction.normalized_merchant,
        new_value: merchantName.trim(),
      })
    }
    if (category !== transaction.category) {
      amendments.push({
        field_name: "category",
        old_value: transaction.category,
        new_value: category,
      })
    }
    const trimmedSub = (typeof subcategory === "string" ? subcategory.trim() : null) || null
    const originalSub = transaction.subcategory ?? null
    if (trimmedSub !== originalSub) {
      amendments.push({
        field_name: "subcategory",
        old_value: originalSub ?? "",
        new_value: trimmedSub ?? "",
      })
    }
    if (paymentMethod !== transaction.payment_method) {
      amendments.push({
        field_name: "payment_method",
        old_value: transaction.payment_method,
        new_value: paymentMethod,
      })
    }

    if (amendments.length === 0) {
      onClose()
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/transactions/${transaction.id}/amend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amendments, reason: reason.trim() || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError((data as { error?: string }).error ?? "Failed to save amendments")
        return
      }

      onSuccess()
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
        {/* Header — fixed */}
        <DialogHeader>
          <DialogTitle>Correct Transaction</DialogTitle>
        </DialogHeader>

        {/* Scrollable content */}
        <div className="flex-1 space-y-4 overflow-y-auto px-1 pb-4">
          {/* Immutable context */}
          <div className="rounded-lg bg-muted px-4 py-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span className="font-medium">{formattedDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span
                className={`font-medium ${transaction.transaction_type === "debit" ? "text-red-500" : "text-green-600"}`}
              >
                {formattedAmount}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-muted-foreground">Raw</span>
              <span className="truncate text-right font-mono text-xs text-muted-foreground">
                {transaction.raw_description}
              </span>
            </div>
          </div>

          {/* Amendable fields */}
          <div className="space-y-1.5">
            <Label htmlFor="merchant">Merchant</Label>
            <Input
              id="merchant"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              placeholder="Enter merchant name"
              maxLength={50}
              className="px-3"
            />
            <div className="flex items-center justify-between">
              {merchantName.trim().length > 0 && merchantName.trim().length < 3 ? (
                <p className="text-xs text-destructive">Minimum 3 characters</p>
              ) : (
                <span />
              )}
              <p className="text-xs text-muted-foreground">{merchantName.trim().length}/50</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.name}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>
              Subcategory{" "}
              <span className="text-muted-foreground">(optional, private)</span>
            </Label>
            {filteredSubcategories.length > 0 ? (
              <Select
                value={subcategory ?? ""}
                onValueChange={(v) => setSubcategory(v === "none" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select subcategory" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {filteredSubcategories.map((sub) => (
                    <SelectItem key={sub.id} value={sub.name}>
                      {sub.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={subcategory ?? ""}
                onChange={(e) => setSubcategory(e.target.value || null)}
                placeholder="Optional subcategory"
                maxLength={30}
                className="px-3"
              />
            )}
            <p className="text-xs text-muted-foreground">Only visible to you</p>
          </div>

          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you making this correction?"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {/* Footer — fixed */}
        <DialogFooter className="mt-2 border-t pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              (merchantName.trim().length > 0 && merchantName.trim().length < 3)
            }
          >
            {isSubmitting ? "Saving..." : "Save corrections"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
