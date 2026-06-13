import { cn } from "@/lib/utils"

interface BankLogoProps {
  domain: string
  bankName: string
  className?: string
}

export function BankLogo({ domain, bankName, className }: BankLogoProps) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt={`${bankName} logo`}
      className={cn("h-6 w-6 rounded bg-white p-0.5", className)}
      onError={(e) => {
        e.currentTarget.src = "/fallback-bank-icon.svg"
      }}
    />
  )
}
