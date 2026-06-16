"use client"

import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts"

interface Props {
  chartType: string
  data: Record<string, unknown>[]
}

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#3b82f6", "#ef4444", "#14b8a6",
]

function formatAmount(value: unknown) {
  const num = Number(value)
  if (num >= 10000000) return `₹${(num / 10000000).toFixed(1)}Cr`
  if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L`
  if (num >= 1000) return `₹${(num / 1000).toFixed(1)}K`
  return `₹${num.toFixed(0)}`
}

export function InsightsChart({ chartType, data }: Props) {
  if (!data.length) return null

  // Normalize data — convert numeric strings to numbers
  const normalizedData = data.map(row => {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      result[key] = typeof value === "string" && !isNaN(Number(value))
        ? Number(value)
        : value
    }
    return result
  })

  if (chartType === "line") {
    const xKey = data[0] && "day" in data[0]
      ? "day"
      : data[0] && "week" in data[0]
      ? "week"
      : "month"
    const allValues = normalizedData.flatMap(d => [
      Number(d.debits ?? 0),
      Number(d.credits ?? 0),
    ]).filter(v => v > 0)

    const p95 = allValues.sort((a, b) => a - b)[
      Math.floor(allValues.length * 0.95)
    ] ?? 0

    const yDomain: [number, number] = [0, p95 * 1.1]

    return (
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={normalizedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={formatAmount} tick={{ fontSize: 11 }} domain={yDomain} />
          <Tooltip formatter={(v) => formatAmount(v)} />
          <Legend />
          <Line type="monotone" dataKey="debits" stroke="#ef4444" name="Debits" dot={false} />
          <Line type="monotone" dataKey="credits" stroke="#10b981" name="Credits" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (chartType === "bar") {
    const dataKey = data[0]
      ? Object.keys(data[0]).find(k => k === "total" || k === "amount") ?? "total"
      : "total"
    const nameKey = data[0]
      ? Object.keys(data[0]).find(k => k === "category" || k === "normalized_merchant") ?? "category"
      : "category"

    return (
      <div style={{ width: "100%", height: Math.max(280, normalizedData.length * 50) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={normalizedData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tickFormatter={formatAmount} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey={nameKey} tick={{ fontSize: 10 }} width={180} />
            <Tooltip formatter={(v) => formatAmount(v)} />
            <Bar dataKey={dataKey} fill="#6366f1" radius={[0, 4, 4, 0]}>
              {normalizedData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (chartType === "horizontal_bar") {
    const dataKey = data[0]
      ? Object.keys(data[0]).find(k => k === "total" || k === "amount") ?? "total"
      : "total"
    const nameKey = data[0]
      ? Object.keys(data[0]).find(k => k === "category" || k === "normalized_merchant") ?? "category"
      : "category"

    return (
      <div style={{ width: "100%", height: Math.max(280, normalizedData.length * 50) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={normalizedData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tickFormatter={formatAmount} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey={nameKey} tick={{ fontSize: 10 }} width={180} />
            <Tooltip formatter={(v) => formatAmount(v)} />
            <Bar dataKey={dataKey} fill="#6366f1" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (chartType === "comparison_bar") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={normalizedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={formatAmount} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => formatAmount(v)} />
          <Legend />
          <Bar dataKey="debits" fill="#ef4444" name="Debits" radius={[4, 4, 0, 0]} />
          <Bar dataKey="credits" fill="#10b981" name="Credits" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={normalizedData}
            dataKey="total"
            nameKey="category"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            // label={({ category, percentage }: { category: string; percentage: number }) =>
            //   `${category} ${(percentage).toFixed(1)}%`
            // }
          >
            
            {normalizedData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value, name, entry) => [
            `${formatAmount(value)} (${Number(entry.payload.percentage ?? 0).toFixed(1)}%)`,
            name,
          ]}
        />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  // Table fallback for custom queries
  const columns = Object.keys(data[0])
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            {columns.map((col) => (
              <th
                key={col}
                className="py-2 pr-4 text-left font-medium text-muted-foreground capitalize"
              >
                {col.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 20).map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              {columns.map((col) => (
                <td key={col} className="py-2 pr-4">
                  {String(row[col] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 20 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing 20 of {data.length} rows
        </p>
      )}
    </div>
  )
}
