import OpenAI from "openai"

export const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL || undefined,
  apiKey: process.env.OPENAI_BASE_URL
    ? process.env.OPENAI_API_KEY
    : process.env.OPENAI_REALTIME_API_KEY,
})