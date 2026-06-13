const METHOD_COLORS: Record<string, string> = {
  UPI: "bg-purple-100 text-purple-700",
  NEFT: "bg-blue-100 text-blue-700",
  IMPS: "bg-blue-100 text-blue-700",
  RTGS: "bg-blue-100 text-blue-700",
  ATM: "bg-gray-100 text-gray-600",
  POS: "bg-gray-100 text-gray-600",
  "Bill Pay": "bg-yellow-100 text-yellow-700",
  Salary: "bg-emerald-100 text-emerald-700",
  EMI: "bg-red-100 text-red-700",
  Transfer: "bg-gray-100 text-gray-600",
  ACH: "bg-gray-100 text-gray-600",
  Other: "bg-gray-100 text-gray-500",
}

export function MethodBadge({ method }: { method: string }) {
  const colors = METHOD_COLORS[method] ?? "bg-gray-100 text-gray-500"
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${colors}`}
    >
      {method}
    </span>
  )
}
