// packages/lib/src/cache/providers/entity-def-slugs-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'

/** Computes apiSlug → entityDefId map for an organization */
export const entityDefSlugsProvider: CacheProvider<Record<string, string>> = {
  async compute(orgId, db) {
    const rows = await db
      .select({
        id: schema.EntityDefinition.id,
        apiSlug: schema.EntityDefinition.apiSlug,
      })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, orgId))

    const map: Record<string, string> = {}
    for (const row of rows) {
      if (row.apiSlug) {
        map[row.apiSlug] = row.id
      }
    }
    return map
  },
}
