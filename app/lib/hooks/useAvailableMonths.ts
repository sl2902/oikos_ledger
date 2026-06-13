import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

export interface MonthTab {
  key: string
  label: string
}

export function useAvailableMonths(accountId: string | null) {
  const { data, error, isLoading,mutate } = useSWR<MonthTab[]>(
    accountId ? `/api/transactions/months?account_id=${accountId}` : null,
    fetcher,
    { 
      revalidateOnFocus: false,
      revalidateOnMount: true, 
    },
  )

  // console.log("months error:", error)
  // console.log("months isLoading:", isLoading)
  // console.log("months data:", data)

  return {
    availableMonths: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
  }
}
