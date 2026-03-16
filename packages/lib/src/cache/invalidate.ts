// packages/lib/src/cache/invalidate.ts

import { getOrgCache, getUserCache } from './index'
import type { CacheEvent } from './invalidation-graph'
import { INVALIDATION_GRAPH, isMixedMapping, isOrgOnlyMapping } from './invalidation-graph'

/**
 * Declarative cache invalidation helper.
 * Call AFTER the DB transaction commits, never inside it.
 *
 * @example
 * ```ts
 * await db.transaction(async (tx) => {
 *   await tx.update(schema.PlanSubscription).set({ ... })
 * })
 * await onCacheEvent('plan.changed', { orgId })
 * ```
 */
export async function onCacheEvent(
  event: CacheEvent,
  context: { orgId: string; userId?: string }
): Promise<void> {
  const mapping = INVALIDATION_GRAPH[event]
  if (!mapping) return

  if (isOrgOnlyMapping(mapping)) {
    if (mapping.length > 0) {
      await getOrgCache().invalidateAndRecompute(context.orgId, mapping)
    }
  } else if (isMixedMapping(mapping)) {
    const promises: Promise<void>[] = []

    if ('org' in mapping && mapping.org && mapping.org.length > 0) {
      promises.push(getOrgCache().invalidateAndRecompute(context.orgId, mapping.org))
    }
    if ('user' in mapping && mapping.user && mapping.user.length > 0 && context.userId) {
      promises.push(
        getUserCache().invalidateAndRecompute(context.userId, mapping.user, context.orgId)
      )
    }

    await Promise.all(promises)
  }
}

/** Flush everything for an org (e.g. org deletion) */
export async function flushOrganization(orgId: string): Promise<void> {
  await getOrgCache().flush(orgId)
}
