import { auth } from "@/auth"
import { getUserById } from "@/lib/db/queries/users"
import { InsightsPanel } from "@/components/insights/InsightsPanel"

export default async function InsightsPage() {
  const session = await auth()
  let firstName: string | undefined
  if (session?.user?.id) {
    const user = await getUserById(session.user.id)
    firstName = user?.first_name ?? undefined
  }
  return <InsightsPanel firstName={firstName} />
}
