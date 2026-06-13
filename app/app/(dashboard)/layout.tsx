import { auth, signOut } from "@/auth"
import { redirect } from "next/navigation"
import { AccountsProvider } from "@/components/accounts/AccountsContext"
import { NavSidebar } from "@/components/nav/NavSidebar"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  async function signOutAction() {
    "use server"
    await signOut({ redirectTo: "/login" })
  }

  return (
    <div className="flex h-screen">
      <NavSidebar user={session.user ?? {}} signOutAction={signOutAction} />
      <main className="flex-1 overflow-hidden">
        <AccountsProvider>{children}</AccountsProvider>
      </main>
    </div>
  )
}
