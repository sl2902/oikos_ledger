"use client"

import { useState } from "react"
import { ChevronDown, Copy, Check } from "lucide-react"
import { InsightsChart } from "./InsightsChart"
import type { ChatTurn } from "./InsightsPanel"

interface Props {
  turn: ChatTurn
  onSuggestionClick?: (hash: string, text: string) => void
}

export function TurnCard({ turn, onSuggestionClick }: Props) {
  const [chartOpen, setChartOpen] = useState(true)
  const [sqlOpen, setSqlOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copySQL() {
    if (!turn.sql) return
    await navigator.clipboard.writeText(turn.sql)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasChart = turn.results &&
    turn.results.length > 0 &&
    turn.chart_type !== "none" &&
    turn.chart_type !== "table"

  const hasTable = turn.results &&
    turn.results.length > 0 &&
    turn.chart_type === "table"

  if (turn.type === "suggestions" && turn.suggestions) {
    return (
      <div className="flex flex-col gap-3 items-start">
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm
                        bg-muted px-4 py-2.5 text-sm leading-relaxed">
          {turn.content}
        </div>
        <div className="flex flex-col gap-2 w-full max-w-md">
          {turn.suggestions.map((s) => (
            <button
              key={s.query_hash}
              onClick={() => onSuggestionClick?.(s.query_hash, s.query_text)}
              className="text-left rounded-lg border border-border
                         bg-background px-4 py-2.5 text-sm
                         hover:border-primary hover:text-primary
                         transition-colors"
            >
              {s.query_text}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-3
      ${turn.role === "user" ? "items-end" : "items-start"}`}>

      {/* Message bubble — omit entirely if content is empty */}
      {(turn.content || (!turn.sql && !turn.results?.length)) && (
        <div className={`max-w-[80%] rounded-2xl px-4 py-2.5
          text-sm leading-relaxed
          ${turn.role === "user"
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted rounded-bl-sm"
          }`}>
          {turn.content}
          {turn.cached && (
            <span className="ml-2 inline-flex items-center gap-1
                             rounded-full bg-green-100 px-1.5 py-0.5
                             text-[10px] font-medium text-green-700
                             dark:bg-green-900/30 dark:text-green-400">
              ⚡ cached
            </span>
          )}
        </div>
      )}

      {/* Chart — open by default */}
      {turn.role === "assistant" && hasChart && (
        <div className="w-full rounded-lg border">
          <button
            onClick={() => setChartOpen(prev => !prev)}
            className="flex w-full items-center justify-between
                       px-4 py-3 hover:bg-muted/50 transition-colors
                       rounded-t-lg"
          >
            <p className="text-xs font-medium text-muted-foreground">
              📊 {turn.intent_label}
            </p>
            <ChevronDown
              className={`h-3.5 w-3.5 text-muted-foreground
                transition-transform duration-200
                ${chartOpen ? "" : "-rotate-90"}`}
            />
          </button>
          {chartOpen && (
            <div className="px-4 pb-4">
              <InsightsChart
                chartType={turn.chart_type ?? "table"}
                data={turn.results!}
              />
            </div>
          )}
        </div>
      )}

      {/* Table — open by default */}
      {turn.role === "assistant" && hasTable && (
        <div className="w-full rounded-lg border">
          <button
            onClick={() => setChartOpen(prev => !prev)}
            className="flex w-full items-center justify-between
                       px-4 py-3 hover:bg-muted/50 transition-colors
                       rounded-t-lg"
          >
            <p className="text-xs font-medium text-muted-foreground">
              📋 {turn.intent_label ?? "Results"}
              {" · "}{turn.row_count} rows
            </p>
            <ChevronDown
              className={`h-3.5 w-3.5 text-muted-foreground
                transition-transform duration-200
                ${chartOpen ? "" : "-rotate-90"}`}
            />
          </button>
          {chartOpen && (
            <div className="px-4 pb-4">
              <InsightsChart
                chartType="table"
                data={turn.results!}
              />
            </div>
          )}
        </div>
      )}

      {/* SQL — collapsed by default */}
      {turn.role === "assistant" && turn.sql && (
        <div className="w-full rounded-lg border bg-slate-950">
          <button
            onClick={() => setSqlOpen(prev => !prev)}
            className="flex w-full items-center justify-between
                       px-4 py-3 hover:bg-slate-900 transition-colors
                       rounded-t-lg"
          >
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-slate-400">
                🗄️ Query executed
              </p>
              <p className="text-xs text-slate-500">
                {turn.intent_description} · {turn.row_count} rows
              </p>
            </div>
            <ChevronDown
              className={`h-3.5 w-3.5 text-slate-500
                transition-transform duration-200
                ${sqlOpen ? "" : "-rotate-90"}`}
            />
          </button>
          {sqlOpen && (
            <div className="px-4 pb-4">
              <div className="flex justify-end mb-1">
                <button
                  onClick={copySQL}
                  className="flex items-center gap-1 text-xs
                             text-slate-400 hover:text-slate-200
                             transition-colors"
                >
                  {copied
                    ? <Check className="h-3 w-3" />
                    : <Copy className="h-3 w-3" />
                  }
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <pre style={{
                  fontSize: "11px",
                  color: "#4ade80",
                  lineHeight: "1.6",
                  whiteSpace: "pre",
                  margin: 0,
                }}>
                  {turn.sql}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
