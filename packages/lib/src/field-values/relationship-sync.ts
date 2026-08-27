// packages/lib/src/field-values/relationship-sync.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { RelationshipType } from '@auxx/types/custom-field'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { generateKeyBetween, nextKeyAfter } from '@auxx/utils/fractional-indexing'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { FieldValueUpdateEntry } from '../realtime/events'
import { rowToTypedValue } from './field-value-helpers'
import type { FieldValueRow } from './types'

// ============================================================================
// TYPES
// ============================================================================

/** Context required for all sync operations */
export interface RelationshipSyncContext {
  db: Database | Transaction
  organizationId: string
}

/** Pre-extracted inverse field info (caller provides this, not looked up here) */
export interface InverseFieldInfo {
  /** The inverse field's ID */
  inverseFieldId: string
  /** The inverse field's relationship type (determines single vs multi-value) */
  inverseRelationshipType: RelationshipType
  /** The entity definition ID that the inverse field points TO (source entity's type) */
  sourceEntityDefinitionId: string
  /** The entity definition ID of the target entity (for building ResourceId in inserts) */
  targetEntityDefinitionId: string
  /** The source field's ID (for cascade cleanup when inverse is single-value) */
  sourceFieldId: string
}

/** Input for single entity sync operation */
export interface SyncInverseInput {
  /** The entity being updated */
  entityId: string
  /** Previous related entity IDs (captured before update) */
  oldRelatedIds: string[]
  /** New related entity IDs (after update) */
  newRelatedIds: string[]
  /** Pre-extracted inverse field info */
  inverseInfo: InverseFieldInfo
}

/** Result of inverse sync operation */
export interface InverseSyncResult {
  /** Entities whose inverse field had items removed */
  removedFrom: string[]
  /** Entities whose inverse field had items added */
  addedTo: string[]
}

/** Input for bulk sync operation (multiple entities at once) */
export interface BulkRelationshipUpdate {
  entityId: string
  oldRelatedIds: string[]
  newRelatedIds: string[]
}

/** Input for bulk sync */
export interface BulkSyncInput {
  updates: BulkRelationshipUpdate[]
  inverseInfo: InverseFieldInfo
}

// ============================================================================
// ANNOUNCING THE INVERSE WRITE  (decision D-11 / defect B-9)
// ============================================================================

/**
 * One record whose relationship array this module just rewrote, and which
 * therefore owes the rest of the system an announcement.
 *
 * 🛑 **Why this exists at all.** A relationship is stored TWICE — once on the
 * record you edited and once as a mirror on the record at the other end — and
 * until this was added, only the first write was ever published. The mirror was
 * rewritten in raw SQL right here and nobody was told, so:
 *
 *   - every screen holding the parent kept rendering the list it had at load
 *     time (the client's fetch queue never re-requests a key it already holds,
 *     so not even a remount repaired it — only a full page reload);
 *   - record rules that subscribe to a relationship field never fired on the
 *     inverse side at all. Not intermittently. Never.
 *
 * The diff was already being computed — it is the value `syncInverseRelationships`
 * returns — and simply thrown away by every caller. See
 * `plans/events/03-write-context-and-batch-lane-plan.md` §D-11 and the
 * `inverseRelationshipVisibility` row of `resources/crud/door-matrix.ts`.
 */
interface InverseAnnouncement {
  /** Definition of the records named in {@link entityIds}. */
  entityDefinitionId: string
  /** The field on those records whose array changed. */
  fieldId: string
  /** Instance ids whose `fieldId` array changed. */
  entityIds: string[]
  /** `belongs_to`/`has_one` publish a scalar (or `null`); the rest publish the array. */
  single: boolean
}

function isSingleValued(relationshipType: RelationshipType): boolean {
  return relationshipType === 'belongs_to' || relationshipType === 'has_one'
}

