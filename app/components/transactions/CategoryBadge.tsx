const CATEGORY_COLORS: Record<string, string> = {
  Food: "bg-orange-100 text-orange-700",
  Dining: "bg-orange-100 text-orange-700",
  Groceries: "bg-green-100 text-green-700",
  Transport: "bg-blue-100 text-blue-700",
  Travel: "bg-sky-100 text-sky-700",
  Shopping: "bg-purple-100 text-purple-700",
  Entertainment: "bg-pink-100 text-pink-700",
  Communication: "bg-cyan-100 text-cyan-700",
  Health: "bg-red-100 text-red-700",
  Education: "bg-indigo-100 text-indigo-700",
  Finance: "bg-yellow-100 text-yellow-700",
  Investment: "bg-cyan-100 text-cyan-700",
  Insurance: "bg-teal-100 text-teal-700",
  Housing: "bg-amber-100 text-amber-700",
  Utilities: "bg-yellow-100 text-yellow-700",
  Salary: "bg-emerald-100 text-emerald-700",
  Transfer: "bg-gray-100 text-gray-600",
  Other: "bg-gray-100 text-gray-500",
}

export function CategoryBadge({ category }: { category: string }) {
  const colors = CATEGORY_COLORS[category] ?? "bg-gray-100 text-gray-500"
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${colors}`}
    >
      {category}
    </span>
  )
}
