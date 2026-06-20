import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { EffectiveTransaction } from "@/types"

export interface TransactionFilters {
  search?: string
  category?: string
  payment_method?: string
  date_from?: string
  date_to?: string
  amount_min?: number
  amount_max?: number
  month?: string
  page?: number
  transaction_type?: "debit" | "credit" | "all"
}

interface TransactionsResponse {
  transactions: EffectiveTransaction[]
  total: number
  page: number
  limit: number
  total_pages: number
  balance_verified: boolean | null
  balance_discrepancy: string | null
  month_total_debits: string | null
  month_total_credits: string | null
  opening_balance: string | null
  closing_balance: string | null
}

export function useTransactions(accountId: string | null, filters?: TransactionFilters) {
  const params = new URLSearchParams()
  if (accountId) params.set("account_id", accountId)
  if (filters?.month) params.set("month", filters.month)
  if (filters?.search) params.set("search", filters.search)
  if (filters?.category) params.set("category", filters.category)
  if (filters?.date_from) params.set("date_from", filters.date_from)
  if (filters?.date_to) params.set("date_to", filters.date_to)
  if (filters?.amount_min != null) params.set("amount_min", String(filters.amount_min))
  if (filters?.amount_max != null) params.set("amount_max", String(filters.amount_max))
  if (filters?.page != null) params.set("page", String(filters.page))
  if (filters?.transaction_type && filters.transaction_type !== "all") {
    params.set("transaction_type", filters.transaction_type)
  }
  // payment_method has no DB column — applied client-side in TransactionsPanel

  const { data, error, isLoading, mutate } = useSWR<TransactionsResponse>(
    accountId ? `/api/transactions?${params.toString()}` : null,
    fetcher,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    },
  )

  return {
    transactions: data?.transactions ?? [],
    total: data?.total ?? 0,
    total_pages: data?.total_pages ?? 1,
    isLoading,
    isError: !!error,
    mutate,
    balanceVerified: data?.balance_verified ?? null,
    balanceDiscrepancy: data?.balance_discrepancy ?? null,
    monthTotalDebits: data?.month_total_debits ?? null,
    monthTotalCredits: data?.month_total_credits ?? null,
    openingBalance: data?.opening_balance ?? null,
    closingBalance: data?.closing_balance ?? null,
  }
}