/**
 * Re-read each affected record's relationship array and publish it.
 *
 * Three deliberate choices, each of which is a bug if reversed:
 *
 * 1. **No `excludeSocketId`.** Every ordinary publish suppresses the echo to the
 *    tab that made the change, because that tab already knows. Here it does not:
 *    the record being announced is the one at the OTHER end of the link, not the
 *    one the user edited. To the acting tab this is news, and suppressing it
 *    leaves exactly the bug this function exists to fix, for the person most
 *    likely to be looking at it.
 *
 * 2. **Buffered when a write scope is open.** Announcing before `COMMIT` is
 *    worse than silence: the subscriber re-reads on a different connection,
 *    cannot see uncommitted rows, and caches the PRE-write value as fresh.
 *    `recordTxWriteChange` holds the frame until `flushTxWriteScope` replays it
 *    after the transaction lands. (Writing the `changes` bucket is not optional
 *    bookkeeping — the flush iterates `scope.changes` to decide what to replay,
 *    so an entry with no bucket would be buffered and never sent.)
 *
 * 3. **Best-effort.** A realtime hiccup must never fail the write that caused
 *    it; the rows are already durable by the time we get here. Same contract as
 *    every other publish in this package.
 *
 * Records whose list was emptied are published as an empty array rather than
 * skipped — "this list is now empty" is the news, and omitting it leaves the
 * last non-empty answer on screen.
 *
 * Realtime and the write scope are LAZY-imported for the reason `tx-write-flush`
 * documents: this module sits under the field-value write path, and pulling
 * `realtime` into its static graph re-orders module evaluation across a cycle
 * that runs through `@auxx/lib/cache`.
 */
async function announceInverseChanges(
  ctx: RelationshipSyncContext,
  announcements: InverseAnnouncement[]
): Promise<void> {
  const wanted = announcements.filter((a) => a.entityIds.length > 0)
  if (wanted.length === 0) return

  try {
    // The record id and the raw field id are carried alongside the frame rather
    // than re-derived from `entry.key`: `buildFieldValueKey` normalizes a bare
    // field id into a `ResourceFieldId`, so the key is
    // `<def>:<instance>:<def>:<field>` and slicing it back apart yields the
    // qualified ref, not the plain field id the manifest's `outputKey` wants.
    const pending: Array<{
      recordId: RecordId
      fieldId: string
      entry: FieldValueUpdateEntry
    }> = []

    for (const announcement of wanted) {
      const { entityDefinitionId, fieldId, entityIds, single } = announcement

      const rows = await ctx.db
        .select()
        .from(schema.FieldValue)
        .where(
          and(
            inArray(schema.FieldValue.entityId, entityIds),
            eq(schema.FieldValue.fieldId, fieldId),
            eq(schema.FieldValue.organizationId, ctx.organizationId)
          )
        )
        .orderBy(asc(schema.FieldValue.entityId), asc(schema.FieldValue.sortKey))

      // Seed every affected id with an empty list FIRST, so a record whose
      // links were all removed still gets a frame (see the note above).
      const byEntity = new Map<string, TypedFieldValue[]>(entityIds.map((id) => [id, []]))
      for (const row of rows) {
        byEntity
          .get(row.entityId)
          ?.push(rowToTypedValue(row as unknown as FieldValueRow, FieldTypeEnum.RELATIONSHIP))
      }

      for (const [entityId, values] of byEntity) {
        const recordId = toRecordId(entityDefinitionId, entityId)
        pending.push({
          recordId,
          fieldId,
          entry: {
            key: buildFieldValueKey(recordId, fieldId as FieldId),
            value: single ? (values[0] ?? null) : values,
          },
        })
      }
    }

    if (pending.length === 0) return

    const { getAmbientTxWriteScope, recordTxWriteChange } = await import(
      '../resources/crud/tx-write-scope'
    )
    const scope = getAmbientTxWriteScope()

    if (scope) {
      for (const { recordId, fieldId, entry } of pending) {
        recordTxWriteChange(scope, {
          recordId,
          // The raw field id, matching the owning side's `systemAttribute ?? fieldId`
          // fallback. No `systemAttribute` is resolvable from here.
          outputKey: fieldId,
          // No `o`: the pre-write array is gone by the time the rows are
          // rewritten, and `recordTxWriteChange` treats `o` as optional.
          change: { n: entry.value ?? null },
          entry,
        })
      }
      return
    }

    const realtime = await import('../realtime')
    await realtime.publishFieldValueUpdates(
      realtime.getRealtimeService(),
      ctx.organizationId,
      pending.map((p) => p.entry)
    )
  } catch {
    // Best-effort by contract (3). The write is already durable; a client that
    // misses this frame is exactly as stale as it was before D-11, no worse.
  }
}

