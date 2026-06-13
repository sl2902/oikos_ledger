import { AccountsSidebar } from "@/components/accounts/AccountsSidebar"
import { TransactionsPanel } from "@/components/transactions/TransactionsPanel"

export default function DashboardPage() {
  return (
    <div className="flex h-full">
      <AccountsSidebar />
      <TransactionsPanel />
    </div>
  )
}
