// apps/web/src/server/auth/set-default-organization.ts

import { type Database, schema } from '@auxx/database'
import { getUserCache } from '@auxx/lib/cache'
import { eq } from 'drizzle-orm'

/**
 * Sets a user's default organization and busts their user cache.
 *
 * `customSession` (`auth/server.ts`) derives `defaultOrganizationId` from the cached `userProfile`.
 * Because better-auth's 5-minute session cookie cache holds the previous value, simply writing the
 * DB row isn't enough — the next `getSession` would re-serve the stale org until the cookie expires.
 * Flushing the user cache here forces `userProfile` to recompute from the DB on the next session
 * read, which `customSession` then treats as authoritative. Use this at every default-org write
 * site so session/identity stays consistent immediately after an org switch.
 */
export async function setUserDefaultOrganization(
  db: Database,
  userId: string,
  organizationId: string
): Promise<void> {
  await db
    .update(schema.User)
    .set({ defaultOrganizationId: organizationId, updatedAt: new Date() })
    .where(eq(schema.User.id, userId))
  await getUserCache().invalidateUser(userId)
}
