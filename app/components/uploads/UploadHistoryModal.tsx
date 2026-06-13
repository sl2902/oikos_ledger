"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useUploads, type Upload } from "@/lib/hooks/useUploads"

interface Props {
  accountId: string
  bankName: string
  onDelete: () => void
  onClose: () => void
}

function formatUploadDate(dateStr: string) {
  const d = new Date(dateStr)
  const day = String(d.getDate()).padStart(2, "0")
  const month = d.toLocaleString("en-GB", { month: "short" })
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${day} ${month} ${hh}:${mm}`
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    complete: { label: "Complete", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    processing: { label: "Processing", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    pending: { label: "Pending", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
    failed: { label: "Failed", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500" },
  }
  const { label, className } = map[status] ?? {
    label: status,
    className: "bg-slate-100 text-slate-600",
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  )
}

function BalanceCell({ upload }: { upload: Upload }) {
  if (upload.balance_verified === true) {
    return (
      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Verified
      </span>
    )
  }
  if (upload.balance_verified === false) {
    return (
      <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Mismatch
      </span>
    )
  }
  return <span className="text-muted-foreground">—</span>
}

export function UploadHistoryModal({ accountId, bankName, onDelete, onClose }: Props) {
  const { uploads, isLoading, mutate } = useUploads(accountId)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const confirmingUpload = confirmDeleteId
    ? (uploads.find((u) => u.id === confirmDeleteId) ?? null)
    : null

  async function handleDelete() {
    if (!confirmDeleteId) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/upload/${confirmDeleteId}?force=true`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setDeleteError(data.error ?? "Failed to delete upload")
        return
      }
      await mutate()
      setConfirmDeleteId(null)
      onDelete()
    } catch {
      setDeleteError("Network error. Please try again.")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload History — {bankName}</DialogTitle>
        </DialogHeader>

        {confirmDeleteId ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm space-y-2">
              <p className="font-medium text-destructive">Delete this upload?</p>
              <p className="text-muted-foreground">
                This will permanently delete{" "}
                <span className="font-medium">
                  {confirmingUpload?.row_count ?? 0} transactions
                </span>{" "}
                and all corrections made to them. This cannot be undone — you can re-upload the
                file afterwards.
              </p>
              {confirmingUpload && (
                <p className="font-mono text-xs text-muted-foreground">
                  {confirmingUpload.filename}
                </p>
              )}
            </div>
            {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setConfirmDeleteId(null); setDeleteError(null) }}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? "Deleting…" : "Delete upload"}
              </Button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : uploads.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No uploads yet for this account.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                    Filename
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                    Uploaded
                  </th>
                  <th className="pb-2 pr-4 text-right text-xs font-medium text-muted-foreground">
                    Rows
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                    Balance
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {uploads.map((upload) => {
                  const canDelete =
                    upload.status !== "pending" && upload.status !== "processing"
                  return (
                    <tr key={upload.id} className="border-b last:border-0">
                      <td className="max-w-[180px] truncate py-2.5 pr-4 font-mono text-xs">
                        {upload.filename}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-4 text-muted-foreground">
                        {formatUploadDate(upload.uploaded_at)}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {upload.row_count ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4">
                        <BalanceCell upload={upload} />
                      </td>
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={upload.status} />
                      </td>
                      <td className="py-2.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeleteId(upload.id)}
                          disabled={!canDelete}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          title="Delete upload"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
