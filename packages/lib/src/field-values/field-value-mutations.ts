// packages/lib/src/field-values/field-value-mutations.ts

import { schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import {
  batchInsertFieldValues,
  deleteFieldValues,
  getExistingFieldValue,
  insertFieldValue,
  updateFieldValue,
} from '@auxx/services'
import {
  isArrayReturnFieldType,
  isMultiValueFieldType,
  type TypedFieldValue,
  type TypedFieldValueInput,
} from '@auxx/types'
import { isSelfReferentialRelationship, type RelationshipConfig } from '@auxx/types/custom-field'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { getCachedFieldMap, getCachedResource } from '../cache'
import {
  getBuiltInFieldHandler,
  getBuiltInFieldType,
  isBuiltInField,
} from '../custom-fields/built-in-fields'
import { checkUniqueValueTyped } from '../custom-fields/check-unique-value-typed'
import { BadRequestError } from '../errors'
import { publisher } from '../events'
import type { ContactFieldUpdatedEvent } from '../events/types'
import {
  collectTriggeredFields,
  deduplicateBySystemAttribute,
} from '../field-triggers/collect-triggers'
import {
  publishBatchFieldTriggerEvents,
  publishFieldTriggerEvents,
} from '../field-triggers/publish'
import { getRealtimeService, publishFieldValueUpdates } from '../realtime'
import { getModelType, isRecordId, parseRecordId, toRecordId } from '../resources/resource-id'
import { applyAiMarker } from './ai-commit'
import { shortCircuitAiGenerate } from './ai-enqueue'
import {
  type CachedField,
  canonicalizeRelationshipRecordId,
  canonicalizeRelationshipValue,
  type FieldValueContext,
  getField,
  getInverseInfoFromField,
  type InverseFieldInfo,
  maybeUpdateDisplayValue,
  preBatchValidateRelationships,
  resolveFieldIds,
  rowToTypedValue,
  validateAndConvertValue,
} from './field-value-helpers'
import { getValue } from './field-value-queries'
import { formatToTypedInput } from './formatter'
import {
  type BulkRelationshipUpdate,
  batchGetExistingRelatedIds,
  getExistingRelatedIds,
  syncInverseRelationships,
  syncInverseRelationshipsBulk,
} from './relationship-sync'
import { type ValidationContext, validateSelfReferentialChange } from './relationship-validators'
import type {
  AddRelationValuesBulkInput,
  AddRelationValuesInput,
  AddValueInput,
  DeleteValueInput,
  FieldValueRow,
  RemoveRelationValuesBulkInput,
  RemoveRelationValuesInput,
  SetBulkValuesInput,
  SetValueInput,
  SetValueResult,
  SetValuesForEntityInput,
  SetValuesResult,
  SetValueWithBuiltInInput,
  SetValueWithTypeInput,
} from './types'

// =============================================================================
// SELF-REFERENTIAL VALIDATION
// =============================================================================

/**
 * Validate self-referential relationship constraints before saving.
 * Checks for circular references and max depth violations.
 */
async function validateRelationshipValue(
  ctx: FieldValueContext,
  params: {
    entityId: string
    entityDefinitionId: string
    fieldId: string
    field: CachedField
    newValue: TypedFieldValueInput | TypedFieldValueInput[] | null
  }
): Promise<void> {
  const relationship = params.field.options?.relationship as RelationshipConfig | undefined
  if (!relationship) return

  // Only validate self-referential relationships
  if (!isSelfReferentialRelationship(params.entityDefinitionId, relationship)) {
    return
  }

  // Extract related entity ID from typed input
  const extractRelatedId = (v: TypedFieldValueInput | null): string | null => {
    if (!v || v.type !== 'relationship') return null
    return parseRecordId(v.recordId).entityInstanceId
  }

  const newRelatedId = Array.isArray(params.newValue)
    ? extractRelatedId(params.newValue[0] ?? null)
    : extractRelatedId(params.newValue)

  const validationCtx: ValidationContext = {
    db: ctx.db,
    organizationId: ctx.organizationId,
  }

  const result = await validateSelfReferentialChange(validationCtx, {
    entityId: params.entityId,
    entityDefinitionId: params.entityDefinitionId,
    fieldId: params.fieldId,
    newRelatedId,
    relationship,
  })

  if (!result.valid) {
    throw new Error(result.error ?? 'Invalid relationship value')
  }
}

// =============================================================================
// CORE MUTATIONS
// =============================================================================

/**
 * Set a single field value with automatic type conversion and smart persistence strategy.
 *
 * This is a lower-level method that requires callers to handle field type detection.
 * For higher-level usage, prefer setValueWithBuiltIn() which handles built-in fields.
 *
 * @param ctx - Field value context
 * @param params - The SetValueInput object
 * @returns Array of TypedFieldValue objects after the operation.
 */
export async function setValue(
  ctx: FieldValueContext,
  params: SetValueInput
): Promise<TypedFieldValue[]> {
  const { recordId, fieldId, value } = params

  // 1. Get field definition (cached)
  const field = await getField(ctx, fieldId)
  const fieldType = field.type as FieldType

  // 2. Convert raw value to typed input using formatter
  const fieldOptions = field.options as { actor?: { multiple?: boolean } } | undefined
  const rawTypedInput = formatToTypedInput(value, fieldType, {
    selectOptions: field.options as { id?: string; value: string; label: string }[] | undefined,
    fieldOptions,
  })
  // Canonicalize relationship recordIds so type-name prefixes (e.g. "contact:...")
  // resolve to the EntityDefinition UUID before the row is written.
  const typedInput =
    fieldType === 'RELATIONSHIP'
      ? await canonicalizeRelationshipValue(ctx, rawTypedInput)
      : rawTypedInput

  // Handle null/delete case
  if (typedInput === null) {
    await deleteValue(ctx, { recordId, fieldId })
    await maybeUpdateDisplayValue(ctx, recordId, field, null)
    return []
  }

  // 3. Determine strategy and execute
  let result: TypedFieldValue[]

  if (isMultiValueFieldType(fieldType, fieldOptions)) {
    // Multi-value: DELETE all + INSERT all
    result = await setMultiValue(ctx, recordId, fieldId, fieldType, typedInput)
  } else {
    // Single-value: UPSERT (UPDATE or INSERT)
    result = await setSingleValue(ctx, recordId, fieldId, fieldType, typedInput)
  }

  // 4. Update display value if this is a display field
  await maybeUpdateDisplayValue(ctx, recordId, field, typedInput)

  return result
}

/**
 * Set field value when caller already has the field type information.
 *
 * This method skips the CustomField lookup (since you provide fieldType), making it more
 * efficient when called multiple times in a batch or when you already know the field type.
 *
 * @param ctx - Field value context
 * @param params - The SetValueWithTypeInput object
 * @returns Array of TypedFieldValue objects after the operation.
 */
export async function setValueWithType(
  ctx: FieldValueContext,
  params: SetValueWithTypeInput
): Promise<TypedFieldValue[]> {
  const { recordId, fieldId, fieldType, skipInverseSync = false } = params
  let value = params.value

  // Parse RecordId to get both parts for DB queries
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  // Get field definition for displayName update (cached)
  const field = await getField(ctx, fieldId)

  // For relationships: validate self-referential constraints, capture old values, get inverse info
  let oldRelatedIds: string[] = []
  let inverseInfo: InverseFieldInfo | null = null

  if (fieldType === 'RELATIONSHIP') {
    // Canonicalize relationship recordIds so type-name prefixes (e.g. "contact:...")
    // resolve to the EntityDefinition UUID before the row is written.
    value = await canonicalizeRelationshipValue(ctx, value)

    // Validate self-referential constraints (circular reference, max depth)
    await validateRelationshipValue(ctx, {
      entityId: entityInstanceId,
      entityDefinitionId,
      fieldId,
      field,
      newValue: value,
    })

    // Existing inverse sync logic (unchanged)
    if (!skipInverseSync) {
      inverseInfo = await getInverseInfoFromField(ctx, field)

      // Only capture old values if we have an inverse to sync
      if (inverseInfo) {
        oldRelatedIds = await getExistingRelatedIds(
          { db: ctx.db, organizationId: ctx.organizationId },
          entityInstanceId,
          fieldId
        )
      }
    }
  }

  // Delete existing values for this entityInstanceId + fieldId
  await ctx.db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )

  // If value is null, we're done (deletion)
  if (value === null) {
    await maybeUpdateDisplayValue(ctx, recordId, field, null)

    // Sync inverse if we had old relationships
    if (inverseInfo && oldRelatedIds.length > 0) {
      await syncInverseRelationships(
        { db: ctx.db, organizationId: ctx.organizationId },
        { entityId: entityInstanceId, oldRelatedIds, newRelatedIds: [], inverseInfo }
      )
    }

    return []
  }

  // Handle array of values (multi-value fields)
  const values = Array.isArray(value) ? value : [value]
  if (values.length === 0) {
    await maybeUpdateDisplayValue(ctx, recordId, field, null)

    // Sync inverse if we had old relationships
    if (inverseInfo && oldRelatedIds.length > 0) {
      await syncInverseRelationships(
        { db: ctx.db, organizationId: ctx.organizationId },
        { entityId: entityInstanceId, oldRelatedIds, newRelatedIds: [], inverseInfo }
      )
    }

    return []
  }

  // Generate sort keys for each value. When `aiGeneration` is present on
  // the input (stage-2 AI commit), merge the `aiStatus='result'` + metadata
  // marker onto each insert row. Absent = manual write → marker stays null,
  // naturally clearing any prior AI marker via this DELETE+INSERT cycle.
  const insertRows = values.map((v, index) => {
    const sortKey = generateKeyBetween(index === 0 ? null : `a${index - 1}`, null)
    const baseRow = buildFieldValueRow({
      organizationId: ctx.organizationId,
      entityId: entityInstanceId,
      entityDefinitionId,
      fieldId,
      value: v,
      sortKey,
    })
    return params.aiGeneration ? applyAiMarker(baseRow, params.aiGeneration) : baseRow
  })

  // Insert all values
  const inserted = await ctx.db.insert(schema.FieldValue).values(insertRows).returning()

  const result = inserted.map((row) => rowToTypedValue(row as unknown as FieldValueRow, fieldType))

  // Update display value if this is a display field
  await maybeUpdateDisplayValue(ctx, recordId, field, value)

  // Sync inverse relationships
  if (inverseInfo) {
    const newRelatedIds = values
      .filter(
        (v): v is { type: 'relationship'; recordId: RecordId } =>
          v.type === 'relationship' && !!(v as { recordId?: RecordId }).recordId
      )
      .map((v) => parseRecordId(v.recordId).entityInstanceId)

    await syncInverseRelationships(
      { db: ctx.db, organizationId: ctx.organizationId },
      { entityId: entityInstanceId, oldRelatedIds, newRelatedIds, inverseInfo }
    )
  }

  return result
}

