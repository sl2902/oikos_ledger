import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

export function useTransactionCategories(accountId: string | null) {
  const { data } = useSWR<string[]>(
    accountId ? `/api/transactions/categories?account_id=${accountId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )
  return { categories: data ?? [] }
}