// ============================================================================
// CAPTURE EXISTING VALUES
// ============================================================================

/**
 * Get existing related entity IDs for a relationship field.
 * Call this BEFORE deleting/updating to capture what was there.
 */
export async function getExistingRelatedIds(
  ctx: RelationshipSyncContext,
  entityId: string,
  fieldId: string
): Promise<string[]> {
  const rows = await ctx.db
    .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityId),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )

  return rows.map((r) => r.relatedEntityId).filter((id): id is string => id !== null)
}

/**
 * Batch get existing related entity IDs for multiple entities.
 * More efficient than calling getExistingRelatedIds N times.
 *
 * @returns Map<entityId, relatedEntityIds[]>
 */
export async function batchGetExistingRelatedIds(
  ctx: RelationshipSyncContext,
  entityIds: string[],
  fieldId: string
): Promise<Map<string, string[]>> {
  if (entityIds.length === 0) {
    return new Map()
  }

  const rows = await ctx.db
    .select({
      entityId: schema.FieldValue.entityId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.entityId, entityIds),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )

  const result = new Map<string, string[]>()

  // Initialize all entityIds with empty arrays
  for (const entityId of entityIds) {
    result.set(entityId, [])
  }

  // Populate with actual values
  for (const row of rows) {
    if (row.relatedEntityId) {
      const existing = result.get(row.entityId) ?? []
      existing.push(row.relatedEntityId)
      result.set(row.entityId, existing)
    }
  }

  return result
}

// ============================================================================
// SYNC INVERSE RELATIONSHIPS (SINGLE ENTITY - BATCHED QUERIES)
// ============================================================================

/**
 * Synchronize inverse relationship values after a relationship field changes.
 *
 * This function does NOT look up field definitions - caller must provide
 * the inverseInfo extracted from cached field lookups.
 *
 * Uses batched queries internally:
 * - Removals: 1 DELETE with inArray (not N separate DELETEs)
 * - Adds (single-value): 1 DELETE + 1 batch INSERT
 * - Adds (multi-value): 1 existence check + 1 sortKey query + 1 batch INSERT
 *
 * @returns Information about which entities were affected
 */
export async function syncInverseRelationships(
  ctx: RelationshipSyncContext,
  input: SyncInverseInput
): Promise<InverseSyncResult> {
  const { entityId, oldRelatedIds, newRelatedIds, inverseInfo } = input

  // Calculate what changed
  const removedIds = oldRelatedIds.filter((id) => !newRelatedIds.includes(id))
  const addedIds = newRelatedIds.filter((id) => !oldRelatedIds.includes(id))

  // Nothing changed, skip
  if (removedIds.length === 0 && addedIds.length === 0) {
    return { removedFrom: [], addedTo: [] }
  }

  // Remove inverse relationships for entities that were unlinked (1 query)
  if (removedIds.length > 0) {
    await batchRemoveFromInverse(ctx, {
      inverseFieldId: inverseInfo.inverseFieldId,
      removals: new Map([[entityId, new Set(removedIds)]]),
    })
  }

  // Add inverse relationships for entities that were linked (2-3 queries)
  let cascadeOwnerIds: string[] = []
  if (addedIds.length > 0) {
    cascadeOwnerIds = await batchAddToInverse(ctx, {
      inverseFieldId: inverseInfo.inverseFieldId,
      inverseRelationshipType: inverseInfo.inverseRelationshipType,
      sourceEntityDefinitionId: inverseInfo.sourceEntityDefinitionId,
      targetEntityDefinitionId: inverseInfo.targetEntityDefinitionId,
      additions: new Map(addedIds.map((targetId) => [targetId, new Set([entityId])])),
      sourceFieldId: inverseInfo.sourceFieldId,
    })
  }

  // D-11: the records whose arrays actually moved, announced. `removedIds` and
  // `addedIds` are TARGET ids (the other end of the link) — the source's own
  // field was published by the caller that wrote it.
  await announceInverseChanges(ctx, [
    {
      entityDefinitionId: inverseInfo.targetEntityDefinitionId,
      fieldId: inverseInfo.inverseFieldId,
      entityIds: [...new Set([...removedIds, ...addedIds])],
      single: isSingleValued(inverseInfo.inverseRelationshipType),
    },
    // Re-parenting: moving a target from owner A to owner B also shortens A's
    // list, on the SOURCE side's own field. That write is just as silent.
    {
      entityDefinitionId: inverseInfo.sourceEntityDefinitionId,
      fieldId: inverseInfo.sourceFieldId,
      entityIds: cascadeOwnerIds,
      single: false,
    },
  ])

  return {
    removedFrom: removedIds,
    addedTo: addedIds,
  }
}