/**
 * Add a single value to a multi-value field without removing existing values.
 * APPEND operation - calculates correct sort order based on existing values.
 *
 * @param ctx - Field value context
 * @param params - The AddValueInput object
 * @returns Single TypedFieldValue for the newly added value
 */
export async function addValue(
  ctx: FieldValueContext,
  params: AddValueInput
): Promise<TypedFieldValue> {
  const { recordId, fieldId, fieldType, value, position = 'end' } = params

  // Parse RecordId to get entityInstanceId for DB queries
  const { entityInstanceId } = parseRecordId(recordId)

  // Get existing values to determine sortKey position
  const existing = await ctx.db
    .select({ sortKey: schema.FieldValue.sortKey })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  // Calculate sort key based on position
  let sortKey: string
  if (existing.length === 0) {
    sortKey = generateKeyBetween(null, null)
  } else if (position === 'start') {
    sortKey = generateKeyBetween(null, existing[0]!.sortKey)
  } else if (position === 'end') {
    sortKey = generateKeyBetween(existing[existing.length - 1]!.sortKey, null)
  } else {
    // Insert after specific value
    const afterIndex = existing.findIndex((e) => e.sortKey === position.after)
    if (afterIndex === -1) {
      sortKey = generateKeyBetween(existing[existing.length - 1]!.sortKey, null)
    } else {
      const afterKey = existing[afterIndex]!.sortKey
      const beforeKey = existing[afterIndex + 1]?.sortKey ?? null
      sortKey = generateKeyBetween(afterKey, beforeKey)
    }
  }

  const { entityDefinitionId: addDefId, entityInstanceId: addInstId } = parseRecordId(recordId)
  const insertRow = buildFieldValueRow({
    organizationId: ctx.organizationId,
    entityId: addInstId,
    entityDefinitionId: addDefId,
    fieldId,
    value,
    sortKey,
  })

  const [inserted] = await ctx.db.insert(schema.FieldValue).values(insertRow).returning()

  const typedResult = rowToTypedValue(inserted as unknown as FieldValueRow, fieldType)

  // Update display value if this is a display field (e.g., avatar for FILE fields)
  const field = await getField(ctx, fieldId)
  await maybeUpdateDisplayValue(ctx, recordId, field, value)

  // Re-read full field value and publish (multi-value — send complete array)
  const fullValues = await getValue(ctx, { recordId, fieldId })
  if (fullValues) {
    const key = buildFieldValueKey(recordId, fieldId as FieldId)
    publishFieldValueUpdates(
      getRealtimeService(),
      ctx.organizationId,
      [{ key, value: fullValues }],
      { excludeSocketId: ctx.socketId }
    ).catch(() => {})
  }

  return typedResult
}

/**
 * Remove a single value from a multi-value field by its FieldValue ID.
 *
 * @param ctx - Field value context
 * @param valueId - The FieldValue record ID (UUID)
 */
export async function removeValue(ctx: FieldValueContext, valueId: string): Promise<void> {
  // Look up the row before deleting so we can update display values (e.g., clear avatar)
  const [row] = await ctx.db
    .select({
      fieldId: schema.FieldValue.fieldId,
      entityId: schema.FieldValue.entityId,
      entityDefinitionId: schema.FieldValue.entityDefinitionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.id, valueId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )

  await ctx.db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.id, valueId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )

  // Update display value after removal (e.g., clear avatarUrl when avatar file is removed)
  if (row) {
    const field = await getField(ctx, row.fieldId)
    const recordId = toRecordId(row.entityDefinitionId, row.entityId)
    // Check if there are remaining values (multi-value field might still have others)
    const remaining = await getValue(ctx, { recordId, fieldId: row.fieldId })
    await maybeUpdateDisplayValue(ctx, recordId, field, remaining ?? null)
  }
}

/**
 * Delete all values for a field on an entity.
 *
 * @param ctx - Field value context
 * @param params - Delete value input
 */
export async function deleteValue(ctx: FieldValueContext, params: DeleteValueInput): Promise<void> {
  const { entityInstanceId } = parseRecordId(params.recordId)

  await ctx.db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, params.fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
}

// =============================================================================
// RELATION ADD / REMOVE MUTATIONS
// =============================================================================

/**
 * Add relation values to an existing multi-value relationship field (no duplicates).
 * Appends new values after existing ones using fractional indexing.
 * Syncs inverse relationships for additions only.
 *
 * @param ctx - Field value context
 * @param params - Source record, field ID, and target RecordIds to link
 */
