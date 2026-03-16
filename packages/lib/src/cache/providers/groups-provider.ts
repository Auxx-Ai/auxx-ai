// packages/lib/src/cache/providers/groups-provider.ts

import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import type { CachedGroup } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'
import { entityDefsProvider } from './entity-defs-provider'

/** Computes all entity_group instances for an organization */
export const groupsProvider: CacheProvider<CachedGroup[]> = {
  async compute(orgId, db) {
    const entityDefs = await entityDefsProvider.compute(orgId, db)
    const groupDefId = entityDefs['entity_group']
    if (!groupDefId) return []

    const rows = await db.query.EntityInstance.findMany({
      where: and(
        eq(schema.EntityInstance.entityDefinitionId, groupDefId),
        eq(schema.EntityInstance.organizationId, orgId),
        isNull(schema.EntityInstance.archivedAt)
      ),
    })

    return rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      secondaryDisplayValue: row.secondaryDisplayValue,
      avatarUrl: (row as any).avatarUrl ?? null,
      metadata: (row.metadata ?? {}) as CachedGroup['metadata'],
    }))
  },
}
