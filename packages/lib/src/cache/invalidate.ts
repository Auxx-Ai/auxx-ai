// packages/lib/src/cache/invalidate.ts

import type { CacheEvent } from './invalidation-graph'
import { INVALIDATION_GRAPH, isMixedMapping, isOrgOnlyMapping } from './invalidation-graph'
import { getAppCache, getOrgCache, getUserCache } from './singletons'

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
  context: { orgId: string; userId?: string; broadcastUserKeys?: boolean }
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
    if ('user' in mapping && mapping.user && mapping.user.length > 0) {
      if (context.broadcastUserKeys) {
        // Invalidate for ALL org members
        promises.push(getUserCache().invalidateOrgUsersForKeys(context.orgId, mapping.user))
      } else if (context.userId) {
        // Invalidate for a single user
        promises.push(
          getUserCache().invalidateAndRecompute(context.userId, mapping.user, context.orgId)
        )
      }
    }

    await Promise.all(promises)
  }
}

/** Flush everything for an org (e.g. org deletion) */
export async function flushOrganization(orgId: string): Promise<void> {
  await getOrgCache().flush(orgId)
}

/** Invalidate and recompute cached plans (call after plan admin mutations) */
export async function invalidatePlans(): Promise<void> {
  await getAppCache().invalidateAndRecompute(['plans', 'planMap'])
}

/** Invalidate and recompute cached workflow templates (call after template admin mutations) */
export async function invalidateWorkflowTemplates(): Promise<void> {
  await getAppCache().invalidateAndRecompute(['workflowTemplates'])
}

/** Invalidate and recompute global app catalog caches (slug map + published apps) */
export async function invalidateAppCatalog(): Promise<void> {
  await getAppCache().invalidateAndRecompute(['appSlugMap', 'publishedApps'])
}

/** Invalidate only the slug map (for mutations that don't affect published state) */
export async function invalidateAppSlugMap(): Promise<void> {
  await getAppCache().invalidateAndRecompute(['appSlugMap'])
}
