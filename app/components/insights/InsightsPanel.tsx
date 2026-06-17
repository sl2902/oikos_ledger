"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  Mic, MicOff, Send, Volume2, VolumeX, X, RotateCcw, CalendarDays,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAccounts } from "@/components/accounts/AccountsContext"
import { TurnCard } from "./TurnCard"

// Extend Window for webkit-prefixed Speech API
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition: (new () => any) | undefined
  }
}

export interface ChatTurn {
  id: string
  role: "user" | "assistant"
  content: string
  type?: "message" | "suggestions"
  suggestions?: { query_text: string; query_hash: string }[]
  cached?: boolean
  sql?: string
  chart_type?: string
  results?: Record<string, unknown>[]
  intent_label?: string
  intent_description?: string
  row_count?: number
  timestamp: Date
}

interface InsightResult {
  type?: "message" | "suggestions"
  suggestions?: { query_text: string; query_hash: string }[]
  cached?: boolean
  question: string
  intent: string
  intent_label: string
  intent_description: string
  is_custom: boolean
  sql: string
  results: Record<string, unknown>[]
  response: string
  chart_type: string
  row_count: number
}

const QUICK_QUESTIONS = [
  { id: "monthly_trend", label: "Monthly trend" },
  { id: "biggest_expenses", label: "Biggest expenses" },
  { id: "credits_vs_debits", label: "Credits vs Debits" },
  { id: "top_merchants", label: "Top merchants" },
  { id: "spending_by_category", label: "Spending by category" },
]

const VOICE_ENABLED = process.env.NEXT_PUBLIC_VOICE_ENABLED === "true"


