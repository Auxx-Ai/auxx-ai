// packages/lib/src/cache/providers/integration-providers-provider.ts

import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'

/** Computes integrationId → provider type map for an organization */
export const integrationProvidersProvider: CacheProvider<Record<string, string>> = {
  async compute(orgId, db) {
    const integrations = await db
      .select({
        id: schema.Integration.id,
        provider: schema.Integration.provider,
      })
      .from(schema.Integration)
      .where(
        and(eq(schema.Integration.organizationId, orgId), isNull(schema.Integration.deletedAt))
      )

    const map: Record<string, string> = {}
    for (const i of integrations) {
      map[i.id] = i.provider
    }
    return map
  },
}
