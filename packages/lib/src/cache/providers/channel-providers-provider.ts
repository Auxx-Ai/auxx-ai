// packages/lib/src/cache/providers/channel-providers-provider.ts

import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'

/** Computes channelId → provider type map for an organization */
export const channelProvidersProvider: CacheProvider<Record<string, string>> = {
  async compute(orgId, db) {
    const channels = await db
      .select({
        id: schema.Integration.id,
        provider: schema.Integration.provider,
      })
      .from(schema.Integration)
      .where(
        and(eq(schema.Integration.organizationId, orgId), isNull(schema.Integration.deletedAt))
      )

    const map: Record<string, string> = {}
    for (const i of channels) {
      map[i.id] = i.provider
    }
    return map
  },
}