export function InsightsPanel() {
  const { selectedAccountId, setSelectedAccountId, accounts } = useAccounts()
  const [question, setQuestion] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [error, setError] = useState<string | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [isVoiceConnected, setIsVoiceConnected] = useState(false)
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo] = useState<string>("")
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<
    "idle" | "connecting" | "listening" | "speaking"
  >("idle")

  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<AudioWorkletNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const prevAccountId = useRef<string | null>(null)
  const isResponseInProgress = useRef(false)
  const processedCallIds = useRef<Set<string>>(new Set())
  const lastTranscriptRef = useRef<string>("")
  const shouldDisconnectAfterResponse = useRef(false)
  const awaitingFarewellResponse = useRef(false)
  const transcriptTimer = useRef<NodeJS.Timeout | null>(null)
  const turnsRef = useRef<ChatTurn[]>([])
  const lastAudioScheduledEndTimeRef = useRef<number>(0)

  // Scroll to bottom on new turns
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [turns])

  useEffect(() => {
    turnsRef.current = turns
  }, [turns])

  const disconnectVoice = useCallback(() => {
    if (transcriptTimer.current) {
      clearTimeout(transcriptTimer.current)
      transcriptTimer.current = null
    }
    awaitingFarewellResponse.current = false
    shouldDisconnectAfterResponse.current = false
    wsRef.current?.close()
    wsRef.current = null
    stopMicCapture()
    setIsVoiceConnected(false)
    setVoiceStatus("idle")
  }, [])

  // Consolidated account change + persistence effect
  useEffect(() => {
    if (!selectedAccountId) return

    // Account switched — reset everything
    if (prevAccountId.current && prevAccountId.current !== selectedAccountId) {
      setTurns([])
      setError(null)
      setQuestion("")
      setDateFrom("")
      setDateTo("")
      setShowDateFilter(false)
      disconnectVoice()
      prevAccountId.current = selectedAccountId
      
      // Restore turns for the new account from sessionStorage
      const storedTurns = sessionStorage.getItem(
        `insights_turns_${selectedAccountId}`
      )
      if (storedTurns) {
        try {
          const parsed = JSON.parse(storedTurns) as ChatTurn[]
          setTurns(parsed.map(t => ({ ...t, timestamp: new Date(t.timestamp) })))
        } catch {
          sessionStorage.removeItem(`insights_turns_${selectedAccountId}`)
          setTurns([])
        }
      } else {
        setTurns([])
      }

      // Restore date filter for new account
      const storedFilter = sessionStorage.getItem(
        `insights_filter_${selectedAccountId}`
      )
      if (storedFilter) {
        try {
          const { dateFrom: df, dateTo: dt, showDateFilter: show } =
            JSON.parse(storedFilter)
          if (df) setDateFrom(df)
          if (dt) setDateTo(dt)
          if (show) setShowDateFilter(show)
        } catch {
          sessionStorage.removeItem(`insights_filter_${selectedAccountId}`)
        }
      }
      return
    }

    // First load for this account — restore from sessionStorage
    if (prevAccountId.current === null) {
      prevAccountId.current = selectedAccountId

      // Restore turns
      const storedTurns = sessionStorage.getItem(`insights_turns_${selectedAccountId}`)
      if (storedTurns) {
        try {
          const parsed = JSON.parse(storedTurns) as ChatTurn[]
          setTurns(parsed.map(t => ({ ...t, timestamp: new Date(t.timestamp) })))
        } catch {
          sessionStorage.removeItem(`insights_turns_${selectedAccountId}`)
        }
      }

      // Restore date filter
      const storedFilter = sessionStorage.getItem(`insights_filter_${selectedAccountId}`)
      if (storedFilter) {
        try {
          const { dateFrom: df, dateTo: dt, showDateFilter: show } = JSON.parse(storedFilter)
          if (df) setDateFrom(df)
          if (dt) setDateTo(dt)
          if (show) setShowDateFilter(show)
        } catch {
          sessionStorage.removeItem(`insights_filter_${selectedAccountId}`)
        }
      }
    }
  }, [selectedAccountId, disconnectVoice])

  // Persist turns to sessionStorage whenever they change
  useEffect(() => {
    if (!selectedAccountId) return
    if (turns.length === 0) {
      sessionStorage.removeItem(`insights_turns_${selectedAccountId}`)
      return
    }
    sessionStorage.setItem(
      `insights_turns_${selectedAccountId}`,
      JSON.stringify(turns)
    )
  }, [turns, selectedAccountId])

  // Persist date filter to sessionStorage whenever it changes
  useEffect(() => {
    if (!selectedAccountId) return
    sessionStorage.setItem(
      `insights_filter_${selectedAccountId}`,
      JSON.stringify({ dateFrom, dateTo, showDateFilter })
    )
  }, [dateFrom, dateTo, showDateFilter, selectedAccountId])

  function buildHistory() {
    return turnsRef.current.map(t => ({
      role: t.role,
      content: t.role === "assistant" && t.intent_label
        ? `[${t.intent_label}] ${t.content}`
        : t.content,
    }))
  }

  function addTurn(turn: Omit<ChatTurn, "id" | "timestamp">) {
    setTurns(prev => [
      ...prev,
      { ...turn, id: crypto.randomUUID(), timestamp: new Date() },
    ])
  }

  function updateTurn(
    id: string,
    updates: Partial<Omit<ChatTurn, "id" | "timestamp">>,
  ) {
    setTurns(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }

  function appendToTurn(id: string, text: string) {
    setTurns(prev => prev.map(t =>
      t.id === id ? { ...t, content: t.content + text } : t
    ))
  }

  function flushPendingUserTranscript() {
    if (transcriptTimer.current) {
      clearTimeout(transcriptTimer.current)
      transcriptTimer.current = null
    }
    if (lastTranscriptRef.current) {
      addTurn({ role: "user", content: lastTranscriptRef.current, type: "message" })
    }
  }

  async function handleQuery(
    q?: string,
    intentId?: string,
    skipUserTurn = false,
    isVoice = false,
  ): Promise<string> {
    if (!selectedAccountId) return ""
    const queryText = q ?? question
    if (!queryText && !intentId) return ""

    setIsLoading(true)
    setError(null)
    setQuestion("")

    if (!skipUserTurn) {
      addTurn({ role: "user", content: queryText || intentId!, type: "message" })
    }

    try {
      const lastAssistantTurn = [...turns]
        .reverse()
        .find(t => t.role === "assistant")
      
      console.log("conversation history length:", buildHistory().length)

      const res = await fetch("/api/insights/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          question: queryText,
          intent: intentId ?? null,
          account_id: selectedAccountId,
          conversation_history: buildHistory(),
          last_chart_type: lastAssistantTurn?.chart_type ?? null,
          last_results: lastAssistantTurn?.results ?? null,
          date_from: dateFrom || null,
          date_to: dateTo || null,
          is_voice: isVoice,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? "Query failed")
        return ""
      }

      const contentType = res.headers.get("content-type") ?? ""

      // Non-streaming: off-topic, display command, cache hit, suggestions
      if (contentType.includes("application/json")) {
        const data: InsightResult = await res.json()

        if (data.intent === "off_topic") {
          if (!isVoice) {
              addTurn({ role: "assistant", content: data.response, type: "message" })
            }
          // Don't add canned message — let voice model handle conversation naturally
          return data.response ?? ""
        }

        if (data.type === "suggestions") {
          addTurn({
            role: "assistant",
            content: data.response,
            type: "suggestions",
            suggestions: data.suggestions,
          })
          return data.response ?? ""
        }

        addTurn({
          role: "assistant",
          content: data.response,
          type: "message",
          cached: data.cached,
          sql: data.sql,
          chart_type: data.chart_type,
          results: data.results,
          intent_label: data.intent_label,
          intent_description: data.intent_description,
          row_count: data.row_count,
        })
        return data.response ?? ""
      }

      // Streaming SSE response
      const turnId = crypto.randomUUID()

      // In voice mode, response.output_item.done adds the turn after the model
      // speaks — skip the placeholder here to avoid an empty assistant box.
      if (!isVoice) {
        setTurns(prev => [
          ...prev,
          {
            id: turnId,
            role: "assistant" as const,
            content: "",
            type: "message" as const,
            timestamp: new Date(),
          },
        ])
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let fullText = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const payload = line.slice(6).trim()
          if (payload === "[DONE]") break

          try {
            const parsed = JSON.parse(payload)

            if (parsed.type === "metadata") {
              if (!isVoice) {
                updateTurn(turnId, {
                  sql: parsed.sql,
                  chart_type: parsed.chart_type,
                  results: parsed.results,
                  intent_label: parsed.intent_label,
                  intent_description: parsed.intent_description,
                  row_count: parsed.row_count,
                })
              }
            } else if (parsed.type === "text") {
              fullText += parsed.text
              if (!isVoice) {
                appendToTurn(turnId, parsed.text)
              }
            } else if (parsed.type === "error") {
              setError(parsed.message)
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      return fullText
    } catch {
      setError("Network error. Please try again.")
      return ""
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCachedQuery(queryHash: string, queryText: string) {
    if (!selectedAccountId) return

    setIsLoading(true)
    setError(null)

    addTurn({ role: "user", content: queryText, type: "message" })

    try {
      const res = await fetch("/api/insights/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query_hash: queryHash,
          account_id: selectedAccountId,
        }),
      })

      if (!res.ok) {
        setError("Failed to load cached result")
        return
      }

      const data: InsightResult = await res.json()
      addTurn({
        role: "assistant",
        content: data.response,
        type: "message",
        cached: data.cached,
        sql: data.sql,
        chart_type: data.chart_type,
        results: data.results,
        intent_label: data.intent_label,
        intent_description: data.intent_description,
        row_count: data.row_count,
      })
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  async function connectVoice() {
    if (!selectedAccountId) return

    setIsVoiceConnected(true)
    setVoiceStatus("connecting")

    try {
      const micPromise = startMicCapture()

      const tokenRes = await fetch("/api/insights/session", { method: "POST" })
      if (!tokenRes.ok) throw new Error("Failed to get session token")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { client_secret } = await tokenRes.json() as { client_secret: any }

      const ws = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-realtime-2",
        [
          "realtime",
          `openai-insecure-api-key.${client_secret.value}`,
        ],
      )

      let nextAudioStartTime = 0

      ws.onopen = async () => {
        setVoiceStatus("listening")

        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            // output_modalities: ["audio", "text"],
            audio: {
              input: {
                transcription: {
                  model: "gpt-realtime-whisper",
                },
              turn_detection: {
                type: "server_vad",
                threshold: 0.65,
                prefix_padding_ms: 300,
                silence_duration_ms: 800,
              },
            },
              output: {
                voice: "shimmer",
              },
            },
            tools: [
              {
                type: "function",
                name: "query_database",
                description: `Queries the user's financial transactions, expenses, balances, and spending trends. Use this whenever the user asks about spending, transactions, merchants, categories, monthly trends, or any financial data.`,
                parameters: {
                  type: "object",
                  properties: {
                    question: {
                      type: "string",
                      description: "The raw natural language financial question from the user. Do NOT expand categories or ask for currency formatting in this string. Keep it focused exactly on what the user asked.",
                    },
                  },
                  required: ["question"],
                },
              },
              {
                type: "function",
                name: "end_conversation",
                description: "Call this only after the user has explicitly confirmed they don't need anything else. Do not call this on a simple 'thank you' alone — first ask if there's anything else, and only call this once they confirm they're finished.",
                parameters: { type: "object", properties: {} },
              },
            ],
            tool_choice: "auto",
          },
        }))

        try {
          // Safely connect your incoming microphone stream worklets
          const streamData = await micPromise;
          if (streamData) {
            streamData.workletNode.port.onmessage = (e) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const buffer = e.data as ArrayBuffer;
              const bytes = new Uint8Array(buffer);
              let binary = "";
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64 = btoa(binary);
              ws.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: base64,
              }));
            };
          }

          // THE FAILSAFE FIX: Ensure AudioContext exists and is forced active
          if (!audioContextRef.current) {
            // Create a fresh instance if it was cleared out during a previous disconnect
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
          }

          // Unblock the browser's hardware restrictions completely
          if (audioContextRef.current.state === "suspended") {
            await audioContextRef.current.resume();
          }

          // console.log("Audio infrastructure active. Triggering greetings...");

          // Commit the conversational initialization turn
          ws.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "Hello! I am ready to talk." }],
            },
          }));

          // Fire response generation to pull audio buffers immediately
          ws.send(JSON.stringify({
            type: "response.create",
            response: {
              instructions: "Greet the user warmly in exactly one brief sentence welcoming them back. Keep it short.",
            },
          }));
          isResponseInProgress.current = true;

        } catch (micErr) {
          console.error("Voice handshake initialization failed:", micErr);
          setError("Could not bind streaming channels safely.");
          disconnectVoice();
        }
      }

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data as string)
        // console.log("WS message:", msg.type)

        if (msg.type === "response.created") {
          isResponseInProgress.current = true
        }

        if (msg.type === "response.done") {
          isResponseInProgress.current = false

          if (awaitingFarewellResponse.current) {
            // This response.done is for the farewell — promote to disconnect
            awaitingFarewellResponse.current = false
            shouldDisconnectAfterResponse.current = true
          }

          if (shouldDisconnectAfterResponse.current) {
            shouldDisconnectAfterResponse.current = false
            const now = audioContextRef.current ? audioContextRef.current.currentTime : 0
            const remainingPlayTimeMs = Math.max(0, (lastAudioScheduledEndTimeRef.current - now) * 1000)
            setTimeout(() => {
              disconnectVoice()
            }, remainingPlayTimeMs + 800)
          } else {
            setVoiceStatus("listening")
          }
        }

        if (msg.type === "input_audio_buffer.speech_started") {
          if (transcriptTimer.current) {
            clearTimeout(transcriptTimer.current)
            transcriptTimer.current = null
          }
          lastTranscriptRef.current = ""
          setVoiceStatus("listening")
          setQuestion("")

          // Interrupt client-side playback: clear future scheduling timeline
          if (audioContextRef.current) {
            nextAudioStartTime = audioContextRef.current.currentTime
            lastAudioScheduledEndTimeRef.current = audioContextRef.current.currentTime
          }

          // Interrupt server-side: Notify OpenAI to cancel what it was just streaming
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "response.cancel" }))
          }
        }

        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          if (msg.transcript?.trim()) {
            console.log("User transcript:", msg.transcript)
            const transcript = msg.transcript.trim()
            const lower = transcript.toLowerCase()
        

            // Replace brittle approach with function tool call
            // const isClosing = [
            //   "thank you", "thanks", "goodbye", "bye", "that's all",
            //   "that will be all", "i'm done", "im done", "no more questions",
            //   "you can go", "see you", "cheers", "ok thanks", "okay thanks",
            //   "great thanks", "perfect thanks", "sounds good thanks",
            //   "have a good day", "have a great day",
            // ].some(phrase => lower.includes(phrase))
            // if (isClosing) {
            //   shouldDisconnectAfterResponse.current = true
            // }

            lastTranscriptRef.current = transcript
            setQuestion(transcript)

            // After 500ms without a tool call, treat as conversational — add user bubble
            if (transcriptTimer.current) clearTimeout(transcriptTimer.current)
            transcriptTimer.current = setTimeout(() => {
              transcriptTimer.current = null
              if (lastTranscriptRef.current) {
                addTurn({ role: "user", content: lastTranscriptRef.current, type: "message" })
                lastTranscriptRef.current = "" // Clear it out so flushPendingUserTranscript won't re-add it
              }
            }, 500)
          }
        }

        if (msg.type === "conversation.item.input_audio_transcription.delta") {
          if (msg.delta) {
            setQuestion(prev => prev + msg.delta)
          }
        }

        if (msg.type === "response.function_call_arguments.done") {
          console.log("Tool call full message:", JSON.stringify(msg, null, 2));
          console.log(
            "Tool call #", 
            processedCallIds.current.size + 1,     
            "call_id:", msg.call_id,    
            "question:", JSON.parse((msg.arguments as string) || "{}").question
          );
          const callId = msg.call_id as string

          if (processedCallIds.current.has(callId)) return
          processedCallIds.current.add(callId)

          // Clear conversational timer — this is an explicit tool operation
          if (transcriptTimer.current) {
            clearTimeout(transcriptTimer.current)
            transcriptTimer.current = null
          }

          // Capture the transcript before flushing clears the ref
          const rawTranscript = lastTranscriptRef.current
          if (rawTranscript) {
            addTurn({ role: "user", content: rawTranscript, type: "message" })
            lastTranscriptRef.current = ""
          }

          if (msg.name === "end_conversation") {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: callId,
                  output: JSON.stringify({ success: true }),
                },
              }))
              if (!isResponseInProgress.current) {
                wsRef.current.send(JSON.stringify({ type: "response.create" }))
                isResponseInProgress.current = true
              }
            }
            awaitingFarewellResponse.current = true
            return
          }

          // Cancel conversational timer — this is a data query, not a conversational turn
          if (transcriptTimer.current) {
            clearTimeout(transcriptTimer.current)
            transcriptTimer.current = null
          }

          try {
            const args = JSON.parse(msg.arguments as string) as { question: string }

            const reformulated = args.question?.trim()
            const rawTranscript = lastTranscriptRef.current

            if (!reformulated) {
              console.warn("Tool call returned empty/missing question, falling back to raw transcript:", msg)
            }

            const queryQuestion = reformulated || rawTranscript

            // Use original transcript, not model's reformulation
            // const originalQuestion = lastTranscriptRef.current || args.question
            lastTranscriptRef.current = ""
            setQuestion("")

            // Send the model's reformulated question, not the raw transcript —
            // the model resolves follow-ups/category context (e.g. "yes, check
            // April" -> "How much did I spend on food in April 2026?") using its
            // own conversation context, which the raw transcript alone doesn't carry.
            const resultSummary = await handleQuery(queryQuestion, undefined, true, true)

            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: callId,
                  output: JSON.stringify({ success: true, summary: resultSummary }),
                },
              }))

              if (!isResponseInProgress.current) {
                wsRef.current.send(JSON.stringify({ type: "response.create" }))
                isResponseInProgress.current = true
              }
            }
          } catch (err) {
            console.error("Voice tool execution failed:", err)
            setError("Failed to process voice query.")
          }
        }

        if (msg.type === "response.output_item.done" && msg.item?.role === "assistant") {
          console.log("ASSISTANT OUTPUT ITEM STRUCT:", JSON.stringify(msg.item, null, 2))

          // Aggressively grab ANY text or transcript block across the entire array content stack
          // This bypasses the structural 'type' string gate completely (output_text, output_audio, text, audio)
          const textContent = msg.item.content
            ?.map((c: any) => c.text ?? c.transcript ?? "")
            .join("")
            .trim()

          // Separate tool function markers from conversational phrases
          const hasFunctionCall = msg.item.content?.some((c: any) => c.type === "function_call")

          // Only skip if it is a naked database tool trigger execution frame with no dialogue text
          if (hasFunctionCall && !textContent) {
            // console.log("Skipping pure background database transaction asset frame.")
            return
          }

          // Safely render the greetings, transitions, summaries, or endings on-screen
          if (textContent) {
            addTurn({ 
              role: "assistant", 
              content: textContent, 
              type: "message" 
            })
          }
        }

        if (msg.type === "response.output_audio.delta" && audioContextRef.current) {
          // If audio output is explicitly toggled off by the user, ignore playout pipelines
          if (!audioEnabled) return
          
          setVoiceStatus("speaking")
          const audioBuffer = Uint8Array.from(
            atob(msg.delta as string), c => c.charCodeAt(0)
          ).buffer
          const pcmData = new Int16Array(audioBuffer)
          const float32Data = new Float32Array(pcmData.length)

          for (let i = 0; i < pcmData.length; i++) {
            float32Data[i] = pcmData[i] / 32768.0
          }

          const ctx = audioContextRef.current
          const buffer = ctx.createBuffer(1, float32Data.length, 24000)
          buffer.copyToChannel(float32Data, 0)

          const source = ctx.createBufferSource()
          source.buffer = buffer
          source.connect(ctx.destination)

          const startTime = Math.max(ctx.currentTime, nextAudioStartTime)
          source.start(startTime)
          nextAudioStartTime = startTime + buffer.duration
          lastAudioScheduledEndTimeRef.current = nextAudioStartTime
        }

        if (msg.type === "error") {
          console.error("Realtime API error:", msg.error)
          setError(`Voice error: ${msg.error?.message}`)
        }
      }

      ws.onerror = () => {
        setError("Voice connection error. Please try again.")
        disconnectVoice()
      }

      ws.onclose = () => {
        setIsVoiceConnected(false)
        setVoiceStatus("idle")
        stopMicCapture()
      }

      wsRef.current = ws
    } catch {
      setError("Failed to connect voice. Please try again.")
      setVoiceStatus("idle")
      setIsVoiceConnected(false)
    }
  }

  async function startMicCapture(): Promise<{ workletNode: AudioWorkletNode } | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      })
      streamRef.current = stream

      const audioContext = new AudioContext({ sampleRate: 24000 })
      audioContextRef.current = audioContext

      const workletCode = `
        class PCMProcessor extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0][0]
            if (input) {
              const pcm16 = new Int16Array(input.length)
              for (let i = 0; i < input.length; i++) {
                pcm16[i] = Math.max(-32768, Math.min(32767, input[i] * 32768))
              }
              this.port.postMessage(pcm16.buffer, [pcm16.buffer])
            }
            return true
          }
        }
        registerProcessor('pcm-processor', PCMProcessor)
      `

      const blob = new Blob([workletCode], { type: "application/javascript" })
      const url = URL.createObjectURL(blob)
      await audioContext.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)

      const source = audioContext.createMediaStreamSource(stream)
      const workletNode = new AudioWorkletNode(audioContext, "pcm-processor")
      processorRef.current = workletNode

      source.connect(workletNode)
      workletNode.connect(audioContext.destination)

      return { workletNode }
    } catch (err) {
      console.error("startMicCapture failed:", err)
      return null
    }
  }

  function stopMicCapture() {
    processorRef.current?.disconnect()
    processorRef.current = null
    audioContextRef.current?.close()
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop())
    streamRef.current = null
  }

  function clearConversation() {
    setTurns([])
    setError(null)
    setQuestion("")
    setDateFrom("")
    setDateTo("")
    setShowDateFilter(false)
    if (selectedAccountId) {
      sessionStorage.removeItem(`insights_turns_${selectedAccountId}`)
      sessionStorage.removeItem(`insights_filter_${selectedAccountId}`)
    }
  }

  if (!selectedAccountId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select an account to view insights.
      </div>
    )
  }

  return (
    <div className="flex flex-col" style={{ height: "100%" }}>

      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background px-6 py-4 shrink-0">
        <h1 className="text-base font-semibold">Insights</h1>
        <div className="flex items-center gap-2">
          {turns.length > 0 && (
            <button
              onClick={clearConversation}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Clear conversation"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
          <select
            value={selectedAccountId ?? ""}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank_name} · {a.account_nickname ?? a.account_type}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Date filter toggle */}
      <div className="shrink-0 px-6 pt-2 pb-0">
        <button
          onClick={() => setShowDateFilter(prev => !prev)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {dateFrom || dateTo
            ? `${dateFrom || "Start"} → ${dateTo || "Today"}`
            : "Filter by date range"
          }
        </button>

        {showDateFilter && (
          <div className="flex items-center gap-2 mt-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(""); setDateTo("") }}
                className="text-xs text-destructive hover:text-destructive/80 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">

        {/* Empty state */}
        {turns.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-12">
            <p className="text-sm text-muted-foreground">
              Ask anything about your finances
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q.id}
                  onClick={() => handleQuery(q.label, q.id)}
                  disabled={isLoading}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation turns */}
        {turns.map((turn) => (
          <TurnCard
            key={turn.id}
            turn={turn}
            onSuggestionClick={handleCachedQuery}
          />
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Analyzing...
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Quick questions — show after first turn */}
        {turns.length > 0 && !isLoading && (
          <div className="flex flex-wrap gap-2 pt-2">
            {QUICK_QUESTIONS.map((q) => (
              <button
                key={q.id}
                onClick={() => handleQuery(q.label, q.id)}
                disabled={isLoading}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {q.label}
              </button>
            ))}
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t bg-background px-6 py-4 shrink-0">

        {/* Voice status bar */}
        {isVoiceConnected && (
          <div className={`flex items-center justify-between rounded-lg px-3 py-2 mb-3 border ${
            voiceStatus === "connecting"
              ? "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800"
              : voiceStatus === "speaking"
              ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
              : "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
          }`}>
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${
                voiceStatus === "connecting"
                  ? "bg-amber-400"
                  : voiceStatus === "speaking"
                  ? "bg-blue-500 animate-pulse"
                  : "bg-green-500 animate-pulse"
              }`} />
              <span className={`text-xs ${
                voiceStatus === "connecting"
                  ? "text-amber-700 dark:text-amber-400"
                  : voiceStatus === "speaking"
                  ? "text-blue-700 dark:text-blue-400"
                  : "text-green-700 dark:text-green-400"
              }`}>
                {voiceStatus === "connecting"
                  ? "Warming up audio pipelines... Please wait"
                  : voiceStatus === "speaking"
                  ? "Speaking"
                  : "Listening"
                }
              </span>
            </div>
            <button
              onClick={disconnectVoice}
              className="flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 transition-colors"
            >
              <X className="h-3 w-3" />
              Disconnect
            </button>
          </div>
        )}

        <div className="flex gap-2">
          {/* Audio toggle — only relevant when voice is not active */}
          {!isVoiceConnected && (
            <button
              onClick={() => setAudioEnabled(prev => !prev)}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
                audioEnabled
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
              title={audioEnabled ? "Disable audio response" : "Enable audio response"}
            >
              {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          )}

          {/* Voice connect/disconnect */}
          <button
            onClick={isVoiceConnected ? disconnectVoice : connectVoice}
            disabled={!isVoiceConnected && !process.env.NEXT_PUBLIC_VOICE_ENABLED}
            className={`flex h-10 w-10 shrink-0 items-center justify-center 
              rounded-full border transition-colors 
              disabled:opacity-50 disabled:cursor-not-allowed ${
              isVoiceConnected
                ? "border-destructive bg-destructive/10 text-destructive"
                : voiceStatus === "connecting"
                ? "border-primary bg-primary/10 text-primary animate-pulse"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
            title={!VOICE_ENABLED
                  ? "Voice requires OpenAI credits"
                  : isVoiceConnected 
                  ? "Disconnect voice" 
                  : "Connect voice (VAD enabled)"
                }
          >
            {isVoiceConnected ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          {/* Text input */}
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isLoading && question) {
                handleQuery()
              }
            }}
            placeholder={isVoiceConnected
              ? "Voice active — or type a question..."
              : "Ask anything about your finances..."
            }
            className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />

          {/* Send */}
          <Button
            onClick={() => handleQuery()}
            disabled={isLoading || !question}
            size="sm"
            className="h-10"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

    </div>
  )
}