// ============================================================================
// BULK SYNC (MULTIPLE ENTITIES - AGGREGATED QUERIES)
// ============================================================================

/**
 * Sync inverse relationships for multiple entities in minimal queries.
 *
 * Instead of syncing each entity separately (N × queries), this:
 * 1. Aggregates all removes across entities → 1 DELETE per unique sourceId
 * 2. Aggregates all adds across entities → 2-3 queries total
 *
 * Example: 100 products changing vendor
 * - Without bulk: 100 × 4 = 400 queries
 * - With bulk: 4-6 queries total
 */
export async function syncInverseRelationshipsBulk(
  ctx: RelationshipSyncContext,
  input: BulkSyncInput
): Promise<void> {
  const { updates, inverseInfo } = input
  const { inverseFieldId, inverseRelationshipType, sourceEntityDefinitionId } = inverseInfo

  // ═══ Aggregate all changes ═══
  // Map: targetEntityId (the entity whose inverse field is updated) → Set of sourceEntityIds
  const removals = new Map<string, Set<string>>()
  const additions = new Map<string, Set<string>>()

  for (const { entityId, oldRelatedIds, newRelatedIds } of updates) {
    const oldSet = new Set(oldRelatedIds)
    const newSet = new Set(newRelatedIds)

    // Entities that were removed from this source
    for (const targetId of oldRelatedIds) {
      if (!newSet.has(targetId)) {
        if (!removals.has(targetId)) removals.set(targetId, new Set())
        removals.get(targetId)!.add(entityId)
      }
    }

    // Entities that were added to this source
    for (const targetId of newRelatedIds) {
      if (!oldSet.has(targetId)) {
        if (!additions.has(targetId)) additions.set(targetId, new Set())
        additions.get(targetId)!.add(entityId)
      }
    }
  }

  // ═══ Execute batched removals ═══
  if (removals.size > 0) {
    await batchRemoveFromInverse(ctx, {
      inverseFieldId,
      removals,
    })
  }

  // ═══ Execute batched additions ═══
  let cascadeOwnerIds: string[] = []
  if (additions.size > 0) {
    cascadeOwnerIds = await batchAddToInverse(ctx, {
      inverseFieldId,
      inverseRelationshipType,
      sourceEntityDefinitionId,
      targetEntityDefinitionId: inverseInfo.targetEntityDefinitionId,
      additions,
      sourceFieldId: inverseInfo.sourceFieldId,
    })
  }

  // D-11, same contract as the single-entity path. Both maps are keyed by the
  // TARGET id, so their union is exactly the set of records whose array moved.
  await announceInverseChanges(ctx, [
    {
      entityDefinitionId: inverseInfo.targetEntityDefinitionId,
      fieldId: inverseFieldId,
      entityIds: [...new Set([...removals.keys(), ...additions.keys()])],
      single: isSingleValued(inverseRelationshipType),
    },
    {
      entityDefinitionId: sourceEntityDefinitionId,
      fieldId: inverseInfo.sourceFieldId,
      entityIds: cascadeOwnerIds,
      single: false,
    },
  ])
}

// ============================================================================
// BATCH REMOVE FROM INVERSE FIELD
// ============================================================================

