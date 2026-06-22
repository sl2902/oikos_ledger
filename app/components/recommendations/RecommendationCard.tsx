"use client"

const CATEGORY_EMOJI: Record<string, string> = {
  Food: "🍔",
  Shopping: "🛍️",
  Entertainment: "🎬",
  Transport: "🚗",
  Travel: "✈️",
  Utilities: "⚡",
  Health: "💊",
  Finance: "💰",
  Education: "📚",
  Housing: "🏠",
  Other: "📦",
}

interface Props {
  category: string
  baseline_monthly: number
  current_spend: number
  projected_spend: number
  variance: number
  top_merchants: string[]
  day_of_month: number
  days_in_month: number
  is_stale: boolean
  insight: string
  impact: string
  action: string
}

export function RecommendationCard({
  category,
  baseline_monthly,
  current_spend,
  projected_spend,
  variance,
  top_merchants,
  day_of_month,
  days_in_month,
  is_stale,
  insight,
  impact,
  action,
}: Props) {
  const emoji = CATEGORY_EMOJI[category] ?? "📊"
  const overPercent = Math.round((variance / baseline_monthly) * 100)
  // Bar shows actual spend vs baseline (100% = at baseline), capped at 100%
  const progressPercent = Math.min(
    Math.round((current_spend / baseline_monthly) * 100),
    100
  )
  const baselinePercent = 100

  const expectedToDate = (baseline_monthly / days_in_month) * day_of_month
  const pacingRatio = expectedToDate > 0 ? current_spend / expectedToDate : 0

  const barColor =
    projected_spend > baseline_monthly
      ? "bg-red-400"
      : pacingRatio > 1.0
      ? "bg-amber-400"
      : "bg-emerald-400"

  const badgeColor =
    projected_spend > baseline_monthly
      ? "bg-red-50 text-red-600"
      : pacingRatio > 1.0
      ? "bg-amber-50 text-amber-600"
      : "bg-emerald-50 text-emerald-600"

  const trendIcon =
    projected_spend > baseline_monthly ? "📈" : pacingRatio > 1.0 ? "⚠️" : "✅"

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{emoji}</span>
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {category} Insight
          </span>
        </div>
        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor}`}>
          {trendIcon} {overPercent > 0 ? `+${overPercent}% over baseline` : `${Math.abs(overPercent)}% under baseline`}
        </span>
      </div>

      {/* Inline metric highlights */}
      <div className="flex items-center justify-between text-sm">
        <div>
          <span className="text-muted-foreground text-xs">Spent </span>
          <span className="font-semibold text-slate-800">
            ₹{Math.round(current_spend).toLocaleString("en-IN")}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">vs</div>
        <div>
          <span className="text-muted-foreground text-xs">Baseline </span>
          <span className="font-semibold text-slate-800">
            ₹{Math.round(baseline_monthly).toLocaleString("en-IN")}
          </span>
        </div>
        {!is_stale && (
          <div>
            <span className="text-muted-foreground text-xs">Projected </span>
            <span className={`font-semibold ${
              projected_spend > baseline_monthly ? "text-red-500" : "text-emerald-600"
            }`}>
              ₹{Math.round(projected_spend).toLocaleString("en-IN")}
            </span>
          </div>
        )}
      </div>

      {/* Top merchants */}
      {top_merchants && top_merchants.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Top merchants:</span>
          <div className="flex flex-wrap gap-1">
            {top_merchants.map((m) => (
              <span
                key={m}
                className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="relative h-2 rounded-full bg-slate-100">
          <div
            className="absolute top-0 h-full w-0.5 bg-slate-400 z-10"
            style={{ left: `${baselinePercent}%` }}
            title={`Baseline: ₹${Math.round(baseline_monthly).toLocaleString("en-IN")}`}
          />
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Insight → Impact → Action */}
      <div className="space-y-2 text-sm">
        <p className="text-slate-700">{insight}</p>
        <p className="text-slate-500 text-xs">{impact}</p>
        <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
          <p className="text-amber-800 text-xs font-medium">
            👉 {action}
          </p>
        </div>
      </div>
    </div>
  )
}
