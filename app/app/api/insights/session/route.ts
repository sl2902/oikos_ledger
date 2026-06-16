import { auth } from "@/auth"
import OpenAI from "openai"

export const dynamic = "force-dynamic"

const INSTRUCTIONS = `You are a personal finance assistant for an Indian \
banking app called Oikos Ledger. Keep responses brief — 1-2 sentences. \
Use Indian number formatting (lakhs, crores). \
When the user says thank you, goodbye, or indicates they are done, \
give a warm brief farewell and wish them well.`

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_REALTIME_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: "gpt-realtime-2",
            audio: {
              output: {
                voice: "alloy",
                format: {
                  type: "audio/pcm",
                  rate: 24000,
                },
              },
            },
            instructions: INSTRUCTIONS,
          },
        }),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      return Response.json(
        { error: "Failed to create realtime session", detail: error },
        { status: 500 }
      )
    }

    const data = await response.json()
    console.log("Realtime session response:", JSON.stringify(data, null, 2))
    return Response.json({client_secret: { value: data.value }, session_id: data.session?.id})
  } catch (error) {
    return Response.json(
      { error: "Failed to create realtime session", detail: String(error) },
      { status: 500 }
    )
  }
}