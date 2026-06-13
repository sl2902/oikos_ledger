"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { useAccounts } from "@/components/accounts/AccountsContext"
import type { UploadStatus } from "@/types"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

interface Props {
  accountId?: string
  bankName: string
  onSuccess: () => void
}

type State =
  | { phase: "idle" }
  | { phase: "uploading" }
  | { phase: "polling"; uploadId: string; status: UploadStatus }
  | {
      phase: "complete"
      rowCount?: number
      duplicate?: boolean
      balanceVerified?: boolean
      balanceDiscrepancy?: string | null
    }
  | { phase: "error"; message: string }

const PIPELINE_STAGES = [
  {
    label: "Uploading file...",
    condition: (status: string, _elapsed: number) => status === "uploading",
    progress: 10,
  },
  {
    label: "File received. Parsing transactions...",
    condition: (status: string, elapsed: number) =>
      status === "processing" && elapsed < 8000,
    progress: 35,
  },
  {
    label: "Normalizing merchants and categories...",
    condition: (status: string, elapsed: number) =>
      status === "processing" && elapsed >= 8000 && elapsed < 20000,
    progress: 65,
  },
  {
    label: "Generating embeddings...",
    condition: (status: string, elapsed: number) =>
      status === "processing" && elapsed >= 20000,
    progress: 85,
  },
  {
    label: "Complete!",
    condition: (status: string, _elapsed: number) => status === "complete",
    progress: 100,
  },
]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UploadStatementModal({ accountId: accountIdProp, bankName, onSuccess }: Props) {
  const { selectedAccountId: contextAccountId } = useAccounts()
  const accountId = accountIdProp ?? contextAccountId ?? ""
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State>({ phase: "idle" })
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileSizeError, setFileSizeError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const fileRef = useRef<HTMLInputElement>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const processingStartRef = useRef<number | null>(null)
  // Set true when user cancels during the uploading phase so handleSubmit can
  // clean up the upload record once the POST eventually returns.
  const cancelRequestedRef = useRef(false)

  // Auto-close 2 seconds after pipeline completes.
  useEffect(() => {
    if (state.phase !== "complete") return
    const timer = setTimeout(() => {
      setOpen(false)
      reset()
      onSuccess()
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])

  function stopElapsedTimer() {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }

  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  function reset() {
    stopElapsedTimer()
    stopPolling()
    processingStartRef.current = null
    setElapsed(0)
    setState({ phase: "idle" })
    setSelectedFile(null)
    setFileSizeError(null)
    if (fileRef.current) fileRef.current.value = ""
    // cancelRequestedRef is intentionally NOT reset here — handleSubmit clears it
    // at the start of each new attempt to avoid a race with an in-flight POST.
  }

  // Called by every Cancel button regardless of phase.
  async function handleCancel() {
    if (state.phase === "idle" || state.phase === "error") {
      setOpen(false)
      reset()
      return
    }

    if (state.phase === "uploading") {
      // POST is still in flight — we can't call DELETE yet (no upload_id).
      // Flag the cancel so handleSubmit cleans up once the response arrives.
      cancelRequestedRef.current = true
      setOpen(false)
      reset()
      return
    }

    if (state.phase === "polling") {
      const uploadId = state.uploadId
      stopElapsedTimer()
      stopPolling()

      try {
        const res = await fetch(`/api/upload/${uploadId}`, { method: "DELETE" })

        if (res.status === 409) {
          const data = await res.json()
          setState({ phase: "complete", rowCount: data.row_count ?? undefined })
          setTimeout(() => {
            setOpen(false)
            reset()
            onSuccess()
          }, 2000)
          return
        }
      } catch {
        // Network error — just close
      }

      setOpen(false)
      reset()
    }

    if (state.phase === "complete") {
      setOpen(false)
      reset()
      onSuccess()
    }
  }

  async function handleSubmit() {
    if (!selectedFile) return
    cancelRequestedRef.current = false // clear flag from any previous cancel
    setState({ phase: "uploading" })

    const form = new FormData()
    form.append("file", selectedFile)
    form.append("account_id", accountId)

    try {
      const res = await fetch("/api/upload", { method: "POST", body: form })
      const data = await res.json()

      if (!res.ok) {
        if (!cancelRequestedRef.current) {
          setState({ phase: "error", message: data.message ?? data.error ?? "Upload failed." })
        }
        return
      }

      // Duplicate — already complete
      if (data.duplicate && data.status === "complete") {
        if (!cancelRequestedRef.current) {
          setState({ phase: "complete", rowCount: data.row_count ?? undefined, duplicate: true })
        }
        return
      }

      const uploadId = data.upload_id as string

      // User cancelled while the POST was in flight — clean up the upload row silently.
      if (cancelRequestedRef.current) {
        fetch(`/api/upload/${uploadId}`, { method: "DELETE" }).catch(() => {})
        return
      }

      // Duplicate in-progress — poll its status
      if (data.duplicate) {
        setState({ phase: "polling", uploadId, status: data.status as UploadStatus })
        return
      }

      // Fresh upload — start elapsed timer and begin polling
      processingStartRef.current = Date.now()
      elapsedTimerRef.current = setInterval(() => {
        if (processingStartRef.current) {
          setElapsed(Date.now() - processingStartRef.current)
        }
      }, 1000)

      setState({ phase: "polling", uploadId, status: "pending" })

      const poll = async () => {
        try {
          const res = await fetch(`/api/upload/${uploadId}`)
          if (!res.ok) return
          const data = await res.json()
          if (data.status === "complete") {
            stopPolling()
            stopElapsedTimer()
            setState({
              phase: "complete",
              rowCount: data.row_count ?? undefined,
              balanceVerified: data.balance_verified,
              balanceDiscrepancy: data.balance_discrepancy,
            })
          } else if (data.status === "failed") {
            stopPolling()
            stopElapsedTimer()
            setState({
              phase: "error",
              message: data.error_message || "Upload processing failed.",
            })
          } else if (data.status === "cancelled") {
            stopPolling()
            stopElapsedTimer()
            setState({ phase: "error", message: "Upload was cancelled." })
          }
        } catch {
          // keep polling on network error
        }
      }

      poll()
      pollIntervalRef.current = setInterval(poll, 1000)
    } catch {
      if (!cancelRequestedRef.current) {
        setState({ phase: "error", message: "Network error. Please try again." })
      }
    }
  }

  const busy = state.phase === "uploading" || state.phase === "polling"

  // Map phase/status to the string the stage conditions expect.
  // Treat "pending" as "processing" — Lambda is warming up; user sees the parsing stage.
  const displayStatus =
    state.phase === "uploading"
      ? "uploading"
      : state.phase === "complete"
        ? "complete"
        : state.phase === "polling"
          ? "processing"
          : ""

  const activeStage =
    [...PIPELINE_STAGES].reverse().find((s) => s.condition(displayStatus, elapsed)) ??
    PIPELINE_STAGES[0]

  const elapsedSeconds = Math.floor(elapsed / 1000)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) {
          setOpen(v)
          if (!v) {
            // If the user closes the dialog manually while the success screen is
            // showing, still trigger the callback (auto-close effect is cancelled).
            const wasComplete = state.phase === "complete"
            reset()
            if (wasComplete) onSuccess()
          }
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Upload Statement
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload {bankName} Statement</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload your bank statement as a CSV file. Download it from your bank&apos;s net banking
            portal under <span className="font-medium">Statements → Download → CSV. Max file size is {MAX_FILE_SIZE / 1024 / 1024} MB</span>.
          </p>

          {/* Idle — file picker */}
          {state.phase === "idle" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null
                    if (file && file.size > MAX_FILE_SIZE) {
                      setFileSizeError(
                        "File too large. Maximum size is 10MB. Bank statement CSVs are typically under 2MB.",
                      )
                      setSelectedFile(null)
                      if (fileRef.current) fileRef.current.value = ""
                    } else {
                      setFileSizeError(null)
                      setSelectedFile(file)
                    }
                  }}
                />
                {fileSizeError && (
                  <p className="text-xs text-destructive">{fileSizeError}</p>
                )}
                {selectedFile && !fileSizeError && (
                  <p className="text-xs text-muted-foreground">
                    {selectedFile.name} — {formatFileSize(selectedFile.size)}
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={!selectedFile || !!fileSizeError}>
                  Upload
                </Button>
              </div>
            </div>
          )}

          {/* Uploading / polling — progress bar + Cancel */}
          {busy && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Progress value={activeStage.progress} />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{activeStage.label}</span>
                  <span>{activeStage.progress}%</span>
                </div>
                {state.phase === "polling" && (
                  <p className="text-xs text-muted-foreground">
                    Processing… ({elapsedSeconds}s)
                  </p>
                )}
              </div>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Complete — success, auto-closes */}
          {state.phase === "complete" && (
            <div className="flex flex-col items-center gap-3 py-2">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-sm font-medium text-green-600">
                {state.duplicate
                  ? `Already imported — ${state.rowCount ?? 0} transactions loaded.`
                  : `Done! ${state.rowCount} transactions imported.`}
              </p>
              {state.balanceVerified === false && (
                <div className="flex items-center gap-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-xs text-yellow-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />
                  <span>
                    Balance discrepancy detected — some transactions may be
                    missing. Discrepancy: ₹{state.balanceDiscrepancy}
                  </span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Closing automatically…</p>
            </div>
          )}

          {/* Error — message, Cancel + Try again */}
          {state.phase === "error" && (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{state.message}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button onClick={reset}>Try again</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
