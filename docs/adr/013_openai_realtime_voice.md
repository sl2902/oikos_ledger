# ADR 013 — Voice Interface: OpenAI Realtime API over Alternatives

**Date:** 2026-06-18
**Status:** Accepted

---

## Context

Oikos Ledger includes a voice interface on the Insights page. Users can query their financial data by speaking. A voice pipeline was needed that supports speech-to-text, conversational response, and function calling (to trigger database queries mid-conversation).

---

## Options Considered

### Browser Web Speech API + text pipeline

Use the browser's native `webkitSpeechRecognition` to transcribe user speech, then pipe the transcript through the existing text query pipeline, and use browser TTS (`speechSynthesis`) for responses.

**Rejected because:**
- `webkitSpeechRecognition` is Chrome-only and not available in Safari on iOS
- Browser TTS voices are robotic and inconsistent across platforms
- Requires explicit push-to-talk; no VAD (voice activity detection)
- Latency is high: transcription → HTTP request → synthesis → playback is three sequential round trips
- No conversation state — each utterance is independent
- Cannot do function calling mid-sentence (user says "can you plot that?" while the model is speaking)

### Whisper (OpenAI) + GPT-4o + OpenAI TTS

A server-side pipeline: Whisper transcribes audio → GPT-4o generates a response (with function calling) → OpenAI TTS synthesises speech.

**Rejected because:**
- Three separate API calls per turn adds significant latency (~2–4s perceived)
- Requires server-side audio streaming infrastructure (buffering, chunking, routing)
- No barge-in — the model finishes speaking before the user can interrupt
- Building VAD client-side adds complexity

### OpenAI Realtime API (`gpt-realtime-2`)

The Realtime API is a single persistent WebSocket session that handles ASR, LLM inference, function calling, and TTS natively. Key properties:

- **Sub-second latency** — audio in, audio out in a single session with no multi-hop round trips
- **Server VAD** — model detects speech start/end automatically; `interrupt_response: true` cancels ongoing response when user speaks
- **Native function calling** — `query_database` and `end_conversation` tools defined in `session.update`; the model calls them mid-conversation naturally
- **Conversation state** — full context maintained in the session across multiple turns
- **Ephemeral keys** — server issues a short-lived key for the browser WebSocket connection; the full API key is never exposed client-side

**Selected.**

---

## Decision

OpenAI Realtime API (`gpt-realtime-2`) via WebSocket is the voice interface runtime.

---

## Architecture

```
Browser mic → AudioWorklet (PCM 16kHz) → WebSocket → OpenAI Realtime API
OpenAI → audio delta (PCM 24kHz) → AudioBufferSourceNode → GainNode → speakers

Tools in session:
  query_database(question) → handleQuery() → POST /api/insights/query → tool result
  end_conversation()       → farewell flow → timed disconnect
```

**Barge-in implementation:**
- `interrupt_response: true` in `turn_detection` — server auto-cancels response on VAD start
- `conversation.item.truncate` sent with `audio_end_ms` = samples actually played
- GainNode mute (gain = 0) on `speech_started` silences buffered chunks
- `mutedItemId` ref skips in-flight audio deltas for the truncated item
- `response.created` restores gain for the new response

**Voice vs text differences:**
- `is_voice: true` in `POST /api/insights/query` suppresses text streaming and similarity suggestions
- Data cards (SQL + chart/table) rendered in UI; text bubble suppressed (model speaks the summary)
- `audioEnabledRef` (`useRef`) used instead of `audioEnabled` state inside WebSocket closure to avoid stale closure bug

---

## Consequences

- Real-time conversational voice with sub-second response latency
- Barge-in works — user can interrupt the model mid-sentence
- Function calling integrates naturally with the existing `handleQuery` pipeline
- Ephemeral key pattern keeps full API key server-side
- Session cost: billed per audio minute (input + output) at Realtime API rates
- WebSocket connection must be managed carefully — reconnection, cleanup on unmount, disconnect on farewell
- `NEXT_PUBLIC_VOICE_ENABLED=true` required to show voice button in UI
