// packages/lib/src/data-connectors/relationship-pass.ts
// Relationship two-pass (04 §3). After all streams sync, resolve each item's
// pendingRelations DEF-KEYED: (dataConnectorId, targetDef, targetExternalId) → the
// target item's entityInstanceId → write the real RELATIONSHIP FieldValue (the
// inverse edge syncs automatically). Build-order independent (no frozen mapping
// pointer). Unresolved targets (not yet synced) stay pending and resolve on a later
// run; each unresolved edge increments relationshipWarnings.
//
// IDEMPOTENT (v10 relationship-pass-idempotency): the sink re-queues every non-clear
// edge on every run — `linkedRelations` records WHICH field carries an edge, never
// WHAT it points at — so without a guard this pass rewrote the connector's entire edge
// set every 15 minutes, DELETE+INSERTing identical `FieldValue` rows and firing a full
// `entity:field:updated` fan-out (timeline entry, activity touch, record rules) for
// each. The fix suppresses the WRITE, not the event: one bulk pre-read of the current
// targets, and an edge that already points where it should is left alone. A genuine
// edge change still fires everything it fires today — deliberately NOT `skipEvents`,
// which would take record rules and field triggers down with it.

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '../resources/resource-id'
import { buildWriteKeyToFieldId } from './field-id-resolver'
import {
  findItemByDef,
  listItemsWithPendingRelations,
  type PendingRelation,
  readRelationshipTargets,
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
  const { currentTargets, concreteFieldIds } = await readCurrentEdges(ctx, items)

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
          await ctx.crud.update(parentRecordId, { [rel.fieldKey]: null }, undefined, {})
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

      // IDEMPOTENCY GUARD: the edge already points at the resolved target, so writing
      // it again would DELETE+INSERT an identical row and fire the whole field-change
      // fan-out for a no-op. Clear the pending entry, keep the `linkedRelations`
      // bookkeeping, and touch nothing.
      //
      // Deliberately does NOT `ctx.touchedDefs.add(...)`: nothing changed on this def
      // from this pass, so it must not force a `records:invalidated` refetch.
      //
      // `currentTargets` is a snapshot taken before any write in this pass. That cannot
      // hide a write from itself: `mergePending` keys pending edges by `fieldKey`, so
      // one item carries at most one pending entry per field.
      const concreteFieldId = concreteFieldIds.get(`${item.id}::${rel.fieldKey}`)
      const currentTarget = concreteFieldId
        ? currentTargets.get(`${item.entityInstanceId}::${concreteFieldId}`)
        : undefined
      if (currentTarget === target.entityInstanceId) {
        if (!linked.has(rel.fieldKey)) {
          linked.add(rel.fieldKey)
          linkedChanged = true
        }
        continue
      }

      const targetRecordId = toRecordId(target.entityDefinitionId, target.entityInstanceId)
      try {
        // Write the RELATIONSHIP value by addressing the parent's relationship
        // field (by its systemAttribute/key) with the target RecordId. The
        // FieldValueService converter accepts a RecordId; the inverse syncs.
        await ctx.crud.update(parentRecordId, { [rel.fieldKey]: targetRecordId }, undefined, {})
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

/**
 * Pre-read for the idempotency guard: resolve every non-clear pending edge's
 * `fieldKey` to a concrete `CustomField.id`, then read all their current targets in
 * one bulk query (chunked inside `readRelationshipTargets`).
 *
 * A `fieldKey` that does not resolve is simply absent from `concreteFieldIds`, which
 * disables the guard for that edge and writes exactly as before. The guard is an
 * optimization — an unresolvable key must never silently drop an edge.
 *
 * CLEAR edges are excluded on purpose: they are terminal (applied once, never
 * retained) and the sink already drops a clear whose field has no live edge. Guarding
 * them would risk re-introducing the fire-once bug.
 */
async function readCurrentEdges(
  ctx: SyncCtx,
  items: Awaited<ReturnType<typeof listItemsWithPendingRelations>>
): Promise<{
  /** `${entityInstanceId}::${fieldId}` → current single target. */
  currentTargets: Map<string, string>
  /** `${itemId}::${fieldKey}` → concrete `CustomField.id`. */
  concreteFieldIds: Map<string, string>
}> {
  // The edge field lives on the item's OWN def; memoize per def so N items on one def
  // resolve the map once. Same map `entity-sink`'s drift detection keys off.
  const writeKeyMaps = new Map<string, Promise<Map<string, string>>>()
  const writeKeyMap = (defId: string): Promise<Map<string, string>> => {
    let m = writeKeyMaps.get(defId)
    if (!m) {
      m = buildWriteKeyToFieldId(ctx.orgId, defId)
      writeKeyMaps.set(defId, m)
    }
    return m
  }

  const concreteFieldIds = new Map<string, string>()
  const pairs: Array<{ entityInstanceId: string; fieldId: string }> = []

  for (const item of items) {
    if (!item.entityInstanceId) continue
    for (const rel of (item.pendingRelations ?? []) as PendingRelation[]) {
      if (rel.targetExternalId === null) continue
      const fieldId = (await writeKeyMap(item.entityDefinitionId)).get(rel.fieldKey)
      if (!fieldId) continue
      concreteFieldIds.set(`${item.id}::${rel.fieldKey}`, fieldId)
      pairs.push({ entityInstanceId: item.entityInstanceId, fieldId })
    }
  }

  const currentTargets = await readRelationshipTargets(ctx.db, ctx.orgId, pairs)
  return { currentTargets, concreteFieldIds }
}