export async function addRelationValues(
  ctx: FieldValueContext,
  params: AddRelationValuesInput
): Promise<void> {
  const { recordId, fieldId, relatedRecordIds } = params
  if (relatedRecordIds.length === 0) return

  // Canonicalize relationship recordIds so type-name prefixes (e.g. "contact:...")
  // resolve to the EntityDefinition UUID before the row is written.
  const canonicalRelatedIds = await Promise.all(
    relatedRecordIds.map((rid) => canonicalizeRelationshipRecordId(ctx, rid))
  )

  const parsedTargets = canonicalRelatedIds.map((rid) => parseRecordId(rid))
  const relatedEntityDefinitionId = parsedTargets[0]!.entityDefinitionId
  const relatedEntityIds = parsedTargets.map((p) => p.entityInstanceId)

  const { entityInstanceId } = parseRecordId(recordId)

  // Get existing relation IDs to avoid duplicates
  const existingIds = await getExistingRelatedIds(
    { db: ctx.db, organizationId: ctx.organizationId },
    entityInstanceId,
    fieldId
  )
  const existingSet = new Set(existingIds)
  const newIds = relatedEntityIds.filter((id) => !existingSet.has(id))
  if (newIds.length === 0) return

  // Get max sort key for appending
  const existing = await ctx.db
    .select({ sortKey: schema.FieldValue.sortKey })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  // Generate sort keys and insert new values
  const { entityDefinitionId } = parseRecordId(recordId)
  let prevKey = existing.length > 0 ? existing[existing.length - 1]!.sortKey : null

  const insertRows = newIds.map((relatedId) => {
    const sortKey = generateKeyBetween(prevKey, null)
    prevKey = sortKey
    return {
      organizationId: ctx.organizationId,
      entityId: entityInstanceId,
      entityDefinitionId,
      fieldId,
      relatedEntityId: relatedId,
      relatedEntityDefinitionId,
      sortKey,
      valueText: null,
      valueNumber: null,
      valueBoolean: null,
      valueDate: null,
      valueJson: null,
      optionId: null,
      actorId: null,
    }
  })

  await ctx.db.insert(schema.FieldValue).values(insertRows)

  // Sync inverse relationships (additions only)
  const field = await getField(ctx, fieldId)
  const inverseInfo = await getInverseInfoFromField(ctx, field)
  if (inverseInfo) {
    await syncInverseRelationships(
      { db: ctx.db, organizationId: ctx.organizationId },
      {
        entityId: entityInstanceId,
        oldRelatedIds: existingIds,
        newRelatedIds: [...existingIds, ...newIds],
        inverseInfo,
      }
    )
  }
}

/**
 * Remove specific relation values from an existing multi-value relationship field.
 * Deletes FieldValue rows matching the given target records.
 * Syncs inverse relationships for removals only.
 *
 * @param ctx - Field value context
 * @param params - Source record, field ID, and target RecordIds to unlink
 */
export async function removeRelationValues(
  ctx: FieldValueContext,
  params: RemoveRelationValuesInput
): Promise<void> {
  const { recordId, fieldId, relatedRecordIds } = params
  if (relatedRecordIds.length === 0) return

  const relatedEntityIds = relatedRecordIds.map((rid) => parseRecordId(rid).entityInstanceId)
  const { entityInstanceId } = parseRecordId(recordId)

  // Capture existing IDs before removal (for inverse sync)
  const existingIds = await getExistingRelatedIds(
    { db: ctx.db, organizationId: ctx.organizationId },
    entityInstanceId,
    fieldId
  )

  // Delete matching relation values
  await ctx.db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId),
        inArray(schema.FieldValue.relatedEntityId, relatedEntityIds),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )

  // Sync inverse relationships (removals only)
  const field = await getField(ctx, fieldId)
  const inverseInfo = await getInverseInfoFromField(ctx, field)
  if (inverseInfo) {
    const newRelatedIds = existingIds.filter((id) => !relatedEntityIds.includes(id))
    await syncInverseRelationships(
      { db: ctx.db, organizationId: ctx.organizationId },
      { entityId: entityInstanceId, oldRelatedIds: existingIds, newRelatedIds, inverseInfo }
    )
  }
}

// =============================================================================
// BULK RELATION ADD / REMOVE (VECTORIZED ACROSS MANY SOURCE ENTITIES)
// =============================================================================

/**
 * Add the same related records to many source entities in one vectorized call.
 *
 * Query budget (flat wrt N sources and M targets):
 * - 1 read for existing related ids (batchGetExistingRelatedIds)
 * - 1 read for per-entity MAX(sortKey)
 * - 1 batch insert
 * - 4-6 queries for bulk inverse sync (if configured)
 *
 * All `recordIds` must share one entityDefinitionId; same for `relatedRecordIds`.
 */
