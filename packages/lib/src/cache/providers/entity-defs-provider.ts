// packages/lib/src/cache/providers/entity-defs-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'

/** Computes entityType → entityDefId map for an organization */
export const entityDefsProvider: CacheProvider<Record<string, string>> = {
  async compute(orgId, db) {
    const rows = await db
      .select({
        id: schema.EntityDefinition.id,
        entityType: schema.EntityDefinition.entityType,
      })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, orgId))

    const map: Record<string, string> = {}
    for (const row of rows) {
      if (row.entityType) {
        map[row.entityType] = row.id
      }
    }
    return map
  },
}
