// packages/lib/src/field-values/relationship-sync.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, desc, sql } from 'drizzle-orm'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import type { RelationshipType } from '@auxx/types/custom-field'

// ============================================================================
// TYPES
// ============================================================================

/** Context required for all sync operations */
export interface RelationshipSyncContext {
  db: Database
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
  if (addedIds.length > 0) {
    await batchAddToInverse(ctx, {
      inverseFieldId: inverseInfo.inverseFieldId,
      inverseRelationshipType: inverseInfo.inverseRelationshipType,
      sourceEntityDefinitionId: inverseInfo.sourceEntityDefinitionId,
      targetEntityDefinitionId: inverseInfo.targetEntityDefinitionId,
      additions: new Map(addedIds.map((targetId) => [targetId, new Set([entityId])])),
      sourceFieldId: inverseInfo.sourceFieldId,
    })
  }

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
  if (additions.size > 0) {
    await batchAddToInverse(ctx, {
      inverseFieldId,
      inverseRelationshipType,
      sourceEntityDefinitionId,
      targetEntityDefinitionId: inverseInfo.targetEntityDefinitionId,
      additions,
      sourceFieldId: inverseInfo.sourceFieldId,
    })
  }
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
 */
async function batchAddToInverse(
  ctx: RelationshipSyncContext,
  params: BatchAddParams
): Promise<void> {
  const { inverseFieldId, inverseRelationshipType, sourceEntityDefinitionId, targetEntityDefinitionId, additions, sourceFieldId } = params

  if (additions.size === 0) return

  const isSingleValue =
    inverseRelationshipType === 'belongs_to' || inverseRelationshipType === 'has_one'

  // Collect all pairs for processing
  const pairs: { targetId: string; sourceId: string }[] = []
  for (const [targetId, sourceIds] of additions) {
    for (const sourceId of sourceIds) {
      pairs.push({ targetId, sourceId })
    }
  }

  if (pairs.length === 0) return

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
        entityId: schema.FieldValue.entityId,        // targetId (e.g., ProductX)
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

    // DELETE: Clear all existing inverse values for these targets
    await ctx.db
      .delete(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, allTargetIds),
          eq(schema.FieldValue.fieldId, inverseFieldId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )

    // batch INSERT: Insert all new values
    await ctx.db.insert(schema.FieldValue).values(
      [...finalValue.entries()].map(([targetId, sourceId]) => ({
        organizationId: ctx.organizationId,
        entityId: targetId,
        entityDefinitionId: targetEntityDefinitionId,
        fieldId: inverseFieldId,
        relatedEntityId: sourceId,
        relatedEntityDefinitionId: sourceEntityDefinitionId,
        sortKey: generateKeyBetween(null, null),
      }))
    )
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

    if (toInsert.length === 0) return

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
      const newKey = generateKeyBetween(prevKey, null)
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
}
