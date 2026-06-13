import { eq } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { users } from "@/lib/db/schema"
import type { NewUser } from "@/types"

export async function getUserByEmail(email: string) {
  return db.query.users.findFirst({ where: eq(users.email, email) })
}

export async function createUser(data: NewUser) {
  const [user] = await db.insert(users).values(data).returning()
  return user
}

export async function getUserById(id: string) {
  return db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}