export async function addRelationValuesBulk(
  ctx: FieldValueContext,
  params: AddRelationValuesBulkInput
): Promise<{ inserted: number; skipped: number }> {
  const { recordIds, fieldId, relatedRecordIds } = params
  if (recordIds.length === 0 || relatedRecordIds.length === 0) {
    return { inserted: 0, skipped: 0 }
  }

  // Canonicalize source and target recordIds so type-name prefixes (e.g. "contact:...")
  // resolve to the EntityDefinition UUID before any row is written.
  const [canonicalSourceIds, canonicalRelatedIds] = await Promise.all([
    Promise.all(recordIds.map((rid) => canonicalizeRelationshipRecordId(ctx, rid))),
    Promise.all(relatedRecordIds.map((rid) => canonicalizeRelationshipRecordId(ctx, rid))),
  ])

  // Parse + validate source record ids
  const parsed = canonicalSourceIds.map((rid) => parseRecordId(rid))
  const entityDefinitionId = parsed[0]!.entityDefinitionId
  const entityIds = parsed.map((p) => p.entityInstanceId)
  if (parsed.some((p) => p.entityDefinitionId !== entityDefinitionId)) {
    throw new BadRequestError(
      'addRelationValuesBulk: all recordIds must share one entityDefinitionId'
    )
  }

  // Parse + validate target record ids
  const parsedTargets = canonicalRelatedIds.map((rid) => parseRecordId(rid))
  const relatedEntityDefinitionId = parsedTargets[0]!.entityDefinitionId
  const uniqueRelatedIds = [...new Set(parsedTargets.map((p) => p.entityInstanceId))]
  if (parsedTargets.some((p) => p.entityDefinitionId !== relatedEntityDefinitionId)) {
    throw new BadRequestError(
      'addRelationValuesBulk: all relatedRecordIds must share one entityDefinitionId'
    )
  }

  // Resolve field from cache
  const field = await getField(ctx, fieldId)
  if (field.type !== 'RELATIONSHIP') {
    throw new BadRequestError(
      `addRelationValuesBulk: field ${fieldId} is not a RELATIONSHIP field (got ${field.type})`
    )
  }

  // Fetch existing related ids for every source entity in one query
  const existingByEntity = await batchGetExistingRelatedIds(
    { db: ctx.db, organizationId: ctx.organizationId },
    entityIds,
    fieldId
  )

  // Compute per-entity inserts + skip list
  type InsertPair = { entityId: string; relatedEntityId: string }
  const toInsert: InsertPair[] = []
  let skipped = 0

  for (const entityId of entityIds) {
    const existing = new Set(existingByEntity.get(entityId) ?? [])
    for (const relatedId of uniqueRelatedIds) {
      if (existing.has(relatedId)) {
        skipped += 1
        continue
      }
      toInsert.push({ entityId, relatedEntityId: relatedId })
    }
  }

  if (toInsert.length === 0) {
    return { inserted: 0, skipped }
  }

  const insertEntityIds = [...new Set(toInsert.map((p) => p.entityId))]

  // Fetch per-entity max sortKey in one query
  const sortKeyRows = await ctx.db
    .select({
      entityId: schema.FieldValue.entityId,
      maxKey: sql<string>`MAX(${schema.FieldValue.sortKey})`.as('maxKey'),
    })
    .from(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.entityId, insertEntityIds),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
    .groupBy(schema.FieldValue.entityId)

  const maxKeyByEntity = new Map(sortKeyRows.map((r) => [r.entityId, r.maxKey]))

  // Build insert rows with unique fractional sortKeys, per-entity monotonic
  const nextKeyByEntity = new Map<string, string | null>()
  for (const entityId of insertEntityIds) {
    nextKeyByEntity.set(entityId, maxKeyByEntity.get(entityId) ?? null)
  }

  const insertRows = toInsert.map(({ entityId, relatedEntityId }) => {
    const prevKey = nextKeyByEntity.get(entityId) ?? null
    const sortKey = generateKeyBetween(prevKey, null)
    nextKeyByEntity.set(entityId, sortKey)
    return {
      organizationId: ctx.organizationId,
      entityId,
      entityDefinitionId,
      fieldId,
      relatedEntityId,
      relatedEntityDefinitionId,
      sortKey,
    }
  })

  await ctx.db.insert(schema.FieldValue).values(insertRows)

  // Inverse sync, bulk (aggregated across all entities)
  if (!params.skipInverseSync) {
    const inverseInfo = await getInverseInfoFromField(ctx, field)
    if (inverseInfo) {
      const insertedByEntity = new Map<string, string[]>()
      for (const { entityId, relatedEntityId } of toInsert) {
        const arr = insertedByEntity.get(entityId) ?? []
        arr.push(relatedEntityId)
        insertedByEntity.set(entityId, arr)
      }

      const updates: BulkRelationshipUpdate[] = entityIds.map((entityId) => {
        const oldIds = existingByEntity.get(entityId) ?? []
        const insertedForEntity = insertedByEntity.get(entityId) ?? []
        const newIds = [...oldIds, ...insertedForEntity]
        return { entityId, oldRelatedIds: oldIds, newRelatedIds: newIds }
      })

      await syncInverseRelationshipsBulk(
        { db: ctx.db, organizationId: ctx.organizationId },
        { updates, inverseInfo }
      )
    }
  }

  // Field triggers, batched (org cache read, then fire-and-forget publish)
  if (ctx.userId && params.skipPublishEvents !== true) {
    const triggered = await collectTriggeredFields(ctx.organizationId, [fieldId])
    if (triggered.length > 0) {
      const unique = deduplicateBySystemAttribute(triggered)
      const changedEntitySet = new Set(insertEntityIds)
      const changedRecordIds = recordIds.filter((_, i) => changedEntitySet.has(entityIds[i]!))
      if (changedRecordIds.length > 0) {
        await publishBatchFieldTriggerEvents(
          { organizationId: ctx.organizationId, userId: ctx.userId },
          unique,
          changedRecordIds
        )
      }
    }
  }

  // Realtime publish, batched (only for entities that actually changed)
  if (params.skipPublishEvents !== true) {
    const changedEntitySet = new Set(insertEntityIds)
    const insertedByEntity = new Map<string, string[]>()
    for (const { entityId, relatedEntityId } of toInsert) {
      const arr = insertedByEntity.get(entityId) ?? []
      arr.push(relatedEntityId)
      insertedByEntity.set(entityId, arr)
    }

    const entries = recordIds
      .map((recordId, i) => ({ recordId, entityId: entityIds[i]! }))
      .filter(({ entityId }) => changedEntitySet.has(entityId))
      .map(({ recordId, entityId }) => {
        const oldIds = existingByEntity.get(entityId) ?? []
        const insertedForEntity = insertedByEntity.get(entityId) ?? []
        const newRelatedIds = [...oldIds, ...insertedForEntity]
        return {
          key: buildFieldValueKey(recordId, fieldId as FieldId),
          value: newRelatedIds.map((instanceId) => ({
            recordId: toRecordId(relatedEntityDefinitionId, instanceId),
          })),
        }
      })

    if (entries.length > 0) {
      publishFieldValueUpdates(getRealtimeService(), ctx.organizationId, entries, {
        excludeSocketId: ctx.socketId,
      }).catch(() => {})
    }
  }

  return { inserted: insertRows.length, skipped }
}

/**
 * Remove the same related records from many source entities in one vectorized call.
 *
 * Query budget (flat wrt N sources and M targets):
 * - 1 read for existing related ids (needed for inverse sync / realtime publish)
 * - 1 batch delete (with RETURNING to get affected entityIds)
 * - 4-6 queries for bulk inverse sync (if configured)
 */
export async function removeRelationValuesBulk(
  ctx: FieldValueContext,
  params: RemoveRelationValuesBulkInput
): Promise<{ removed: number }> {
  const { recordIds, fieldId, relatedRecordIds } = params
  if (recordIds.length === 0 || relatedRecordIds.length === 0) {
    return { removed: 0 }
  }

  const parsed = recordIds.map((rid) => parseRecordId(rid))
  const entityDefinitionId = parsed[0]!.entityDefinitionId
  const entityIds = parsed.map((p) => p.entityInstanceId)
  if (parsed.some((p) => p.entityDefinitionId !== entityDefinitionId)) {
    throw new BadRequestError(
      'removeRelationValuesBulk: all recordIds must share one entityDefinitionId'
    )
  }

  const parsedTargets = relatedRecordIds.map((rid) => parseRecordId(rid))
  const relatedEntityDefinitionId = parsedTargets[0]!.entityDefinitionId
  const uniqueRelatedIds = [...new Set(parsedTargets.map((p) => p.entityInstanceId))]
  if (parsedTargets.some((p) => p.entityDefinitionId !== relatedEntityDefinitionId)) {
    throw new BadRequestError(
      'removeRelationValuesBulk: all relatedRecordIds must share one entityDefinitionId'
    )
  }

  const field = await getField(ctx, fieldId)
  if (field.type !== 'RELATIONSHIP') {
    throw new BadRequestError(
      `removeRelationValuesBulk: field ${fieldId} is not a RELATIONSHIP field (got ${field.type})`
    )
  }

  // Capture existing related ids (needed for inverse sync + realtime publish shape)
  const needsExisting = !params.skipInverseSync || params.skipPublishEvents !== true
  const existingByEntity = needsExisting
    ? await batchGetExistingRelatedIds(
        { db: ctx.db, organizationId: ctx.organizationId },
        entityIds,
        fieldId
      )
    : new Map<string, string[]>()

  // Batch delete with RETURNING to know which entities were affected
  const deleted = await ctx.db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        eq(schema.FieldValue.fieldId, fieldId),
        inArray(schema.FieldValue.entityId, entityIds),
        inArray(schema.FieldValue.relatedEntityId, uniqueRelatedIds)
      )
    )
    .returning({ entityId: schema.FieldValue.entityId })

  if (deleted.length === 0) {
    return { removed: 0 }
  }

  const changedEntitySet = new Set(deleted.map((r) => r.entityId))

  // Inverse sync, bulk
  if (!params.skipInverseSync) {
    const inverseInfo = await getInverseInfoFromField(ctx, field)
    if (inverseInfo) {
      const removedSet = new Set(uniqueRelatedIds)
      const updates: BulkRelationshipUpdate[] = entityIds
        .filter((entityId) => changedEntitySet.has(entityId))
        .map((entityId) => {
          const oldIds = existingByEntity.get(entityId) ?? []
          const newIds = oldIds.filter((id) => !removedSet.has(id))
          return { entityId, oldRelatedIds: oldIds, newRelatedIds: newIds }
        })

      if (updates.length > 0) {
        await syncInverseRelationshipsBulk(
          { db: ctx.db, organizationId: ctx.organizationId },
          { updates, inverseInfo }
        )
      }
    }
  }

  // Field triggers, batched
  if (ctx.userId && params.skipPublishEvents !== true) {
    const triggered = await collectTriggeredFields(ctx.organizationId, [fieldId])
    if (triggered.length > 0) {
      const unique = deduplicateBySystemAttribute(triggered)
      const changedRecordIds = recordIds.filter((_, i) => changedEntitySet.has(entityIds[i]!))
      if (changedRecordIds.length > 0) {
        await publishBatchFieldTriggerEvents(
          { organizationId: ctx.organizationId, userId: ctx.userId },
          unique,
          changedRecordIds
        )
      }
    }
  }

  // Realtime publish, batched (only for entities that actually had deletions)
  if (params.skipPublishEvents !== true) {
    const removedSet = new Set(uniqueRelatedIds)
    const entries = recordIds
      .map((recordId, i) => ({ recordId, entityId: entityIds[i]! }))
      .filter(({ entityId }) => changedEntitySet.has(entityId))
      .map(({ recordId, entityId }) => {
        const oldIds = existingByEntity.get(entityId) ?? []
        const newIds = oldIds.filter((id) => !removedSet.has(id))
        return {
          key: buildFieldValueKey(recordId, fieldId as FieldId),
          value: newIds.map((instanceId) => ({
            recordId: toRecordId(relatedEntityDefinitionId, instanceId),
          })),
        }
      })

    if (entries.length > 0) {
      publishFieldValueUpdates(getRealtimeService(), ctx.organizationId, entries, {
        excludeSocketId: ctx.socketId,
      }).catch(() => {})
    }
  }

  return { removed: deleted.length }
}

