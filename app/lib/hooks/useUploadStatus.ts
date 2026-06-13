import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

interface UploadStatusResponse {
  upload_id: string
  status: string
  row_count: number | null
  error_message: string | null
}

export function useUploadStatus(uploadId: string | null) {
  const { data, error } = useSWR<UploadStatusResponse>(
    uploadId ? `/api/upload/${uploadId}` : null,
    fetcher,
    {
      refreshInterval: (data) => {
        if (!data) return 1000
        if (data.status === "complete" || data.status === "failed" || data.status === "cancelled") return 0
        return 2000
      },
      revalidateOnFocus: false,
    },
  )

  return {
    uploadStatus: data ?? null,
    isError: !!error,
  }
}
