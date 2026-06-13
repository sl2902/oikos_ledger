import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

export interface Upload {
  id: string
  filename: string
  status: string
  row_count: number | null
  balance_verified: boolean | null
  balance_discrepancy: string | null
  opening_balance: string | null
  closing_balance: string | null
  uploaded_at: string
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