// =============================================================================
// OPTION ADD / REMOVE MUTATIONS (MULTI_SELECT)
// =============================================================================

/**
 * Add option values to a multi-value select field (no duplicates).
 * Appends new values after existing ones using fractional indexing.
 *
 * @param ctx - Field value context
 * @param params - Record ID, field ID, and option IDs to add
 */
export async function addOptionValues(
  ctx: FieldValueContext,
  params: {
    recordId: RecordId
    fieldId: string
    optionIds: string[]
  }
): Promise<void> {
  const { recordId, fieldId, optionIds } = params
  if (optionIds.length === 0) return

  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  // Get existing option IDs to avoid duplicates
  const existingRows = await ctx.db
    .select({ optionId: schema.FieldValue.optionId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )

  const existingSet = new Set(existingRows.map((r) => r.optionId).filter(Boolean))
  const newIds = optionIds.filter((id) => !existingSet.has(id))
  if (newIds.length === 0) return

  // Get max sort key for appending
  const existing = await ctx.db
    .select({ sortKey: schema.FieldValue.sortKey })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  // Generate sort keys and insert new values
  let prevKey = existing.length > 0 ? existing[existing.length - 1]!.sortKey : null

  const insertRows = newIds.map((optId) => {
    const sortKey = generateKeyBetween(prevKey, null)
    prevKey = sortKey
    return {
      organizationId: ctx.organizationId,
      entityId: entityInstanceId,
      entityDefinitionId,
      fieldId,
      optionId: optId,
      sortKey,
      valueText: null,
      valueNumber: null,
      valueBoolean: null,
      valueDate: null,
      valueJson: null,
      relatedEntityId: null,
      relatedEntityDefinitionId: null,
      actorId: null,
    }
  })

  await ctx.db.insert(schema.FieldValue).values(insertRows)
}

/**
 * Remove specific option values from a multi-value select field.
 *
 * @param ctx - Field value context
 * @param params - Record ID, field ID, and option IDs to remove
 */
export async function removeOptionValues(
  ctx: FieldValueContext,
  params: {
    recordId: RecordId
    fieldId: string
    optionIds: string[]
  }
): Promise<void> {
  const { recordId, fieldId, optionIds } = params
  if (optionIds.length === 0) return

  const { entityInstanceId } = parseRecordId(recordId)

  await ctx.db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId),
        inArray(schema.FieldValue.optionId, optionIds),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
}

// =============================================================================
// HIGH-LEVEL MUTATIONS
// =============================================================================

/**
 * Set a field value with built-in field support and optional event publishing.
 * Primary entry point for setting field values - handles both built-in and custom fields.
 *
 * @param ctx - Field value context
 * @param params - The SetValueWithBuiltInInput object
 * @returns SetValueResult with state, performedAt, and values array
 */
export async function setValueWithBuiltIn(
  ctx: FieldValueContext,
  params: SetValueWithBuiltInInput
): Promise<SetValueResult> {
  // Stage 1: AI request — short-circuit before value-conversion / uniqueness
  // / typed-write. `ai` takes precedence over `aiGeneration` when both are
  // present (per T3.1c; the commit path cannot also be a request).
  if (params.ai === true) {
    return shortCircuitAiGenerate(ctx, {
      recordId: params.recordId,
      fieldId: params.fieldId,
    })
  }

  const { recordId, fieldId, value, publishEvents = true, skipInverseSync = false } = params

  // Parse RecordId to get both parts
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  // Derive modelType from entityDefinitionId
  const modelType = getModelType(entityDefinitionId)

  // 1. Check if built-in field
  if (isBuiltInField(fieldId, modelType)) {
    const handler = getBuiltInFieldHandler(fieldId, modelType)
    if (!handler) {
      throw new Error(`Built-in field ${fieldId} has no handler`)
    }
    await handler(ctx.db, entityInstanceId, value, ctx.organizationId)

    // Create synthetic TypedFieldValue for frontend store
    const builtInFieldType = getBuiltInFieldType(fieldId, modelType)
    const performedAt = new Date().toISOString()
    if (value !== null && value !== undefined && builtInFieldType) {
      const typedInput = formatToTypedInput(value, builtInFieldType)
      if (typedInput) {
        const syntheticValue = {
          id: `builtin-${fieldId}-${entityInstanceId}`,
          entityId: entityInstanceId,
          fieldId,
          sortKey: '',
          createdAt: performedAt,
          updatedAt: performedAt,
          ...typedInput,
        } as TypedFieldValue
        return { state: 'complete', performedAt, values: [syntheticValue] }
      }
    }

    return { state: 'complete', performedAt, values: [] }
  }

  // 2. Get field definition (cached)
  const field = await getField(ctx, fieldId)

  // 3. Validate and convert raw value to typed input using FieldValueValidator
  const typedValue = await validateAndConvertValue(ctx, value, field.type, field)

  // Handle null values (deletion)
  if (typedValue === null) {
    await deleteValue(ctx, { recordId, fieldId })
    await maybeUpdateDisplayValue(ctx, recordId, field, null)
    if (publishEvents) {
      const key = buildFieldValueKey(recordId, fieldId as FieldId)
      publishFieldValueUpdates(getRealtimeService(), ctx.organizationId, [{ key, value: null }], {
        excludeSocketId: ctx.socketId,
      }).catch(() => {})
    }
    return { state: 'complete', performedAt: new Date().toISOString(), values: [] }
  }

  // 4. Check uniqueness if applicable (if field has unique constraint)
  if (field.isUnique && typedValue !== null) {
    await checkUniqueValueTyped(
      {
        fieldId,
        value: typedValue,
        organizationId: ctx.organizationId,
        modelType,
        entityDefinitionId: field.entityDefinitionId,
        excludeEntityId: entityInstanceId,
      },
      ctx.db
    )
  }

  // 5. Get old value for event (only if publishing for contacts)
  let oldValue: TypedFieldValue | TypedFieldValue[] | null = null
  if (publishEvents && modelType === 'contact') {
    oldValue = await getValue(ctx, { recordId, fieldId })
  }

  // 6. Set the value
  const result = await setValueWithType(ctx, {
    recordId,
    fieldId,
    fieldType: field.type as FieldType,
    value: typedValue,
    skipInverseSync,
    aiGeneration: params.aiGeneration,
  })

  // 7. Publish event for contacts (use first value for event compat)
  if (publishEvents && modelType === 'contact' && ctx.userId) {
    await publisher.publishLater({
      type: 'contact:field:updated',
      data: {
        contactId: entityInstanceId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        fieldId: field.id,
        fieldName: field.name,
        fieldType: field.type,
        oldValue,
        newValue: result[0] ?? null,
      },
    } as ContactFieldUpdatedEvent)
  }

  // 8. Check for field triggers (only when publishing events, to avoid double-fire from setBulkValues)
  if (publishEvents && ctx.userId) {
    const triggeredFields = await collectTriggeredFields(ctx.organizationId, [fieldId])
    if (triggeredFields.length > 0) {
      await publishFieldTriggerEvents(
        { organizationId: ctx.organizationId, userId: ctx.userId },
        triggeredFields,
        recordId
      )
    }
  }

  // Publish realtime sync event (sync mutation — exclude originator)
  // Gated on publishEvents so setBulkValues can batch-publish instead.
  // Shape depends on field type: array-return fields (FILE, TAGS, MULTI_SELECT,
  // RELATIONSHIP, multi-ACTOR) always publish arrays so subscribers can write
  // directly to the store without guessing. Single-value fields publish the
  // single value.
  if (publishEvents && result.length > 0) {
    const key = buildFieldValueKey(recordId, fieldId as FieldId)
    const fieldType = field.type as FieldType
    const fieldOptions = field.options as { actor?: { multiple?: boolean } } | undefined
    const storeValue = isArrayReturnFieldType(fieldType, fieldOptions) ? result : result[0]
    // When this write is an AI stage-2 commit, piggyback the `result`
    // marker onto the same realtime so clients see value + AI state in
    // one message. Manual writes carry aiStatus=null to clear any prior
    // marker in peer stores.
    publishFieldValueUpdates(
      getRealtimeService(),
      ctx.organizationId,
      [
        params.aiGeneration
          ? {
              key,
              value: storeValue,
              aiStatus: 'result',
              aiMetadata: params.aiGeneration,
            }
          : { key, value: storeValue, aiStatus: null, aiMetadata: null },
      ],
      { excludeSocketId: ctx.socketId }
    ).catch(() => {})
  }

  // Always return arrays with state and timestamp
  return {
    state: 'complete',
    performedAt: new Date().toISOString(),
    values: result,
  }
}

