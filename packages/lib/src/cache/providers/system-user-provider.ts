// packages/lib/src/cache/providers/system-user-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'

/** Computes the system user ID for an organization */
export const systemUserProvider: CacheProvider<string> = {
  async compute(orgId, db) {
    const [org] = await db
      .select({ systemUserId: schema.Organization.systemUserId })
      .from(schema.Organization)
      .where(eq(schema.Organization.id, orgId))
      .limit(1)

    if (!org?.systemUserId) {
      throw new Error(`No system user found for organization ${orgId}`)
    }

    return org.systemUserId
  },
}
