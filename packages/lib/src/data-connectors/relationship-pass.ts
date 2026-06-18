// packages/lib/src/data-connectors/relationship-pass.ts
// Relationship two-pass (04 §3). After all streams sync, resolve each item's
// pendingRelations: (dataConnectorId, targetMappingId, targetExternalId) → the
// target item's entityInstanceId → write the real RELATIONSHIP FieldValue (the
// inverse edge syncs automatically). Unresolved targets (not yet synced) stay
// pending and resolve on a later run; each unresolved edge increments
// relationshipWarnings.

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '../resources/resource-id'
import {
  findItem,
  listItemsWithPendingRelations,
  type PendingRelation,
  setItemPendingRelations,
} from './service'
import type { SyncCtx } from './sinks/types'

const logger = createScopedLogger('data-connector-relationship-pass')

/**
 * Resolve all pending relations for the connector. For each item with pending
 * edges, look up the target item and write the relationship; keep unresolved
 * edges pending for a later run.
 */
export async function resolveRelationships(ctx: SyncCtx): Promise<void> {
  const items = await listItemsWithPendingRelations(ctx.db, ctx.connector.id)

  for (const item of items) {
    if (!item.entityInstanceId) continue
    const pending = (item.pendingRelations ?? []) as PendingRelation[]
    const stillPending: PendingRelation[] = []

    for (const rel of pending) {
      const target = await findItem(
        ctx.db,
        ctx.connector.id,
        rel.targetMappingId,
        rel.targetExternalId
      )
      if (!target?.entityInstanceId) {
        // Target not synced yet — defer to a later run.
        stillPending.push(rel)
        ctx.counters.relationshipWarnings += 1
        continue
      }

      const parentRecordId = toRecordId(item.entityDefinitionId, item.entityInstanceId)
      const targetRecordId = toRecordId(target.entityDefinitionId, target.entityInstanceId)
      try {
        // Write the RELATIONSHIP value by addressing the parent's relationship
        // field (by its systemAttribute/key) with the target RecordId. The
        // FieldValueService converter accepts a RecordId; the inverse syncs.
        await ctx.crud.update(parentRecordId, { [rel.fieldKey]: targetRecordId }, undefined, {
          skipSnapshotInvalidation: true,
        })
        ctx.touchedDefs.add(item.entityDefinitionId)
      } catch (error) {
        stillPending.push(rel)
        ctx.counters.relationshipWarnings += 1
        logger.warn('relationship write failed — keeping pending', {
          itemId: item.id,
          fieldKey: rel.fieldKey,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (stillPending.length !== pending.length) {
      await setItemPendingRelations(ctx.db, item.id, stillPending)
    }
  }
}