/**
 * Set multiple field values for a single entity in an optimized batch operation.
 * Preferred method when setting 2+ fields on the same entity.
 *
 * @param ctx - Field value context
 * @param params - The SetValuesForEntityInput object
 * @returns Array of SetValuesResult (one per field)
 */
export async function setValuesForEntity(
  ctx: FieldValueContext,
  params: SetValuesForEntityInput
): Promise<SetValuesResult[]> {
  const { recordId, values, publishEvents = true, skipInverseSync = false } = params

  // Parse RecordId to get both parts and derive modelType
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const modelType = getModelType(entityDefinitionId)

  // Filter out undefined values and resolve any systemAttribute strings to real fieldIds
  const validValues = await resolveFieldIds(
    ctx.organizationId,
    values.filter((v) => v.value !== undefined)
  )
  if (validValues.length === 0) return []

  // Separate built-in from custom fields
  const builtIns: typeof validValues = []
  const customs: typeof validValues = []

  for (const v of validValues) {
    if (isBuiltInField(v.fieldId, modelType)) {
      builtIns.push(v)
    } else {
      customs.push(v)
    }
  }

  const results: SetValuesResult[] = []

  // Handle built-in fields
  for (const v of builtIns) {
    const handler = getBuiltInFieldHandler(v.fieldId, modelType)
    if (handler) {
      await handler(ctx.db, entityInstanceId, v.value, ctx.organizationId)
    }

    // Create synthetic TypedFieldValue for frontend store
    const builtInFieldType = getBuiltInFieldType(v.fieldId, modelType)
    if (v.value !== null && v.value !== undefined && builtInFieldType) {
      const typedInput = formatToTypedInput(v.value, builtInFieldType)
      if (typedInput) {
        const performedAt = new Date().toISOString()
        const syntheticValue = {
          id: `builtin-${v.fieldId}-${entityInstanceId}`,
          entityId: entityInstanceId,
          fieldId: v.fieldId,
          sortKey: '',
          createdAt: performedAt,
          updatedAt: performedAt,
          ...typedInput,
        } as TypedFieldValue
        results.push({
          fieldId: v.fieldId,
          state: 'complete',
          performedAt,
          values: [syntheticValue],
        })
        continue
      }
    }

    results.push({
      fieldId: v.fieldId,
      state: 'complete',
      performedAt: new Date().toISOString(),
      values: [],
    })
  }

  // Handle custom fields - batch prefetch all field definitions and validate relationships
  if (customs.length > 0) {
    // Load all fields for this entity definition in one cache read
    const fieldMap = await getCachedFieldMap(ctx.organizationId, entityDefinitionId)
    const resource = await getCachedResource(ctx.organizationId, entityDefinitionId)

    const entityDefinition = resource
      ? {
          id: resource.entityDefinitionId ?? resource.id,
          primaryDisplayFieldId: resource.display.primaryDisplayField?.id ?? null,
          secondaryDisplayFieldId: resource.display.secondaryDisplayField?.id ?? null,
          avatarFieldId: resource.display.avatarField?.id ?? null,
        }
      : null

    // Warm ctx.fieldCache for all custom fields in one pass
    for (const v of customs) {
      const f = fieldMap.get(v.fieldId)
      if (f) ctx.fieldCache.set(v.fieldId, { ...f, entityDefinition })
    }

    // Pre-batch validate all relationships (fills cache for later)
    const fieldTypes = customs.map((c) => {
      const field = ctx.fieldCache.get(c.fieldId)
      return field?.type ?? 'TEXT'
    })
    await preBatchValidateRelationships(
      ctx,
      customs.map((c) => c.value),
      fieldTypes
    )

    // Now set each value (will use cached field definitions and relationship validations)
    for (const v of customs) {
      try {
        const result = await setValueWithBuiltIn(ctx, {
          recordId,
          fieldId: v.fieldId,
          value: v.value,
          publishEvents,
          skipInverseSync,
        })

        results.push({ fieldId: v.fieldId, ...result })
      } catch (error) {
        // Log but continue with other fields
        console.error(`Failed to set field ${v.fieldId}:`, error)
        results.push({
          fieldId: v.fieldId,
          state: 'failed',
          performedAt: new Date().toISOString(),
          values: [],
        })
      }
    }
  }

  return results
}

/**
 * Set the same field values for multiple entities in a resilient batch operation.
 * Uses Promise.allSettled to handle failures gracefully without blocking other updates.
 *
 * @param ctx - Field value context
 * @param params - The SetBulkValuesInput object
 * @returns Object with count of successfully updated entities
 */
