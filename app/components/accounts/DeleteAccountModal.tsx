"use client"

import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface AccountStats {
  account_id: string
  bank_name: string
  account_type: string
  account_nickname: string | null
  upload_count: number
  transaction_count: number
}

interface Props {
  accountId: string
  onDelete: () => void
  onClose: () => void
}

export function DeleteAccountModal({ accountId, onDelete, onClose }: Props) {
  const [stats, setStats] = useState<AccountStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/bank_accounts/${accountId}`)
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setIsLoading(false))
  }, [accountId])

  async function handleDelete() {
    setIsDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/bank_accounts/${accountId}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? "Failed to delete account")
        return
      }
      onDelete()
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Bank Account</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : stats ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">
                    This action cannot be undone
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Deleting{" "}
                    <span className="font-medium">
                      {stats.account_nickname ?? stats.account_type}
                    </span>{" "}
                    ({stats.bank_name}) will permanently delete:
                  </p>
                  <ul className="text-sm text-muted-foreground list-disc list-inside space-y-0.5">
                    <li>
                      <span className="font-medium">{stats.transaction_count}</span>{" "}
                      transactions
                    </li>
                    <li>
                      <span className="font-medium">{stats.upload_count}</span>{" "}
                      uploads and all corrections
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting…" : "Delete account"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-destructive">
            Failed to load account details.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
