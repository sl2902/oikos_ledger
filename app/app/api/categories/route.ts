import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { categories } from "@/lib/db/schema"
import { asc, isNotNull, isNull } from "drizzle-orm"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const topLevel = await db
    .select({
      id: categories.id,
      name: categories.name,
    })
    .from(categories)
    .where(isNull(categories.parent_id))
    .orderBy(asc(categories.name))

  const subs = await db
    .select({
      id: categories.id,
      name: categories.name,
      parent_id: categories.parent_id,
    })
    .from(categories)
    .where(isNotNull(categories.parent_id))
    .orderBy(asc(categories.name))

  return Response.json({
    categories: topLevel,
    subcategories: subs,
  })
}