export async function setBulkValues(
  ctx: FieldValueContext,
  params: SetBulkValuesInput
): Promise<{ count: number }> {
  const { recordIds, values } = params

  if (recordIds.length === 0 || values.length === 0) {
    return { count: 0 }
  }

  // AI stage-1 bulk: fan out short-circuit calls per (recordId, fieldId)
  // pair. Each call runs its own eligibility check, quota consume, upsert,
  // enqueue, and realtime publish. Failures on individual pairs do not
  // abort siblings (Promise.allSettled semantics, matching the normal
  // bulk-write path).
  if (params.ai === true) {
    const pairs = recordIds.flatMap((recordId) =>
      values.map((v) => ({ recordId, fieldId: v.fieldId }))
    )
    const results = await Promise.allSettled(
      pairs.map((pair) =>
        setValueWithBuiltIn(ctx, {
          recordId: pair.recordId,
          fieldId: pair.fieldId,
          value: null,
          ai: true,
        })
      )
    )
    const count = results.filter((r) => r.status === 'fulfilled').length
    return { count }
  }

  // Parse RecordIds and derive modelType from first one (all should be same type in bulk)
  const parsedResources = recordIds.map((rid) => parseRecordId(rid))
  const entityInstanceIds = parsedResources.map((p) => p.entityInstanceId)
  const modelType = getModelType(parsedResources[0]!.entityDefinitionId)

  // Filter out undefined values and resolve any systemAttribute strings to real fieldIds
  const validValues = await resolveFieldIds(
    ctx.organizationId,
    values.filter((v) => v.value !== undefined)
  )
  if (validValues.length === 0) {
    return { count: 0 }
  }

  // Load all fields for this entity definition in one cache read
  const entityDefinitionId = parsedResources[0]!.entityDefinitionId
  const fieldMap = await getCachedFieldMap(ctx.organizationId, entityDefinitionId)
  const resource = await getCachedResource(ctx.organizationId, entityDefinitionId)

  const entityDefinition = resource
    ? {
        id: resource.entityDefinitionId ?? resource.id,
        primaryDisplayFieldId: resource.display.primaryDisplayField?.id ?? null,
        secondaryDisplayFieldId: resource.display.secondaryDisplayField?.id ?? null,
        avatarFieldId: resource.display.avatarField?.id ?? null,
      }
    : null

  // Warm ctx.fieldCache for all custom fields in one pass
  const customFieldIds = validValues
    .filter((v) => !isBuiltInField(v.fieldId, modelType))
    .map((v) => v.fieldId)
  for (const fieldId of customFieldIds) {
    const f = fieldMap.get(fieldId)
    if (f) ctx.fieldCache.set(fieldId, { ...f, entityDefinition })
  }

  // Identify relationship fields and prepare for bulk sync
  const relationshipFields: Array<{
    fieldId: string
    field: CachedField
    inverseInfo: InverseFieldInfo
    rawValue: unknown
  }> = []

  for (const v of validValues) {
    const field = ctx.fieldCache.get(v.fieldId)
    if (field?.type === 'RELATIONSHIP') {
      const inverseInfo = await getInverseInfoFromField(ctx, field)
      if (inverseInfo) {
        relationshipFields.push({ fieldId: v.fieldId, field, inverseInfo, rawValue: v.value })
      }
    }
  }

  // Batch capture old relationship values (1 query per relationship field)
  const oldRelatedIdsMap = new Map<string, Map<string, string[]>>() // fieldId → (entityId → oldIds[])

  for (const rf of relationshipFields) {
    const oldIds = await batchGetExistingRelatedIds(
      { db: ctx.db, organizationId: ctx.organizationId },
      entityInstanceIds,
      rf.fieldId
    )
    oldRelatedIdsMap.set(rf.fieldId, oldIds)
  }

  // Set values for all entities in parallel
  // Skip inverse sync here - we'll do bulk sync at the end
  const results = await Promise.allSettled(
    recordIds.map((recordId) =>
      setValuesForEntity(ctx, {
        recordId,
        values: validValues,
        publishEvents: false, // Don't spam events for bulk operations
        skipInverseSync: true, // Bulk sync handled separately below
      })
    )
  )

  // Bulk sync inverse relationships (aggregated across all entities)
  for (const rf of relationshipFields) {
    const oldIdsForField = oldRelatedIdsMap.get(rf.fieldId)
    if (!oldIdsForField) continue

    // Extract new related IDs from the raw value
    const newRelatedIds = extractRelatedIdsFromRaw(rf.rawValue)

    // Build bulk updates array
    const updates: BulkRelationshipUpdate[] = entityInstanceIds.map((entityId) => ({
      entityId,
      oldRelatedIds: oldIdsForField.get(entityId) ?? [],
      newRelatedIds, // Same new value for all entities in bulk operation
    }))

    // Execute bulk sync (minimal queries)
    await syncInverseRelationshipsBulk(
      { db: ctx.db, organizationId: ctx.organizationId },
      { updates, inverseInfo: rf.inverseInfo }
    )
  }

  // Fire batched field triggers for all affected fields across all records
  if (ctx.userId) {
    const customFieldIds = validValues
      .filter((v) => !isBuiltInField(v.fieldId, modelType))
      .map((v) => v.fieldId)
    const triggeredFields = await collectTriggeredFields(ctx.organizationId, customFieldIds)
    if (triggeredFields.length > 0) {
      const uniqueTriggers = deduplicateBySystemAttribute(triggeredFields)
      await publishBatchFieldTriggerEvents(
        { organizationId: ctx.organizationId, userId: ctx.userId },
        uniqueTriggers,
        recordIds
      )
    }
  }

  const count = results.filter((r) => r.status === 'fulfilled').length

  // Batch publish realtime sync for all successful field value changes.
  // Shape depends on field type: array-return fields always publish arrays.
  const entries: Array<{ key: ReturnType<typeof buildFieldValueKey>; value: unknown }> = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result?.status !== 'fulfilled') continue
    const recordId = recordIds[i]!
    for (const fieldResult of result.value) {
      if (fieldResult.state !== 'complete' || fieldResult.values.length === 0) continue
      const key = buildFieldValueKey(recordId, fieldResult.fieldId as FieldId)
      const cachedField = ctx.fieldCache.get(fieldResult.fieldId)
      const fieldType = cachedField?.type as FieldType | undefined
      const fieldOptions = cachedField?.options as { actor?: { multiple?: boolean } } | undefined
      const isArrayReturn = fieldType ? isArrayReturnFieldType(fieldType, fieldOptions) : false
      entries.push({
        key,
        value: isArrayReturn ? fieldResult.values : fieldResult.values[0],
      })
    }
  }
  if (entries.length > 0) {
    publishFieldValueUpdates(getRealtimeService(), ctx.organizationId, entries, {
      excludeSocketId: ctx.socketId,
    }).catch(() => {})
  }

  return { count }
}

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/**
 * Extract related entity IDs from a raw relationship value.
 * Handles various input formats (RecordId, string, object, array).
 * Supports both new recordId format and legacy relatedEntityId format.
 */
export function extractRelatedIdsFromRaw(value: unknown): string[] {
  if (!value) return []

  /** Helper to extract entity instance ID from a single value */
  const extractSingle = (v: unknown): string | null => {
    if (!v) return null
    // RecordId string
    if (typeof v === 'string' && isRecordId(v)) {
      return parseRecordId(v as RecordId).entityInstanceId
    }
    // Plain string (instance ID)
    if (typeof v === 'string') return v
    // New format: { recordId }
    if (typeof v === 'object' && 'recordId' in v) {
      return parseRecordId((v as { recordId: RecordId }).recordId).entityInstanceId
    }
    // Legacy format: { relatedEntityId }
    if (typeof v === 'object' && 'relatedEntityId' in v) {
      return (v as { relatedEntityId: string }).relatedEntityId
    }
    return null
  }

  if (Array.isArray(value)) {
    return value.map(extractSingle).filter((id): id is string => id !== null)
  }

  const single = extractSingle(value)
  return single ? [single] : []
}

/**
 * Set single-value field using UPSERT strategy.
 * Checks if row exists, then UPDATE or INSERT.
 */
