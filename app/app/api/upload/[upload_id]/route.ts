import { auth } from "@/auth"
import { cancelUpload, deleteUpload, getUploadById } from "@/lib/db/queries/transactions"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ upload_id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { upload_id } = await params
  const upload = await getUploadById(upload_id)

  if (!upload || upload.user_id !== session.user.id) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  return Response.json(
    {
      upload_id: upload.id,
      status: upload.status,
      row_count: upload.row_count,
      error_message: upload.error_message,
      opening_balance: upload.opening_balance,
      closing_balance: upload.closing_balance,
      balance_verified: upload.balance_verified,
      balance_discrepancy: upload.balance_discrepancy,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  )
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ upload_id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { upload_id } = await params
  const upload = await getUploadById(upload_id)

  if (!upload || upload.user_id !== session.user.id) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const force = searchParams.get("force") === "true"

  if (force) {
    // Hard delete from upload history — block only in-progress uploads
    if (upload.status === "pending" || upload.status === "processing") {
      return Response.json(
        { error: "Cannot delete an upload that is still processing" },
        { status: 409 },
      )
    }
    await deleteUpload(upload_id)
    return Response.json({ upload_id, status: "deleted" })
  }

  // Cancel flow — preserve race-condition 409 for polling modal
  if (upload.status === "complete") {
    return Response.json(
      {
        error: "Cannot cancel a completed upload",
        status: "complete",
        row_count: upload.row_count,
      },
      { status: 409 },
    )
  }

  const cancelled = await cancelUpload(upload_id)

  if (!cancelled) {
    const fresh = await getUploadById(upload_id)
    return Response.json(
      {
        error: "Cannot cancel a completed upload",
        status: "complete",
        row_count: fresh?.row_count ?? null,
      },
      { status: 409 },
    )
  }

  return Response.json({ upload_id, status: "cancelled" })
}
