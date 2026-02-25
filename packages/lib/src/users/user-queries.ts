// packages/lib/src/users/user-queries.ts

import { database as db, schema } from '@auxx/database'
import type { UserEntity } from '@auxx/database/types'
import { eq } from 'drizzle-orm'

/** Find a user by ID (global, no org scoping) */
export async function getUserById(id: string): Promise<UserEntity | null> {
  const [user] = await db.select().from(schema.User).where(eq(schema.User.id, id)).limit(1)
  return (user as UserEntity) ?? null
}

/** Find a user by email (global, no org scoping) */
export async function getUserByEmail(email: string): Promise<UserEntity | null> {
  const [user] = await db.select().from(schema.User).where(eq(schema.User.email, email)).limit(1)
  return (user as UserEntity) ?? null
}
