// packages/lib/src/cache/providers/restricted-instance-ids-provider.ts

import { schema } from '@auxx/database'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { INSTANCE_ACCESS_KEYS } from '../../permissions/capabilities/instance-access'
import type { CacheProvider } from '../org-cache-provider'

/**
 * The org-wide set of `entityInstanceId`s that carry at least one
 * **instance-level** `ResourceAccess` row (`entityInstanceId IS NOT NULL`) for
 * an instance-access resource (datasets etc.), for ANY grantee (§1.3).
 *
 * This is the "does this instance have an explicit row?" signal the resolver
 * uses (mirrors {@link import('./restricted-entity-def-ids-provider').restrictedEntityDefIdsProvider}
 * at the instance level): an instance NOT in this set has no explicit grant and
 * falls back to its area's base L2 level (for `baselineAtCreate: false`
 * resources). Only rows keyed by an instance-access resource id count — generic
 * mail-share instance rows (`contact:<id>` etc.) are excluded by the `IN (...)`
 * filter, so they never enter the capability path.
 *
 * Invalidated by the `resource-access.instance.changed` cache event.
 */
export const restrictedInstanceIdsProvider: CacheProvider<string[]> = {
  async compute(orgId, db) {
    const rows = await db
      .selectDistinct({ entityInstanceId: schema.ResourceAccess.entityInstanceId })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, orgId),
          inArray(schema.ResourceAccess.entityDefinitionId, INSTANCE_ACCESS_KEYS),
          isNotNull(schema.ResourceAccess.entityInstanceId)
        )
      )

    return rows.map((r) => r.entityInstanceId).filter((id): id is string => id !== null)
  },
}
