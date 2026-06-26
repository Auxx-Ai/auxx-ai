// packages/lib/src/data-connectors/relationship-pass.ts
// Relationship two-pass (04 §3). After all streams sync, resolve each item's
// pendingRelations DEF-KEYED: (dataConnectorId, targetDef, targetExternalId) → the
// target item's entityInstanceId → write the real RELATIONSHIP FieldValue (the
// inverse edge syncs automatically). Build-order independent (no frozen mapping
// pointer). Unresolved targets (not yet synced) stay pending and resolve on a later
// run; each unresolved edge increments relationshipWarnings.

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '../resources/resource-id'
import {
  findItemByDef,
  listItemsWithPendingRelations,
  type PendingRelation,
  setItemRelationState,
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
    const linked = new Set(item.linkedRelations ?? [])
    const stillPending: PendingRelation[] = []
    let linkedChanged = false

    const parentRecordId = toRecordId(item.entityDefinitionId, item.entityInstanceId)

    for (const rel of pending) {
      // CLEAR (FK went empty) — null the relationship field. Terminal: applied
      // once and never retained (no findItem, no deferral). The sink already
      // dropped clears whose field had no live edge, so a clear that reaches here
      // is one we previously set.
      if (rel.targetExternalId === null) {
        try {
          await ctx.crud.update(parentRecordId, { [rel.fieldKey]: null }, undefined, {
            skipSnapshotInvalidation: true,
          })
          ctx.touchedDefs.add(item.entityDefinitionId)
          if (linked.delete(rel.fieldKey)) linkedChanged = true
        } catch (error) {
          stillPending.push(rel)
          ctx.counters.relationshipWarnings += 1
          logger.warn('relationship clear failed — keeping pending', {
            itemId: item.id,
            fieldKey: rel.fieldKey,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        continue
      }

      // DEF-KEYED resolution (relationship-linking v3 §9.6 step 3): find the target
      // by (connector, def, externalId) — whichever mapping wrote it — so build
      // order stops mattering. The target def rides on the pending edge itself.
      const target = rel.targetDef
        ? await findItemByDef(ctx.db, ctx.connector.id, rel.targetDef, rel.targetExternalId)
        : null
      if (!target?.entityInstanceId) {
        // Target not synced yet — defer to a later run.
        stillPending.push(rel)
        ctx.counters.relationshipWarnings += 1
        continue
      }

      const targetRecordId = toRecordId(target.entityDefinitionId, target.entityInstanceId)
      try {
        // Write the RELATIONSHIP value by addressing the parent's relationship
        // field (by its systemAttribute/key) with the target RecordId. The
        // FieldValueService converter accepts a RecordId; the inverse syncs.
        await ctx.crud.update(parentRecordId, { [rel.fieldKey]: targetRecordId }, undefined, {
          skipSnapshotInvalidation: true,
        })
        ctx.touchedDefs.add(item.entityDefinitionId)
        if (!linked.has(rel.fieldKey)) {
          linked.add(rel.fieldKey)
          linkedChanged = true
        }
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

    if (stillPending.length !== pending.length || linkedChanged) {
      await setItemRelationState(ctx.db, item.id, {
        pendingRelations: stillPending,
        linkedRelations: [...linked],
      })
    }
  }
}
