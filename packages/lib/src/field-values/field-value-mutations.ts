// packages/lib/src/field-values/field-value-mutations.ts

import { schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import {
  batchInsertFieldValues,
  deleteFieldValues,
  type FieldWithDefinition,
  getExistingFieldValue,
  insertFieldValue,
  updateFieldValue,
} from '@auxx/services'
import { isMultiValueFieldType, type TypedFieldValue, type TypedFieldValueInput } from '@auxx/types'
import { isSelfReferentialRelationship, type RelationshipConfig } from '@auxx/types/custom-field'
import type { RecordId } from '@auxx/types/resource'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, asc, eq } from 'drizzle-orm'
import {
  getBuiltInFieldHandler,
  getBuiltInFieldType,
  isBuiltInField,
} from '../custom-fields/built-in-fields'
import { checkUniqueValueTyped } from '../custom-fields/check-unique-value-typed'
import { publisher } from '../events'
import type { ContactFieldUpdatedEvent } from '../events/types'
import { getModelType, isRecordId, parseRecordId } from '../resources/resource-id'
import {
  type FieldValueContext,
  getField,
  getInverseInfoFromField,
  type InverseFieldInfo,
  maybeUpdateDisplayValue,
  preBatchValidateRelationships,
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
  AddValueInput,
  DeleteValueInput,
  FieldValueRow,
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
    field: FieldWithDefinition
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
  const typedInput = formatToTypedInput(value, fieldType, {
    selectOptions: field.options as { id?: string; value: string; label: string }[] | undefined,
    fieldOptions,
  })

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
  const { recordId, fieldId, fieldType, value, skipInverseSync = false } = params

  // Parse RecordId to get both parts for DB queries
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  // Get field definition for displayName update (cached)
  const field = await getField(ctx, fieldId)

  // For relationships: validate self-referential constraints, capture old values, get inverse info
  let oldRelatedIds: string[] = []
  let inverseInfo: InverseFieldInfo | null = null

  if (fieldType === 'RELATIONSHIP') {
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

  // Generate sort keys for each value - pass recordId to buildInsertRow
  const insertRows = values.map((v, index) => {
    const sortKey = generateKeyBetween(index === 0 ? null : `a${index - 1}`, null)
    return buildInsertRow(ctx, recordId, fieldId, fieldType, v, sortKey)
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

  const insertRow = buildInsertRow(ctx, recordId, fieldId, fieldType, value, sortKey)

  const [inserted] = await ctx.db.insert(schema.FieldValue).values(insertRow).returning()

  return rowToTypedValue(inserted as unknown as FieldValueRow, fieldType)
}

/**
 * Remove a single value from a multi-value field by its FieldValue ID.
 *
 * @param ctx - Field value context
 * @param valueId - The FieldValue record ID (UUID)
 */
export async function removeValue(ctx: FieldValueContext, valueId: string): Promise<void> {
  await ctx.db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.id, valueId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
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
  const typedValue = await validateAndConvertValue(ctx, value, field.type, field as any)

  // Handle null values (deletion)
  if (typedValue === null) {
    await deleteValue(ctx, { recordId, fieldId })
    await maybeUpdateDisplayValue(ctx, recordId, field, null)
    return { state: 'complete', performedAt: new Date().toISOString(), values: [] }
  }

  // 4. Check uniqueness if applicable (if field has unique constraint)
  if ((field as any).isUnique && typedValue !== null) {
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

  // Filter out undefined values
  const validValues = values.filter((v) => v.value !== undefined)
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
    // Prefetch all fields (fills cache)
    await Promise.all(customs.map((v) => getField(ctx, v.fieldId).catch(() => null)))

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

  // Parse RecordIds and derive modelType from first one (all should be same type in bulk)
  const parsedResources = recordIds.map((rid) => parseRecordId(rid))
  const entityInstanceIds = parsedResources.map((p) => p.entityInstanceId)
  const modelType = getModelType(parsedResources[0]!.entityDefinitionId)

  // Filter out undefined values
  const validValues = values.filter((v) => v.value !== undefined)
  if (validValues.length === 0) {
    return { count: 0 }
  }

  // Prefetch all field definitions once (outside the loop)
  const customFieldIds = validValues
    .filter((v) => !isBuiltInField(v.fieldId, modelType))
    .map((v) => v.fieldId)
  const uniqueFieldIds = [...new Set(customFieldIds)]
  await Promise.all(uniqueFieldIds.map((id) => getField(ctx, id).catch(() => null)))

  // Identify relationship fields and prepare for bulk sync
  const relationshipFields: Array<{
    fieldId: string
    field: FieldWithDefinition
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

  const count = results.filter((r) => r.status === 'fulfilled').length
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
 */
function buildInsertRow(
  ctx: FieldValueContext,
  recordId: RecordId,
  fieldId: string,
  _fieldType: FieldType,
  value: TypedFieldValueInput,
  sortKey: string
) {
  // Split RecordId at DB boundary
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const base = {
    organizationId: ctx.organizationId,
    entityId: entityInstanceId,
    entityDefinitionId: entityDefinitionId,
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
