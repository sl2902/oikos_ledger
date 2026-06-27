"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BarChart2, Globe, LayoutDashboard, Lightbulb, Sparkles, LogOut } from "lucide-react"

const NAV_ITEMS: { href: string; label: string; icon: React.ElementType; disabled?: boolean }[] = [
  { href: "/", label: "Transactions", icon: LayoutDashboard },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/recommendations", label: "Recommendations", icon: Sparkles },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/macro", label: "Macro Context (Coming Soon)", icon: Globe, disabled: true },
]

interface Props {
  user: { name?: string | null; email?: string | null; image?: string | null }
  signOutAction: () => Promise<void>
}

function NavTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <div
      className="relative flex justify-center"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50
          whitespace-nowrap rounded-md bg-popover border border-border
          px-2.5 py-1 text-xs font-medium text-popover-foreground shadow-md
          animate-in fade-in-0 slide-in-from-left-1 duration-150">
          {label}
        </div>
      )}
    </div>
  )
}

export function NavSidebar({ user, signOutAction }: Props) {
  const pathname = usePathname()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    if (popoverOpen) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [popoverOpen])

  const initials = user.name?.[0]?.toUpperCase() ?? user.email?.[0]?.toUpperCase() ?? "?"

  return (
    <aside className="flex w-14 shrink-0 flex-col border-r bg-card overflow-visible">
      {/* Logo */}
      <div className="flex h-14 items-center justify-center border-b shrink-0">
        <svg
          width="28"
          height="28"
          viewBox="0 0 28 28"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Oikos Ledger"
        >
          {/* Roof */}
          <path
            d="M4 13L14 4L24 13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* House walls */}
          <path
            d="M6 12V23H22V12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Ledger line — horizontal balance line through middle of house */}
          <line
            x1="9"
            y1="17"
            x2="19"
            y2="17"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Second ledger line — suggests double-entry bookkeeping */}
          <line
            x1="9"
            y1="20"
            x2="16"
            y2="20"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.5"
          />
        </svg>
      </div>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col items-center gap-1 px-2 py-3">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href))
          if (item.disabled) {
            return (
              <NavTooltip key={item.href} label={item.label}>
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-md
                    text-muted-foreground/40 cursor-not-allowed"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                </div>
              </NavTooltip>
            )
          }
          return (
            <NavTooltip key={item.href} label={item.label}>
              <Link
                href={item.href}
                className={`flex h-9 w-9 items-center justify-center rounded-md
                  transition-colors duration-150
                  ${isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
              </Link>
            </NavTooltip>
          )
        })}
      </nav>

      {/* Avatar + popover */}
      <div className="flex justify-center border-t py-3 relative" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setPopoverOpen(prev => !prev)}
          className="relative flex h-8 w-8 items-center justify-center
            rounded-full ring-2 ring-transparent hover:ring-border
            transition-all duration-150 focus:outline-none"
          title="Account"
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt={user.name ?? ""}
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center
              rounded-full bg-muted text-xs font-medium">
              {initials}
            </div>
          )}
        </button>

        {/* Popover */}
        {popoverOpen && (
          <div className="absolute bottom-0 left-full ml-2 z-50
            w-56 rounded-xl border border-border bg-popover shadow-lg
            animate-in fade-in-0 slide-in-from-left-1 duration-150">
            {/* User info */}
            <div className="px-4 py-3 border-b border-border">
              {user.name && (
                <p className="text-sm font-medium text-popover-foreground truncate">
                  {user.name}
                </p>
              )}
              {user.email && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {user.email}
                </p>
              )}
            </div>
            {/* Sign out */}
            <div className="p-1">
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2
                    text-sm text-muted-foreground
                    hover:bg-accent hover:text-foreground
                    transition-colors duration-150"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
