// packages/lib/src/data-connectors/child-sets.ts
import { schema } from '@auxx/database'
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'
import type { ChildSet } from './map-record'
import { effectiveOrphanBehavior } from './reconciliation'
import { findItem } from './service'
import { entitySink } from './sinks/entity-sink'
import type { SyncCtx } from './sinks/types'

/**
 * Retire the children a parent's payload no longer carries. Run after the record's writes:
 * stamps each present child with its parent, then applies the mapping's orphan behavior to
 * the parent's other live children. Works on every lane (backfill, delta, webhook) because
 * the parent payload is complete for its own children, unlike a crawl's view of the whole set.
 */
export async function replaceChildSets(ctx: SyncCtx, childSets: ChildSet[]): Promise<void> {
  const staleRoots = new Map<string, Promise<boolean>>()
  for (const set of childSets) {
    const rootKey = `${set.root.mappingId}:${set.root.externalId}`
    if (!staleRoots.has(rootKey)) staleRoots.set(rootKey, isStaleRoot(ctx, set.root))
    // The sink dropped this payload's root as older than what it holds; so is its child list.
    if (await staleRoots.get(rootKey)) continue

    const T = schema.DataConnectorItem
    const scope = and(eq(T.dataConnectorId, ctx.connector.id), eq(T.mappingId, set.mapping.row.id))
    if (set.externalIds.length > 0) {
      await ctx.db
        .update(T)
        .set({ parentExternalId: set.parentExternalId })
        .where(
          and(
            scope,
            inArray(T.externalId, set.externalIds),
            sql`${T.parentExternalId} is distinct from ${set.parentExternalId}`
          )
        )
    }
    const absent = await ctx.db
      .select({
        id: T.id,
        entityInstanceId: T.entityInstanceId,
        entityDefinitionId: T.entityDefinitionId,
        mintedInstance: T.mintedInstance,
        removedUpstreamAt: T.removedUpstreamAt,
      })
      .from(T)
      .where(
        and(
          scope,
          eq(T.parentExternalId, set.parentExternalId),
          set.externalIds.length > 0 ? notInArray(T.externalId, set.externalIds) : undefined,
          isNull(T.archivedAt),
          isNotNull(T.entityInstanceId)
        )
      )
    for (const item of absent) {
      const behavior = effectiveOrphanBehavior(set.mapping.orphanBehavior, item)
      if (behavior === 'mark_deleted' && item.removedUpstreamAt) continue
      await entitySink.archiveRecord(ctx, item, behavior)
    }
  }
}

async function isStaleRoot(ctx: SyncCtx, root: ChildSet['root']): Promise<boolean> {
  if (!root.upstreamUpdatedAt) return false
  const item = await findItem(ctx.db, ctx.connector.id, root.mappingId, root.externalId)
  return !!item?.upstreamUpdatedAt && item.upstreamUpdatedAt > root.upstreamUpdatedAt
}
