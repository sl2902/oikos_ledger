"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getBankDomain, SUPPORTED_BANKS } from "@/lib/constants/banks"
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/constants/currencies"
import type { CurrencyCode } from "@/lib/constants/currencies"
import type { SupportedBankName } from "@/lib/constants/banks"
import type { AccountType } from "@/types"
import { BankLogo } from "./BankLogo"

interface Props {
  onSuccess: (newAccountId: string) => void
}

export function AddBankAccountModal({ onSuccess }: Props) {
  const [open, setOpen] = useState(false)
  const [bankName, setBankName] = useState("")
  const [accountType, setAccountType] = useState<AccountType | "">("")
  const [nickname, setNickname] = useState("")
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setBankName("")
    setAccountType("")
    setNickname("")
    setCurrency(DEFAULT_CURRENCY)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!bankName || !accountType) return
    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch("/api/bank_accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_name: bankName,
          account_type: accountType,
          account_nickname: nickname || null,
          currency,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? "Failed to add account")
        return
      }

      setOpen(false)
      reset()
      onSuccess(data.id as string)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>Add bank account</Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add bank account</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bank_name">Bank name</Label>
            <Select value={bankName} onValueChange={setBankName} required>
              <SelectTrigger id="bank_name">
                {bankName ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <BankLogo
                      domain={getBankDomain(bankName as SupportedBankName)}
                      bankName={bankName}
                    />
                    <span className="truncate">{bankName}</span>
                  </span>
                ) : (
                  <SelectValue placeholder="Select bank" />
                )}
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_BANKS.map((bank) => (
                  <SelectItem key={bank.name} value={bank.name}>
                    <span className="flex items-center gap-2">
                      <BankLogo domain={bank.domain} bankName={bank.name} />
                      {bank.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_type">Account type</Label>
            <Select
              value={accountType}
              onValueChange={(v) => setAccountType(v as AccountType)}
              required
            >
              <SelectTrigger id="account_type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">Checking</SelectItem>
                <SelectItem value="savings">Savings</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nickname">Nickname (optional)</Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Primary savings"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
              <Select 
                    value={currency} 
                    onValueChange={(v) => setCurrency(v as CurrencyCode)} 
                    required
                  >
                    {/* Only ONE clean trigger, matching the standard shadcn primitive pattern */}
                    <SelectTrigger id="currency" className="w-full">
                      <SelectValue placeholder="Select currency">
                        {currency && (() => {
                          const c = SUPPORTED_CURRENCIES.find((curr) => curr.code === currency);
                          return c ? `${c.symbol} ${c.code} — ${c.name}` : "Select currency";
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map(({ code, name, symbol }) => (
                        <SelectItem key={code} value={code}>
                          <span className="font-mono mr-2 text-slate-500">{symbol}</span>
                          <span className="font-medium">{code}</span>
                          <span className="text-slate-400 mx-1">—</span>
                          <span className="text-slate-600">{name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
               </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !bankName || !accountType}>
              {submitting ? "Adding..." : "Add account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
