import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

export interface MonthTab {
  key: string
  label: string
}

export function useAvailableMonths(accountId: string | null) {
  const { data, error, isLoading } = useSWR<MonthTab[]>(
    accountId ? `/api/transactions/months?account_id=${accountId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  return {
    availableMonths: data ?? [],
    isLoading,
    isError: !!error,
  }
}