interface BatchRemoveParams {
  inverseFieldId: string
  /** Map: targetEntityId → Set of sourceEntityIds to remove from that target's inverse */
  removals: Map<string, Set<string>>
}

/**
 * Remove related entities from inverse relationship fields in batched queries.
 *
 * Groups by sourceEntityId and executes one DELETE per unique source.
 * This is optimal because we're removing the same sourceId from multiple targets.
 *
 * Query count: O(unique sourceIds) instead of O(target × source pairs)
 */
async function batchRemoveFromInverse(
  ctx: RelationshipSyncContext,
  params: BatchRemoveParams
): Promise<void> {
  const { inverseFieldId, removals } = params

  if (removals.size === 0) return

  // Invert the map: group by sourceEntityId (what we're removing)
  // This allows us to delete all occurrences of each sourceId in one query
  const bySourceId = new Map<string, string[]>()

  for (const [targetId, sourceIds] of removals) {
    for (const sourceId of sourceIds) {
      if (!bySourceId.has(sourceId)) bySourceId.set(sourceId, [])
      bySourceId.get(sourceId)!.push(targetId)
    }
  }

  // Execute one DELETE per unique sourceId
  // Each query removes that sourceId from all target entities
  for (const [sourceId, targetIds] of bySourceId) {
    await ctx.db
      .delete(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, targetIds),
          eq(schema.FieldValue.fieldId, inverseFieldId),
          eq(schema.FieldValue.relatedEntityId, sourceId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )
  }
}

// ============================================================================
// BATCH ADD TO INVERSE FIELD
// ============================================================================

interface BatchAddParams {
  inverseFieldId: string
  inverseRelationshipType: RelationshipType
  sourceEntityDefinitionId: string
  targetEntityDefinitionId: string
  /** Map: targetEntityId → Set of sourceEntityIds to add to that target's inverse */
  additions: Map<string, Set<string>>
  /** The source field's ID (for cascade cleanup when inverse is single-value) */
  sourceFieldId: string
}

/**
 * Add related entities to inverse relationship fields in batched queries.
 *
 * Single-value (belongs_to/has_one): 2 queries total
 * - 1 DELETE to clear all existing values
 * - 1 batch INSERT for all new values
 *
 * Multi-value (has_many/many_to_many): 3 queries total
 * - 1 query to check existing links (dedupe)
 * - 1 query to get max sortKeys
 * - 1 batch INSERT for all new values
 *
 * @returns the ids of PREVIOUS owners whose own list was shortened by a
 * re-parent (single-value branch only; empty otherwise). They are a second set
 * of silently-rewritten records and D-11 announces them too.
 */
