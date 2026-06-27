import { auth } from "@/auth"
import { getUserById } from "@/lib/db/queries/users"
import { RecommendationsPanel } from "@/components/recommendations/RecommendationsPanel"

export default async function RecommendationsPage() {
  const session = await auth()
  let firstName: string | undefined
  if (session?.user?.id) {
    const user = await getUserById(session.user.id)
    firstName = user?.first_name ?? undefined
  }
  return (
    <div className="flex h-full w-full overflow-hidden">
      <RecommendationsPanel firstName={firstName} />
    </div>
  )
}
