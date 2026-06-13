import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

interface Category {
  id: string
  name: string
}

interface Subcategory {
  id: string
  name: string
  parent_id: string
}

interface CategoriesResponse {
  categories: Category[]
  subcategories: Subcategory[]
}

export function useCategories() {
  const { data, error, isLoading } = useSWR<CategoriesResponse>(
    "/api/categories",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    },
  )

  return {
    categories: data?.categories ?? [],
    subcategories: data?.subcategories ?? [],
    isLoading,
    isError: !!error,
  }
}