async function batchAddToInverse(
  ctx: RelationshipSyncContext,
  params: BatchAddParams
): Promise<string[]> {
  const {
    inverseFieldId,
    inverseRelationshipType,
    sourceEntityDefinitionId,
    targetEntityDefinitionId,
    additions,
    sourceFieldId,
  } = params

  if (additions.size === 0) return []

  const isSingleValue =
    inverseRelationshipType === 'belongs_to' || inverseRelationshipType === 'has_one'

  // Collect all pairs for processing
  const pairs: { targetId: string; sourceId: string }[] = []
  for (const [targetId, sourceIds] of additions) {
    for (const sourceId of sourceIds) {
      pairs.push({ targetId, sourceId })
    }
  }

  if (pairs.length === 0) return []

  /** Previous owners a re-parent shortened; single-value branch only. */
  let cascadeOwnerIds: string[] = []
  const allTargetIds = [...additions.keys()]

  if (isSingleValue) {
    // ─────────────────────────────────────────────────────────────
    // SINGLE-VALUE: Clear all existing, then batch insert
    // For single-value, each target can only have ONE sourceId
    // If multiple sources try to set the same target, last wins
    // ─────────────────────────────────────────────────────────────

    const finalValue = new Map<string, string>()
    for (const { targetId, sourceId } of pairs) {
      finalValue.set(targetId, sourceId) // Last wins
    }

    // ═══ CASCADE: Get existing inverse values to find old owners ═══
    // Before clearing the inverse values, we need to remove targets from old owners
    const existingInverse = await ctx.db
      .select({
        entityId: schema.FieldValue.entityId, // targetId (e.g., ProductX)
        relatedEntityId: schema.FieldValue.relatedEntityId, // oldOwnerId (e.g., Vendor1)
      })
      .from(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, allTargetIds),
          eq(schema.FieldValue.fieldId, inverseFieldId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )

    // Build map: oldOwnerId → targetIds to remove from that owner's has_many field
    const cascadeRemovals = new Map<string, string[]>()
    for (const row of existingInverse) {
      if (row.relatedEntityId) {
        const newOwner = finalValue.get(row.entityId)
        // Only cascade if old owner differs from new owner
        if (newOwner && row.relatedEntityId !== newOwner) {
          if (!cascadeRemovals.has(row.relatedEntityId)) {
            cascadeRemovals.set(row.relatedEntityId, [])
          }
          cascadeRemovals.get(row.relatedEntityId)!.push(row.entityId)
        }
      }
    }

    // ═══ CASCADE DELETE: Remove targets from old owners' has_many fields ═══
    // Reported back to the caller so D-11 can announce these owners too — their
    // list just got shorter and, until D-11, nothing said so.
    cascadeOwnerIds = [...cascadeRemovals.keys()]
    for (const [oldOwnerId, targetIds] of cascadeRemovals) {
      await ctx.db
        .delete(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.entityId, oldOwnerId),
            eq(schema.FieldValue.fieldId, sourceFieldId),
            inArray(schema.FieldValue.relatedEntityId, targetIds),
            eq(schema.FieldValue.organizationId, ctx.organizationId)
          )
        )
    }

    // Value-space reconcile (delete-insert-replace Phase 2): instead of
    // clearing every target's inverse row and re-minting it, read the stored
    // rows inside the transaction and touch only what differs — a target
    // already pointing at its new owner keeps its row byte-identical. The
    // transaction still closes the Phase-0 destroy window; cross-entity bulk
    // pair, so no per-(entity, field) advisory lock.
    await ctx.db.transaction(async (tx) => {
      const stored = await tx
        .select({
          id: schema.FieldValue.id,
          entityId: schema.FieldValue.entityId,
          relatedEntityId: schema.FieldValue.relatedEntityId,
          relatedEntityDefinitionId: schema.FieldValue.relatedEntityDefinitionId,
          sortKey: schema.FieldValue.sortKey,
        })
        .from(schema.FieldValue)
        .where(
          and(
            inArray(schema.FieldValue.entityId, allTargetIds),
            eq(schema.FieldValue.fieldId, inverseFieldId),
            eq(schema.FieldValue.organizationId, ctx.organizationId)
          )
        )
        .orderBy(asc(schema.FieldValue.entityId), asc(schema.FieldValue.sortKey))

      const rowsByTarget = new Map<string, typeof stored>()
      for (const row of stored) {
        const list = rowsByTarget.get(row.entityId) ?? []
        list.push(row)
        rowsByTarget.set(row.entityId, list)
      }

      const deleteIds: string[] = []
      const inserts: Array<typeof schema.FieldValue.$inferInsert> = []

      for (const targetId of allTargetIds) {
        const rows = rowsByTarget.get(targetId) ?? []
        const [first, ...extras] = rows
        // Single-value inverse: at most one row may survive per target — the
        // old clear-all removed strays, the reconcile deletes them by id.
        for (const extra of extras) deleteIds.push(extra.id)

        const sourceId = finalValue.get(targetId)
        if (sourceId === undefined) {
          // Target had additions with an empty source set: the replace
          // semantics cleared its inverse — preserve that.
          if (first) deleteIds.push(first.id)
          continue
        }

        if (!first) {
          inserts.push({
            organizationId: ctx.organizationId,
            entityId: targetId,
            entityDefinitionId: targetEntityDefinitionId,
            fieldId: inverseFieldId,
            relatedEntityId: sourceId,
            relatedEntityDefinitionId: sourceEntityDefinitionId,
            sortKey: generateKeyBetween(null, null),
          })
          continue
        }

        if (
          first.relatedEntityId === sourceId &&
          first.relatedEntityDefinitionId === sourceEntityDefinitionId
        ) {
          continue // Already points at the new owner — row stays byte-identical.
        }

        // Re-point in place: id and sortKey survive; `$onUpdate` stamps
        // `updatedAt`. The rowcount is checked: this path holds no advisory
        // lock, so under READ COMMITTED a concurrent writer can delete the
        // row between the in-tx read above and this statement — a 0-row
        // UPDATE must fall back to inserting the intended row (the old
        // clear-all+INSERT recreated it regardless).
        const repointed = await tx
          .update(schema.FieldValue)
          .set({
            relatedEntityId: sourceId,
            relatedEntityDefinitionId: sourceEntityDefinitionId,
          })
          .where(
            and(
              eq(schema.FieldValue.id, first.id),
              eq(schema.FieldValue.organizationId, ctx.organizationId)
            )
          )
          .returning({ id: schema.FieldValue.id })
        if (repointed.length === 0) {
          inserts.push({
            organizationId: ctx.organizationId,
            entityId: targetId,
            entityDefinitionId: targetEntityDefinitionId,
            fieldId: inverseFieldId,
            relatedEntityId: sourceId,
            relatedEntityDefinitionId: sourceEntityDefinitionId,
            sortKey: generateKeyBetween(null, null),
          })
        }
      }

      if (deleteIds.length > 0) {
        await tx
          .delete(schema.FieldValue)
          .where(
            and(
              inArray(schema.FieldValue.id, deleteIds),
              eq(schema.FieldValue.organizationId, ctx.organizationId)
            )
          )
      }

      if (inserts.length > 0) {
        await tx.insert(schema.FieldValue).values(inserts)
      }
    })
  } else {
    // ─────────────────────────────────────────────────────────────
    // MULTI-VALUE: Check existing, get sortKeys, insert missing
    // ─────────────────────────────────────────────────────────────

    // 1 query: Get ALL existing links for these targets to check for duplicates
    const existing = await ctx.db
      .select({
        entityId: schema.FieldValue.entityId,
        relatedEntityId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, allTargetIds),
          eq(schema.FieldValue.fieldId, inverseFieldId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )

    const existingLinks = new Set(existing.map((e) => `${e.entityId}:${e.relatedEntityId}`))

    // Filter to only non-existing pairs (avoid duplicates)
    const toInsert = pairs.filter(
      ({ targetId, sourceId }) => !existingLinks.has(`${targetId}:${sourceId}`)
    )

    if (toInsert.length === 0) return cascadeOwnerIds

    const targetIdsNeedingInsert = [...new Set(toInsert.map((p) => p.targetId))]

    // 1 query: Get max sortKeys for targets that need inserts
    const sortKeyRows = await ctx.db
      .select({
        entityId: schema.FieldValue.entityId,
        maxKey: sql<string>`MAX(${schema.FieldValue.sortKey})`.as('maxKey'),
      })
      .from(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, targetIdsNeedingInsert),
          eq(schema.FieldValue.fieldId, inverseFieldId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )
      .groupBy(schema.FieldValue.entityId)

    // Build sortKey lookup
    const keyMap = new Map(sortKeyRows.map((r) => [r.entityId, r.maxKey]))

    // Track next key per target (for multiple inserts to same target)
    const nextKeyForTarget = new Map<string, string>()

    const insertValues = toInsert.map(({ targetId, sourceId }) => {
      const prevKey = nextKeyForTarget.get(targetId) ?? keyMap.get(targetId) ?? null
      // `nextKeyAfter` tolerates a corrupt MAX from the DB by degrading to 'a0'.
      const newKey = nextKeyAfter(prevKey)
      nextKeyForTarget.set(targetId, newKey)

      return {
        organizationId: ctx.organizationId,
        entityId: targetId,
        entityDefinitionId: targetEntityDefinitionId,
        fieldId: inverseFieldId,
        relatedEntityId: sourceId,
        relatedEntityDefinitionId: sourceEntityDefinitionId,
        sortKey: newKey,
      }
    })

    // 1 batch INSERT
    await ctx.db.insert(schema.FieldValue).values(insertValues)
  }

  return cascadeOwnerIds
}
