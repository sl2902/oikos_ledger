import crypto from "node:crypto"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { uploads } from "@/lib/db/schema"
import { getBankAccountsByUserId } from "@/lib/db/queries/bank_accounts"
import { createUpload, deleteUpload, getUploadByHash } from "@/lib/db/queries/transactions"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 })
  }

  const file = formData.get("file") as File | null
  const account_id = formData.get("account_id") as string | null

  if (!file || !account_id) {
    return Response.json({ error: "Missing file or account_id" }, { status: 400 })
  }

  const filename = file.name
  if (!filename.toLowerCase().endsWith(".csv")) {
    return Response.json({ error: "Only CSV files are accepted" }, { status: 400 })
  }

  // Verify account belongs to the authenticated user
  const accounts = await getBankAccountsByUserId(session.user.id)
  const account = accounts.find((a) => a.id === account_id)
  if (!account) {
    return Response.json({ error: "Account not found" }, { status: 404 })
  }

  // Compute SHA-256 of file content
  const buffer = Buffer.from(await file.arrayBuffer())

  if (buffer.byteLength > 10 * 1024 * 1024) {
    return Response.json(
      {
        error: "File too large",
        message: "Maximum file size is 10MB. Bank statement CSVs are typically under 2MB.",
      },
      { status: 413 },
    )
  }

  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex")

  // Handle duplicate file hash
  const existing = await getUploadByHash(session.user.id, account_id, fileHash)
  if (existing) {
    if (existing.status === "complete") {
      return Response.json(
        { upload_id: existing.id, status: "complete", row_count: existing.row_count, duplicate: true },
        { status: 200 },
      )
    }
    if (existing.status === "pending" || existing.status === "processing") {
      return Response.json(
        { upload_id: existing.id, status: existing.status, duplicate: true },
        { status: 200 },
      )
    }
    // failed or cancelled — delete stale record and allow a fresh upload
    await deleteUpload(existing.id)
  }

  // Create upload row BEFORE S3 upload to capture true start time
  const upload = await createUpload({
    user_id: session.user.id,
    account_id,
    filename,
    file_hash: fileHash,
    s3_key: "",
    status: "pending",
  })

  // Upload to S3 (skipped if AWS not configured)
  let s3Key = ""
  try {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3")
    const bucket = process.env.AWS_S3_BUCKET
    const region = process.env.AWS_REGION || "ap-south-1"
    if (bucket) {
      s3Key = `uploads/${session.user.id}/${account_id}/${fileHash}/${filename}`
      const s3 = new S3Client({ region })
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: buffer,
          ContentType: "text/csv",
          ServerSideEncryption: "AES256",
        }),
      )
      await db.update(uploads).set({ s3_key: s3Key }).where(eq(uploads.id, upload.id))
    }
  } catch (err) {
    console.warn("S3 upload skipped (AWS not configured):", err)
  }

  // Invoke Lambda (skipped if not configured — run lambda_handler.py directly for local testing)
  try {
    const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda")
    const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME
    const region = process.env.AWS_REGION || "ap-south-1"
    if (functionName) {
      const lambda = new LambdaClient({ region })
      await lambda.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: "Event",
          Payload: Buffer.from(
            JSON.stringify({
              upload_id: upload.id,
              account_id,
              user_id: session.user.id,
              s3_key: s3Key,
              bank_name: account.bank_name,
            }),
          ),
        }),
      )
    }
  } catch (err) {
    console.warn("Lambda invocation skipped (AWS not configured):", err)
  }

  return Response.json({ upload_id: upload.id, status: upload.status }, { status: 201 })
}
