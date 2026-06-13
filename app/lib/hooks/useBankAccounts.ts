import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { BankAccount } from "@/types"

export function useBankAccounts() {
  const { data, error, isLoading, mutate } = useSWR<BankAccount[]>(
    "/api/bank_accounts",
    fetcher,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    },
  )

  return {
    accounts: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
  }
}
