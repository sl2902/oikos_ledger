"use client"

import { useState } from "react"
import Link from "next/link"
import { Globe, LayoutDashboard, Lightbulb, TrendingUp } from "lucide-react"

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/insights", label: "Insights", icon: TrendingUp },
  { href: "/recommendations", label: "Recommendations", icon: Lightbulb },
  { href: "/macro", label: "Macro Context", icon: Globe },
]

interface Props {
  user: { name?: string | null; email?: string | null; image?: string | null }
  signOutAction: () => Promise<void>
}

export function NavSidebar({ user, signOutAction }: Props) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <aside
      className={`flex shrink-0 flex-col border-r bg-card transition-all duration-200 ${
        isExpanded ? "w-60" : "w-14"
      }`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      <div
        className={`flex items-center border-b ${
          isExpanded ? "p-5" : "justify-center py-5"
        }`}
      >
        {isExpanded ? (
          <span className="text-lg font-bold tracking-tight">Oikos Ledger</span>
        ) : (
          <span className="text-lg font-bold">₹</span>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2 py-3">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center rounded-md py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
              isExpanded ? "gap-3 px-3" : "justify-center px-0"
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {isExpanded && <span className="truncate">{item.label}</span>}
          </Link>
        ))}
      </nav>

      {isExpanded ? (
        <div className="space-y-3 border-t p-4">
          <div className="flex items-center gap-3">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={user.name ?? ""}
                className="h-8 w-8 rounded-full"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {user.name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : (
        <div className="flex justify-center border-t py-4">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt={user.name ?? ""}
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {user.name?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
