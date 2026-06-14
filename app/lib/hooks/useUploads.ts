import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { DroppedRow } from "@/types"

export interface Upload {
  id: string
  filename: string
  status: string
  row_count: number | null
  balance_verified: boolean | null
  balance_discrepancy: string | null
  opening_balance: string | null
  closing_balance: string | null
  dropped_rows: DroppedRow[] | null
  uploaded_at: string
  error_message: string | null
  completed_at: string | null
}

interface UploadsResponse {
  uploads: Upload[]
}

export function useUploads(accountId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<UploadsResponse>(
    accountId ? `/api/uploads?account_id=${accountId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 },
  )

  return {
    uploads: data?.uploads ?? [],
    isLoading,
    isError: !!error,
    mutate,
  }
}