async function setSingleValue(
  ctx: FieldValueContext,
  recordId: RecordId,
  fieldId: string,
  fieldType: FieldType,
  value: TypedFieldValueInput | TypedFieldValueInput[]
): Promise<TypedFieldValue[]> {
  const { entityInstanceId } = parseRecordId(recordId)
  const singleValue = Array.isArray(value) ? value[0] : value
  if (!singleValue) return []

  // Check if row exists
  const existingResult = await getExistingFieldValue({
    entityId: entityInstanceId,
    fieldId,
    organizationId: ctx.organizationId,
  })

  if (existingResult.isErr()) {
    throw new Error(existingResult.error.message)
  }

  const existing = existingResult.value

  if (existing) {
    // UPDATE existing row
    const updateData = buildUpdateData(singleValue)
    const updatedResult = await updateFieldValue({
      id: existing.id,
      organizationId: ctx.organizationId,
      ...updateData,
    })

    if (updatedResult.isErr()) {
      throw new Error(updatedResult.error.message)
    }

    return [rowToTypedValue(updatedResult.value as unknown as FieldValueRow, fieldType)]
  } else {
    // INSERT new row - pass recordId to buildInsertData
    const insertData = buildInsertData(fieldType, singleValue)
    const insertedResult = await insertFieldValue({
      recordId,
      fieldId,
      organizationId: ctx.organizationId,
      sortKey: generateKeyBetween(null, null),
      ...insertData,
    })

    if (insertedResult.isErr()) {
      throw new Error(insertedResult.error.message)
    }

    return [rowToTypedValue(insertedResult.value as unknown as FieldValueRow, fieldType)]
  }
}

/**
 * Set multi-value field using DELETE+INSERT strategy.
 */
async function setMultiValue(
  ctx: FieldValueContext,
  recordId: RecordId,
  fieldId: string,
  fieldType: FieldType,
  value: TypedFieldValueInput | TypedFieldValueInput[]
): Promise<TypedFieldValue[]> {
  const { entityInstanceId } = parseRecordId(recordId)
  const values = Array.isArray(value) ? value : [value]

  // DELETE all existing
  const deleteResult = await deleteFieldValues({
    entityId: entityInstanceId,
    fieldId,
    organizationId: ctx.organizationId,
  })

  if (deleteResult.isErr()) {
    throw new Error(deleteResult.error.message)
  }

  if (values.length === 0) return []

  // Build insert rows with sortKeys - pass recordId
  const insertInputs = values.map((v, index) => ({
    recordId,
    fieldId,
    organizationId: ctx.organizationId,
    sortKey: generateKeyBetween(index === 0 ? null : `a${index - 1}`, null),
    ...buildInsertData(fieldType, v),
  }))

  const insertedResult = await batchInsertFieldValues(insertInputs)

  if (insertedResult.isErr()) {
    throw new Error(insertedResult.error.message)
  }

  const result = insertedResult.value.map((row) =>
    rowToTypedValue(row as unknown as FieldValueRow, fieldType)
  )

  return result
}

/**
 * Build insert data from typed value input (for service layer).
 * Converts recordId back to two DB columns for relationship type.
 */
function buildInsertData(
  _fieldType: FieldType,
  value: TypedFieldValueInput
): {
  valueText?: string | null
  valueNumber?: number | null
  valueBoolean?: boolean | null
  valueDate?: string | null
  valueJson?: unknown | null
  optionId?: string | null
  relatedEntityId?: string | null
  relatedEntityDefinitionId?: string | null
  actorId?: string | null
} {
  switch (value.type) {
    case 'text':
      return { valueText: value.value }
    case 'number':
      return { valueNumber: value.value }
    case 'boolean':
      return { valueBoolean: value.value }
    case 'date':
      return {
        valueDate: value.value instanceof Date ? value.value.toISOString() : value.value,
      }
    case 'json':
      return { valueJson: value.value }
    case 'option':
      return { optionId: value.optionId }
    case 'relationship': {
      // Parse recordId back to two DB columns
      const { entityDefinitionId, entityInstanceId } = parseRecordId(value.recordId)
      return {
        relatedEntityId: entityInstanceId,
        relatedEntityDefinitionId: entityDefinitionId,
      }
    }
    case 'actor': {
      if (value.actorType === 'user') {
        // User actor - store in actorId column
        return { actorId: value.id }
      } else {
        // Group actor - store in relatedEntityId/relatedEntityDefinitionId
        // Note: entityDefinitionId for groups should be passed in field options
        return {
          relatedEntityId: value.id,
          // relatedEntityDefinitionId will be set from field options if needed
        }
      }
    }
  }
}

/**
 * Build update data from typed value input (for service layer).
 * Converts recordId back to two DB columns for relationship type.
 */
function buildUpdateData(value: TypedFieldValueInput): {
  valueText?: string | null
  valueNumber?: number | null
  valueBoolean?: boolean | null
  valueDate?: string | null
  valueJson?: unknown | null
  optionId?: string | null
  relatedEntityId?: string | null
  relatedEntityDefinitionId?: string | null
  actorId?: string | null
} {
  // Same structure as insert data (fieldType not needed for structure)
  switch (value.type) {
    case 'text':
      return { valueText: value.value }
    case 'number':
      return { valueNumber: value.value }
    case 'boolean':
      return { valueBoolean: value.value }
    case 'date':
      return {
        valueDate: value.value instanceof Date ? value.value.toISOString() : value.value,
      }
    case 'json':
      return { valueJson: value.value }
    case 'option':
      return { optionId: value.optionId }
    case 'relationship': {
      // Parse recordId back to two DB columns
      const { entityDefinitionId, entityInstanceId } = parseRecordId(value.recordId)
      return {
        relatedEntityId: entityInstanceId,
        relatedEntityDefinitionId: entityDefinitionId,
      }
    }
    case 'actor': {
      if (value.actorType === 'user') {
        // User actor - store in actorId column
        return { actorId: value.id }
      } else {
        // Group actor - store in relatedEntityId/relatedEntityDefinitionId
        return {
          relatedEntityId: value.id,
        }
      }
    }
  }
}

/**
 * Build a FieldValue insert row from typed input (for direct DB insert).
 * Exported for use in batch inserts (e.g., BOM explosion trigger).
 */
export function buildFieldValueRow(params: {
  organizationId: string
  entityId: string
  entityDefinitionId: string
  fieldId: string
  value: TypedFieldValueInput
  sortKey?: string
}): typeof schema.FieldValue.$inferInsert {
  const { organizationId, entityId, entityDefinitionId, fieldId, value, sortKey = 'a' } = params

  const base = {
    organizationId,
    entityId,
    entityDefinitionId,
    fieldId,
    sortKey,
    valueText: null as string | null,
    valueNumber: null as number | null,
    valueBoolean: null as boolean | null,
    valueDate: null as string | null,
    valueJson: null as unknown,
    optionId: null as string | null,
    relatedEntityId: null as string | null,
    relatedEntityDefinitionId: null as string | null,
    actorId: null as string | null,
  }

  switch (value.type) {
    case 'text':
      return { ...base, valueText: value.value }
    case 'number':
      return { ...base, valueNumber: value.value }
    case 'boolean':
      return { ...base, valueBoolean: value.value }
    case 'date':
      return {
        ...base,
        valueDate: value.value instanceof Date ? value.value.toISOString() : value.value,
      }
    case 'json':
      return { ...base, valueJson: value.value }
    case 'option':
      return { ...base, optionId: value.optionId }
    case 'relationship': {
      // Parse recordId back to two DB columns
      const { entityDefinitionId: relDefId, entityInstanceId: relInstId } = parseRecordId(
        value.recordId
      )
      return {
        ...base,
        relatedEntityId: relInstId,
        relatedEntityDefinitionId: relDefId,
      }
    }
    case 'actor': {
      if (value.actorType === 'user') {
        // User actor - store in actorId column
        return { ...base, actorId: value.id }
      } else {
        // Group actor - store in relatedEntityId
        return { ...base, relatedEntityId: value.id }
      }
    }
  }
}
