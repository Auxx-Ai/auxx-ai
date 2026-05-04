// packages/lib/src/field-values/field-value-mutations.ts

import { schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
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
import { isSystemAttribute } from '@auxx/types/system-attribute'
import { generateId } from '@auxx/utils'
import {
  generateKeyBetween,
  isValidOrderKey,
  nextKeyAfter,
  nKeysAfter,
} from '@auxx/utils/fractional-indexing'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { getCachedFieldMap, getCachedResource } from '../cache'
import {
  getBuiltInFieldHandler,
  getBuiltInFieldType,
  isBuiltInField,
} from '../custom-fields/built-in-fields'
import { checkUniqueValueTyped } from '../custom-fields/check-unique-value-typed'
import { BadRequestError } from '../errors'
import {
  collectTriggeredFields,
  deduplicateBySystemAttribute,
} from '../field-hooks/collect-triggers'
import { publishBatchFieldTriggerEvents, publishFieldTriggerEvents } from '../field-hooks/publish'
import {
  getEntityFieldChangeHooks,
  getFieldPreHooks,
  hasEntityFieldChangeHooks,
  hasFieldPreHooks,
} from '../field-hooks/registry'
import type { FieldPreHookEvent } from '../field-hooks/types'
import { getRealtimeService, publishFieldValueUpdates } from '../realtime'
import { getModelType, isRecordId, parseRecordId, toRecordId } from '../resources/resource-id'
import { applyAiMarker } from './ai-commit'
import { shortCircuitAiGenerate } from './ai-enqueue'
import { batchGetExistingFieldValues } from './batch-existing-values'
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
import {
  type BulkSnapshotWrite,
  preloadSnapshotCache,
  resolveFieldChangeSnapshotPair,
  resolveFieldChangeSnapshotsBulk,
} from './timeline-snapshot'
import { type TypedColumnMatch, typedColumnMatch } from './typed-column-match'
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

const logger = createScopedLogger('field-value-mutations')

// =============================================================================
// FIELD PRE-HOOKS
// =============================================================================

/**
 * Outcome of running the per-field pre-hook chain for a single
 * `(recordId, fieldId)` write.
 */
type FieldPreHookOutcome =
  | { kind: 'continue'; value: TypedFieldValueInput | TypedFieldValueInput[] | null }
  | { kind: 'drop' }

/**
 * Fire the registered pre-hook chain for `(entitySlug, systemAttribute)` and
 * return the (possibly transformed) typed value, or signal the caller to
 * drop this write. Throws propagate to the caller.
 *
 * Hooks fire AFTER coercion (`validateAndConvertValue`) and BEFORE the
 * null-delete branch / uniqueness check / typed write — so guards observe
 * `newValue === null` clear-attempts and dropped writes never spend a
 * uniqueness query.
 *
 * Returns `{ kind: 'continue', value: typedValue }` when:
 *   - `ctx.skipPreHooks` is set (bulk fan-out)
 *   - the field has no `systemAttribute` (custom fields without a system
 *     attribute can't be addressed by the registry)
 *   - the systemAttribute is in `ctx.bypassFieldGuards`
 *   - no hooks are registered for the `(entitySlug, systemAttribute)` pair
 */
async function fireFieldPreHooks(
  ctx: FieldValueContext,
  args: {
    recordId: RecordId
    field: CachedField
    typedValue: TypedFieldValueInput | TypedFieldValueInput[] | null
    existingValue: unknown
    allValues: ReadonlyMap<string, unknown>
    /** Pre-resolved entitySlug. When provided, skips the cache lookup. */
    entitySlug?: string
    /** Pre-resolved entityType. When provided, skips the cache lookup. */
    entityType?: string | null
  }
): Promise<FieldPreHookOutcome> {
  if (ctx.skipPreHooks) return { kind: 'continue', value: args.typedValue }
  const sysAttrRaw = args.field.systemAttribute
  if (!sysAttrRaw) return { kind: 'continue', value: args.typedValue }
  if (!isSystemAttribute(sysAttrRaw)) return { kind: 'continue', value: args.typedValue }
  const systemAttribute = sysAttrRaw
  if (ctx.bypassFieldGuards.has(systemAttribute)) {
    return { kind: 'continue', value: args.typedValue }
  }

  const entityDefinitionId = args.field.entityDefinition?.id ?? args.field.entityDefinitionId
  if (!entityDefinitionId) return { kind: 'continue', value: args.typedValue }

  let entitySlug = args.entitySlug
  let entityType = args.entityType
  if (entitySlug === undefined || entityType === undefined) {
    const resource = await getCachedResource(ctx.organizationId, entityDefinitionId)
    entitySlug = resource?.apiSlug
    entityType = resource?.entityType ?? null
  }
  if (!entitySlug) return { kind: 'continue', value: args.typedValue }

  if (!hasFieldPreHooks(entitySlug, systemAttribute)) {
    return { kind: 'continue', value: args.typedValue }
  }

  const hooks = getFieldPreHooks(entitySlug, systemAttribute)
  const event: Omit<FieldPreHookEvent, 'newValue'> = {
    recordId: args.recordId,
    entityDefinitionId,
    entityType,
    entitySlug,
    fieldId: args.field.id,
    systemAttribute,
    field: args.field,
    existingValue: args.existingValue,
    allValues: args.allValues,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    bypass: ctx.bypassFieldGuards,
  }

  let value: unknown = args.typedValue
  for (const hook of hooks) {
    value = await hook({ ...event, newValue: value })
    if (value === undefined) return { kind: 'drop' }
  }
  return {
    kind: 'continue',
    value: value as TypedFieldValueInput | TypedFieldValueInput[] | null,
  }
}

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
  const fieldOptions = field.options as
    | { actor?: { multiple?: boolean }; multi?: boolean }
    | undefined
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
  const sortKeys = nKeysAfter(null, values.length)
  const insertRows = values.map((v, index) => {
    const baseRow = buildFieldValueRow({
      organizationId: ctx.organizationId,
      entityId: entityInstanceId,
      entityDefinitionId,
      fieldId,
      value: v,
      sortKey: sortKeys[index]!,
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
  // existing[].sortKey may be a legacy/corrupt value; `nextKeyAfter`
  // degrades to 'a0' rather than throwing. For 'start'/'between' positions
  // we still need a strict generateKeyBetween call — if the surrounding key
  // is corrupt, fall back to appending at the end.
  let sortKey: string
  if (existing.length === 0) {
    sortKey = nextKeyAfter(null)
  } else if (position === 'start') {
    const firstKey = existing[0]!.sortKey
    sortKey = isValidOrderKey(firstKey) ? generateKeyBetween(null, firstKey) : nextKeyAfter(null)
  } else if (position === 'end') {
    sortKey = nextKeyAfter(existing[existing.length - 1]!.sortKey)
  } else {
    // Insert after specific value
    const afterIndex = existing.findIndex((e) => e.sortKey === position.after)
    if (afterIndex === -1) {
      sortKey = nextKeyAfter(existing[existing.length - 1]!.sortKey)
    } else {
      const afterKey = existing[afterIndex]!.sortKey
      const beforeKey = existing[afterIndex + 1]?.sortKey ?? null
      if (isValidOrderKey(afterKey) && (beforeKey == null || isValidOrderKey(beforeKey))) {
        sortKey = generateKeyBetween(afterKey, beforeKey)
      } else {
        sortKey = nextKeyAfter(existing[existing.length - 1]!.sortKey)
      }
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

  // Generate sort keys and insert new values. `nextKeyAfter` tolerates a
  // corrupt prevKey from the DB (degrades to 'a0') rather than throwing.
  const { entityDefinitionId } = parseRecordId(recordId)
  let prevKey: string | null = existing.length > 0 ? existing[existing.length - 1]!.sortKey : null

  const insertRows = newIds.map((relatedId) => {
    const sortKey = nextKeyAfter(prevKey)
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
    // `nextKeyAfter` tolerates a corrupt MAX from the DB by degrading to 'a0'.
    const sortKey = nextKeyAfter(prevKey)
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
// GENERIC MULTI-VALUE ADD / REMOVE
// Works for MULTI_SELECT/TAGS (option), scalar-multi (TEXT/NUMBER/…), ACTOR,
// and FILE. Relationship fields use addRelationValues* for inverse-sync.
// =============================================================================

// `TypedColumnMatch` + `typedColumnMatch` live in ./typed-column-match so
// read-path callers (e.g. UnifiedCrudHandler.lookupByField) can share the
// same column-routing logic without pulling in the mutation surface.

/**
 * Serialize an existing row's value column into the same string shape
 * `typedColumnMatch` returns — lets us dedup new inputs against existing
 * rows with a plain Set lookup.
 */
function serializeRowMatch(row: FieldValueRow, column: TypedColumnMatch['column']): string | null {
  const raw = (row as unknown as Record<string, unknown>)[column]
  if (raw === null || raw === undefined) return null
  if (column === 'valueJson') return JSON.stringify(raw)
  if (column === 'valueBoolean') return String(raw)
  if (column === 'valueNumber') return String(raw)
  return String(raw)
}

/** Convert a TypedColumnMatch value to its string form for Set-based dedup. */
function matchKey(m: TypedColumnMatch): string {
  if (m.column === 'valueBoolean') return String(m.value)
  if (m.column === 'valueNumber') return String(m.value)
  return String(m.value)
}

/**
 * Serialize a TypedColumnMatch list to the Drizzle `inArray` column filter.
 * All entries must share the same column (enforced by the caller, since
 * one field has one type).
 */
function buildMatchInClause(
  column: TypedColumnMatch['column'],
  values: readonly string[] | readonly number[] | readonly boolean[]
): ReturnType<typeof inArray> {
  const col = schema.FieldValue[column as keyof typeof schema.FieldValue] as any
  return inArray(col, values as any)
}

/**
 * Acquire a transaction-scoped advisory lock for (entityId, fieldId).
 * Serializes concurrent add-with-dedup operations on the same record+field
 * so the read-filter-insert sequence runs atomically without needing a
 * per-column unique index. Released automatically at transaction commit.
 */
async function acquireFieldValueLock(
  tx: FieldValueContext['db'],
  entityId: string,
  fieldId: string
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${entityId}:${fieldId}`}, 0))`
  )
}

/**
 * Append values to a multi-value field with server-side dedup.
 *
 * Works for any field type flagged as multi — MULTI_SELECT/TAGS (via optionId),
 * RELATIONSHIP (via relatedEntityId), FILE (valueJson), ACTOR multi, and
 * scalar TEXT/EMAIL/URL/PHONE/NUMBER/DATE fields with `options.multi = true`.
 *
 * Atomicity: runs inside a serializable-ish critical section using a
 * pg advisory lock keyed on (entityId, fieldId). Two concurrent callers
 * trying to add the same value to the same (record, field) see the same
 * existing-row set, so exactly one row lands.
 *
 * Throws `BadRequestError` if the target field isn't multi-value.
 */
export async function addValues(
  ctx: FieldValueContext,
  params: {
    recordId: RecordId
    fieldId: string
    values: unknown[]
  }
): Promise<TypedFieldValue[]> {
  const { recordId, fieldId, values } = params
  if (values.length === 0) {
    const existing = await getValue(ctx, { recordId, fieldId })
    if (existing === null) return []
    return Array.isArray(existing) ? existing : [existing]
  }

  const field = await getField(ctx, fieldId)
  const fieldType = field.type as FieldType
  const fieldOptions = field.options as
    | { actor?: { multiple?: boolean }; multi?: boolean }
    | undefined

  if (!isMultiValueFieldType(fieldType, fieldOptions)) {
    throw new BadRequestError(
      `Field ${fieldId} (${fieldType}) is not multi-value; use setValue for single-value fields`
    )
  }

  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  return await ctx.db.transaction(async (tx) => {
    // Serialize concurrent add-with-dedup on the same (entity, field).
    // Other non-conflicting writes elsewhere are unaffected.
    await acquireFieldValueLock(tx, entityInstanceId, fieldId)

    // Convert raw inputs to typed form and extract their (column, value) match tuples.
    const typedInputs: TypedFieldValueInput[] = []
    const matches: TypedColumnMatch[] = []
    for (const raw of values) {
      const converted = formatToTypedInput(raw, fieldType, {
        selectOptions: field.options as { id?: string; value: string; label: string }[] | undefined,
        fieldOptions,
      })
      if (converted === null) continue
      if (Array.isArray(converted)) {
        for (const c of converted) {
          typedInputs.push(c)
          matches.push(typedColumnMatch(c))
        }
      } else {
        typedInputs.push(converted)
        matches.push(typedColumnMatch(converted))
      }
    }

    if (typedInputs.length === 0) {
      const fullValues = await getValue(ctx, { recordId, fieldId })
      if (fullValues === null) return []
      return Array.isArray(fullValues) ? fullValues : [fullValues]
    }

    const column = matches[0]!.column
    // One field has one column — sanity-check in dev, but any mismatch here
    // would indicate a TypedFieldValueInput bug elsewhere.

    // Fetch existing rows inside the lock so read+filter+insert is atomic.
    const existingRows = (await tx
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))) as unknown as FieldValueRow[]

    const seen = new Set<string>()
    for (const row of existingRows) {
      const k = serializeRowMatch(row, column)
      if (k !== null) seen.add(k)
    }

    // Dedup the typed inputs by existing rows AND by earlier entries in the batch.
    const survivors: TypedFieldValueInput[] = []
    const surviving = new Set<string>()
    for (let i = 0; i < typedInputs.length; i++) {
      const key = matchKey(matches[i]!)
      if (seen.has(key) || surviving.has(key)) continue
      surviving.add(key)
      survivors.push(typedInputs[i]!)
    }

    if (survivors.length === 0) {
      return existingRows.map((r) => rowToTypedValue(r, fieldType))
    }

    // Generate sortKeys appended after the current max.
    // `nextKeyAfter` tolerates a corrupt last-row sortKey by degrading to 'a0'.
    let prevKey: string | null =
      existingRows.length > 0 ? existingRows[existingRows.length - 1]!.sortKey : null
    const insertRows = survivors.map((v) => {
      const sortKey = nextKeyAfter(prevKey)
      prevKey = sortKey
      return buildFieldValueRow({
        organizationId: ctx.organizationId,
        entityId: entityInstanceId,
        entityDefinitionId,
        fieldId,
        value: v,
        sortKey,
      })
    })

    const inserted = (await tx
      .insert(schema.FieldValue)
      .values(insertRows)
      .returning()) as unknown as FieldValueRow[]

    const allRows = [...existingRows, ...inserted]
    const allTyped = allRows.map((r) => rowToTypedValue(r, fieldType))

    // Update display value (safe no-op when the field isn't a display source).
    await maybeUpdateDisplayValue(ctx, recordId, field, survivors)

    // Publish the full post-state. Array-return fields publish arrays;
    // scalar-multi (TEXT/etc. with options.multi) are array-return too.
    const key = buildFieldValueKey(recordId, fieldId as FieldId)
    publishFieldValueUpdates(getRealtimeService(), ctx.organizationId, [{ key, value: allTyped }], {
      excludeSocketId: ctx.socketId,
    }).catch(() => {})

    return allTyped
  })
}

/**
 * Delete specific values from a multi-value field by typed equality.
 * Matching is per-column (valueText, valueNumber, …) depending on fieldType.
 *
 * Throws `BadRequestError` if the target field isn't multi-value.
 */
export async function removeValues(
  ctx: FieldValueContext,
  params: {
    recordId: RecordId
    fieldId: string
    values: unknown[]
  }
): Promise<void> {
  const { recordId, fieldId, values } = params
  if (values.length === 0) return

  const field = await getField(ctx, fieldId)
  const fieldType = field.type as FieldType
  const fieldOptions = field.options as
    | { actor?: { multiple?: boolean }; multi?: boolean }
    | undefined

  if (!isMultiValueFieldType(fieldType, fieldOptions)) {
    throw new BadRequestError(
      `Field ${fieldId} (${fieldType}) is not multi-value; use setValue to clear`
    )
  }

  const { entityInstanceId } = parseRecordId(recordId)

  // Convert inputs and collect match tuples.
  const matches: TypedColumnMatch[] = []
  for (const raw of values) {
    const converted = formatToTypedInput(raw, fieldType, { fieldOptions })
    if (converted === null) continue
    if (Array.isArray(converted)) {
      for (const c of converted) matches.push(typedColumnMatch(c))
    } else {
      matches.push(typedColumnMatch(converted))
    }
  }

  if (matches.length === 0) return

  const column = matches[0]!.column
  const matchValues = matches.map((m) => m.value)

  // Group by column to guard against mixed types (shouldn't happen — one
  // field = one type — but fail safely if it does).
  if (matches.some((m) => m.column !== column)) {
    throw new BadRequestError(
      `removeValues: mixed value columns for field ${fieldId} — input types inconsistent`
    )
  }

  await ctx.db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        buildMatchInClause(column, matchValues as any)
      )
    )

  // Publish the remaining array — empty is a valid "cleared" signal.
  const remaining = await getValue(ctx, { recordId, fieldId })
  const publishValue = remaining === null ? [] : Array.isArray(remaining) ? remaining : [remaining]

  // Update display (e.g. clear avatar when last file row removed).
  await maybeUpdateDisplayValue(ctx, recordId, field, remaining ?? null)

  const key = buildFieldValueKey(recordId, fieldId as FieldId)
  publishFieldValueUpdates(
    getRealtimeService(),
    ctx.organizationId,
    [{ key, value: publishValue }],
    { excludeSocketId: ctx.socketId }
  ).catch(() => {})
}

/**
 * Bulk-add the same values to a multi-value field on many source records.
 * Issues one advisory lock per source record, one read per source record,
 * and a single batch insert. Source recordIds are sorted before lock
 * acquisition to avoid cross-pair deadlocks under concurrent callers.
 */
export async function addValuesBulk(
  ctx: FieldValueContext,
  params: {
    recordIds: RecordId[]
    fieldId: string
    values: unknown[]
  }
): Promise<{ inserted: number; skipped: number }> {
  const { recordIds, fieldId, values } = params
  if (recordIds.length === 0 || values.length === 0) {
    return { inserted: 0, skipped: 0 }
  }

  const field = await getField(ctx, fieldId)
  const fieldType = field.type as FieldType
  const fieldOptions = field.options as
    | { actor?: { multiple?: boolean }; multi?: boolean }
    | undefined

  if (!isMultiValueFieldType(fieldType, fieldOptions)) {
    throw new BadRequestError(
      `Field ${fieldId} (${fieldType}) is not multi-value; use setBulkValues for single-value fields`
    )
  }

  // Convert inputs once up front.
  const typedInputs: TypedFieldValueInput[] = []
  const matches: TypedColumnMatch[] = []
  for (const raw of values) {
    const converted = formatToTypedInput(raw, fieldType, { fieldOptions })
    if (converted === null) continue
    if (Array.isArray(converted)) {
      for (const c of converted) {
        typedInputs.push(c)
        matches.push(typedColumnMatch(c))
      }
    } else {
      typedInputs.push(converted)
      matches.push(typedColumnMatch(converted))
    }
  }
  if (typedInputs.length === 0) return { inserted: 0, skipped: 0 }

  const column = matches[0]!.column

  // Parse + sort source record ids for deterministic lock order.
  const parsed = recordIds.map((rid) => parseRecordId(rid))
  const entityIds = parsed.map((p) => p.entityInstanceId)
  const entityDefinitionId = parsed[0]!.entityDefinitionId
  if (parsed.some((p) => p.entityDefinitionId !== entityDefinitionId)) {
    throw new BadRequestError('addValuesBulk: all recordIds must share one entityDefinitionId')
  }

  let insertedCount = 0
  let skippedCount = 0

  // Pre-write rows per entity, plus the new typed inputs each entity got.
  // Captured inside the transaction; consumed below to fire field-change
  // events without a post-write read.
  const oldRowsByEntity = new Map<string, FieldValueRow[]>()
  const insertedTypedByEntity = new Map<string, TypedFieldValueInput[]>()

  await ctx.db.transaction(async (tx) => {
    const sortedEntityIds = [...entityIds].sort()
    for (const entityId of sortedEntityIds) {
      await acquireFieldValueLock(tx, entityId, fieldId)
    }

    // Fetch existing rows for every entity in one query.
    const existingRows = (await tx
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, ctx.organizationId),
          inArray(schema.FieldValue.entityId, sortedEntityIds)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))) as unknown as FieldValueRow[]

    const existingByEntity = new Map<string, FieldValueRow[]>()
    for (const row of existingRows) {
      const arr = existingByEntity.get(row.entityId) ?? []
      arr.push(row)
      existingByEntity.set(row.entityId, arr)
    }

    const insertRows: ReturnType<typeof buildFieldValueRow>[] = []
    for (const entityId of entityIds) {
      const existing = existingByEntity.get(entityId) ?? []
      oldRowsByEntity.set(entityId, existing)
      const seen = new Set<string>()
      for (const row of existing) {
        const k = serializeRowMatch(row, column)
        if (k !== null) seen.add(k)
      }

      // `nextKeyAfter` tolerates a corrupt last-row sortKey from the DB.
      let prevKey: string | null =
        existing.length > 0 ? existing[existing.length - 1]!.sortKey : null
      const localSeen = new Set<string>()
      const insertedTyped: TypedFieldValueInput[] = []
      for (let i = 0; i < typedInputs.length; i++) {
        const key = matchKey(matches[i]!)
        if (seen.has(key) || localSeen.has(key)) {
          skippedCount++
          continue
        }
        localSeen.add(key)
        const sortKey = nextKeyAfter(prevKey)
        prevKey = sortKey
        insertRows.push(
          buildFieldValueRow({
            organizationId: ctx.organizationId,
            entityId,
            entityDefinitionId,
            fieldId,
            value: typedInputs[i]!,
            sortKey,
          })
        )
        insertedTyped.push(typedInputs[i]!)
        insertedCount++
      }
      if (insertedTyped.length > 0) {
        insertedTypedByEntity.set(entityId, insertedTyped)
      }
    }

    if (insertRows.length > 0) {
      await tx.insert(schema.FieldValue).values(insertRows)
    }
  })

  // Field-change post-hooks for entities that actually received inserts.
  // Old display = pre-write rows; new display = pre-write rows + inserts.
  // Bulk renderer surfaces this as an "added" diff.
  if (insertedTypedByEntity.size > 0 && ctx.userId !== undefined) {
    const resource = await getCachedResource(ctx.organizationId, entityDefinitionId)
    const entitySlug = resource?.apiSlug ?? ''
    if (hasEntityFieldChangeHooks(entitySlug)) {
      await dispatchAddRemoveFieldChangeEvents({
        ctx,
        field,
        fieldType,
        entityDefinitionId,
        entitySlug,
        entityType: resource?.entityType ?? null,
        recordIds,
        entityIds,
        oldRowsByEntity,
        deltaTypedByEntity: insertedTypedByEntity,
        mode: 'add',
      })
    }
  }

  return { inserted: insertedCount, skipped: skippedCount }
}

/**
 * Bulk-remove the same values from a multi-value field on many source records.
 */
export async function removeValuesBulk(
  ctx: FieldValueContext,
  params: {
    recordIds: RecordId[]
    fieldId: string
    values: unknown[]
  }
): Promise<{ removed: number }> {
  const { recordIds, fieldId, values } = params
  if (recordIds.length === 0 || values.length === 0) return { removed: 0 }

  const field = await getField(ctx, fieldId)
  const fieldType = field.type as FieldType
  const fieldOptions = field.options as
    | { actor?: { multiple?: boolean }; multi?: boolean }
    | undefined

  if (!isMultiValueFieldType(fieldType, fieldOptions)) {
    throw new BadRequestError(
      `Field ${fieldId} (${fieldType}) is not multi-value; use setBulkValues to clear`
    )
  }

  const matches: TypedColumnMatch[] = []
  for (const raw of values) {
    const converted = formatToTypedInput(raw, fieldType, { fieldOptions })
    if (converted === null) continue
    if (Array.isArray(converted)) {
      for (const c of converted) matches.push(typedColumnMatch(c))
    } else {
      matches.push(typedColumnMatch(converted))
    }
  }
  if (matches.length === 0) return { removed: 0 }

  const column = matches[0]!.column
  const matchValues = matches.map((m) => m.value)

  const parsed = recordIds.map((rid) => parseRecordId(rid))
  const entityIds = parsed.map((p) => p.entityInstanceId)
  const entityDefinitionId = parsed[0]!.entityDefinitionId

  // Pre-fetch existing rows so we can derive each entity's new (post-delete)
  // value list in memory, without a second SELECT after the delete. Gated on
  // listener presence so silent paths skip the read entirely.
  const resource = await getCachedResource(ctx.organizationId, entityDefinitionId)
  const entitySlug = resource?.apiSlug ?? ''
  const willDispatchFieldChange = ctx.userId !== undefined && hasEntityFieldChangeHooks(entitySlug)

  const oldRowsByEntity = new Map<string, FieldValueRow[]>()
  if (willDispatchFieldChange) {
    const rows = (await ctx.db
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, ctx.organizationId),
          inArray(schema.FieldValue.entityId, entityIds)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))) as unknown as FieldValueRow[]
    for (const row of rows) {
      const arr = oldRowsByEntity.get(row.entityId) ?? []
      arr.push(row)
      oldRowsByEntity.set(row.entityId, arr)
    }
  }

  const deleted = (await ctx.db
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        inArray(schema.FieldValue.entityId, entityIds),
        buildMatchInClause(column, matchValues as any)
      )
    )
    .returning({
      id: schema.FieldValue.id,
      entityId: schema.FieldValue.entityId,
    })) as Array<{ id: string; entityId: string }>

  if (willDispatchFieldChange && deleted.length > 0) {
    const deletedIdsByEntity = new Map<string, Set<string>>()
    for (const row of deleted) {
      const set = deletedIdsByEntity.get(row.entityId) ?? new Set<string>()
      set.add(row.id)
      deletedIdsByEntity.set(row.entityId, set)
    }

    await dispatchAddRemoveFieldChangeEvents({
      ctx,
      field,
      fieldType,
      entityDefinitionId,
      entitySlug,
      entityType: resource?.entityType ?? null,
      recordIds,
      entityIds,
      oldRowsByEntity,
      deletedIdsByEntity,
      mode: 'remove',
    })
  }

  return { removed: deleted.length }
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

  // Resolve entity metadata once — shared by pre-hook, oldValue gate, and
  // post-hook so we hit the resource cache a single time per write.
  const resource = await getCachedResource(ctx.organizationId, entityDefinitionId)
  const entitySlug = resource?.apiSlug ?? ''
  const entityType = resource?.entityType ?? null

  // 3. Validate and convert raw value to typed input using FieldValueValidator
  const coercedValue = await validateAndConvertValue(ctx, value, field.type, field)

  // 3.5. Per-field pre-hooks: fire BEFORE the null-delete branch so guards can
  // observe clear-attempts (`newValue === null`). Hooks may transform the
  // typed value, drop the write (return `undefined`), or throw to reject.
  const hookOutcome = await fireFieldPreHooks(ctx, {
    recordId,
    field,
    typedValue: coercedValue,
    existingValue: undefined,
    allValues: new Map<string, unknown>([[fieldId, coercedValue]]),
    entitySlug,
    entityType,
  })
  if (hookOutcome.kind === 'drop') {
    return { state: 'complete', performedAt: new Date().toISOString(), values: [] }
  }
  const typedValue = hookOutcome.value

  // 3.6. Capture oldValue BEFORE the null-delete branch — both set and clear
  // paths need it to fire post-hooks identically. Gated on
  // `hasEntityFieldChangeHooks` so entities without listeners pay nothing.
  const willFirePostHook =
    publishEvents && ctx.userId !== undefined && hasEntityFieldChangeHooks(entitySlug)
  const oldValue: TypedFieldValue | TypedFieldValue[] | null = willFirePostHook
    ? await getValue(ctx, { recordId, fieldId })
    : null

  // Closure so set + clear branches fire the post-hook chain identically.
  // Resolves snapshots once per write so handlers (timeline writer especially)
  // get frozen labels without each one re-resolving the same refs.
  const firePostHook = async (newValue: unknown): Promise<void> => {
    if (!willFirePostHook) return
    const { oldDisplay, newDisplay } = await resolveFieldChangeSnapshotPair(
      { db: ctx.db, organizationId: ctx.organizationId },
      field,
      oldValue,
      newValue as TypedFieldValue | TypedFieldValue[] | null
    )
    for (const handler of getEntityFieldChangeHooks(entitySlug)) {
      try {
        await handler({
          recordId,
          entityDefinitionId,
          entityType,
          entitySlug,
          field,
          oldValue,
          newValue,
          oldDisplay,
          newDisplay,
          organizationId: ctx.organizationId,
          userId: ctx.userId!,
        })
      } catch (error) {
        logger.error(`Field-change handler failed for ${entitySlug}`, {
          fieldId: field.id,
          recordId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

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
    await firePostHook(null)
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

  // 6. Set the value
  const result = await setValueWithType(ctx, {
    recordId,
    fieldId,
    fieldType: field.type as FieldType,
    value: typedValue,
    skipInverseSync,
    aiGeneration: params.aiGeneration,
  })

  // 7. Fire field-change post-hooks. For multi-value fields (MULTI_SELECT,
  // TAGS, RELATIONSHIP, FILE, or scalar types with options.multi=true) we
  // pass the full result array so handlers can render every value.
  const eventFieldOptions = field.options as
    | { actor?: { multiple?: boolean }; multi?: boolean }
    | undefined
  const isArrayReturn = isArrayReturnFieldType(field.type as FieldType, eventFieldOptions)
  await firePostHook(isArrayReturn ? result : (result[0] ?? null))

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
    const storeValue = isArrayReturn ? result : result[0]
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

  // Pre-capture pre-write typed values for every (entityId, customFieldId)
  // we're about to touch. Required for the post-hook dispatch below so each
  // emitted event carries an accurate `oldValue`/`oldDisplay`. Gated on
  // listener presence — entities without registered field-change hooks pay
  // nothing here.
  const entitySlug = resource?.apiSlug ?? ''
  const entityType = resource?.entityType ?? null
  const willDispatchFieldChange =
    ctx.userId !== undefined && customFieldIds.length > 0 && hasEntityFieldChangeHooks(entitySlug)

  const oldValuesMap = willDispatchFieldChange
    ? await batchGetExistingFieldValues(
        { db: ctx.db, organizationId: ctx.organizationId },
        entityInstanceIds,
        customFieldIds,
        ctx.fieldCache
      )
    : null

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
  // Shape depends on field type: array-return fields always publish arrays —
  // including empty arrays so peer clients can clear the field in their
  // store. Skipping empty results (as the previous implementation did)
  // silently dropped "cleared" states on array-return fields; peer clients
  // kept the stale value until a manual refetch.
  const entries: Array<{ key: ReturnType<typeof buildFieldValueKey>; value: unknown }> = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result?.status !== 'fulfilled') continue
    const recordId = recordIds[i]!
    for (const fieldResult of result.value) {
      if (fieldResult.state !== 'complete') continue
      const key = buildFieldValueKey(recordId, fieldResult.fieldId as FieldId)
      const cachedField = ctx.fieldCache.get(fieldResult.fieldId)
      const fieldType = cachedField?.type as FieldType | undefined
      const fieldOptions = cachedField?.options as
        | { actor?: { multiple?: boolean }; multi?: boolean }
        | undefined
      const isArrayReturn = fieldType ? isArrayReturnFieldType(fieldType, fieldOptions) : false

      // Array-return fields always publish an array (possibly empty = clear).
      // Single-value fields publish the first value, or `null` when the write
      // deleted the only row (intentional scalar clear).
      if (isArrayReturn) {
        entries.push({ key, value: fieldResult.values })
      } else if (fieldResult.values.length > 0) {
        entries.push({ key, value: fieldResult.values[0] })
      } else {
        entries.push({ key, value: null })
      }
    }
  }
  if (entries.length > 0) {
    publishFieldValueUpdates(getRealtimeService(), ctx.organizationId, entries, {
      excludeSocketId: ctx.socketId,
    }).catch(() => {})
  }

  // Dispatch per-record field-change events for every successful (recordId,
  // fieldId) write. All events share one bulkOperationId so the timeline
  // can later group/cite them as a single bulk action. System writes
  // (no userId) skip dispatch — matches the per-write path's gate.
  if (willDispatchFieldChange && oldValuesMap) {
    await dispatchBulkFieldChangeEvents({
      ctx,
      results,
      recordIds,
      validValues,
      modelType,
      entityDefinitionId,
      entitySlug,
      entityType,
      oldValuesMap,
    })
  }

  return { count }
}

/**
 * Build per-record field-change events for every successful (recordId,
 * fieldId) write, resolve their snapshots in one batched pass, and run the
 * registered handler chain with a shared bulkOperationId. Failures are
 * logged and swallowed — they must not surface as bulk-write errors.
 */
async function dispatchBulkFieldChangeEvents(args: {
  ctx: FieldValueContext
  results: Array<PromiseSettledResult<SetValuesResult[]>>
  recordIds: RecordId[]
  validValues: Array<{ fieldId: string; value: unknown }>
  modelType: ReturnType<typeof getModelType>
  entityDefinitionId: string
  entitySlug: string
  entityType: string | null
  oldValuesMap: Awaited<ReturnType<typeof batchGetExistingFieldValues>>
}): Promise<void> {
  const {
    ctx,
    results,
    recordIds,
    validValues,
    modelType,
    entityDefinitionId,
    entitySlug,
    entityType,
    oldValuesMap,
  } = args

  // Built-in fields don't fire field-change events on the per-write path
  // either (setValueWithBuiltIn returns early before the post-hook).
  // Restrict the bulk dispatch to custom fields for parity.
  const customFieldIdSet = new Set(
    validValues.filter((v) => !isBuiltInField(v.fieldId, modelType)).map((v) => v.fieldId)
  )
  if (customFieldIdSet.size === 0) return

  const writes: BulkSnapshotWrite[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result?.status !== 'fulfilled') continue
    const recordId = recordIds[i]!
    const { entityInstanceId } = parseRecordId(recordId)
    const oldByField = oldValuesMap.get(entityInstanceId) ?? new Map()
    for (const fieldResult of result.value) {
      if (fieldResult.state !== 'complete') continue
      if (!customFieldIdSet.has(fieldResult.fieldId)) continue
      const field = ctx.fieldCache.get(fieldResult.fieldId)
      if (!field) continue

      const fieldOptions = field.options as
        | { actor?: { multiple?: boolean }; multi?: boolean }
        | undefined
      const isArrayReturn = isArrayReturnFieldType(field.type as FieldType, fieldOptions)
      const newValue: TypedFieldValue | TypedFieldValue[] | null = isArrayReturn
        ? fieldResult.values
        : (fieldResult.values[0] ?? null)
      const oldValue = oldByField.get(fieldResult.fieldId) ?? null

      writes.push({ recordId, field, oldValue, newValue })
    }
  }
  if (writes.length === 0) return

  const bulkOperationId = generateId()

  let snapshots: Awaited<ReturnType<typeof resolveFieldChangeSnapshotsBulk>>
  try {
    const cache = await preloadSnapshotCache(ctx.organizationId, writes)
    snapshots = await resolveFieldChangeSnapshotsBulk(
      { db: ctx.db, organizationId: ctx.organizationId, cache },
      writes
    )
  } catch (error) {
    logger.error('Bulk snapshot resolution failed; dispatching with empty snapshots', {
      writes: writes.length,
      error: error instanceof Error ? error.message : String(error),
    })
    snapshots = new Map()
  }

  // Bound concurrency so a 1000-record bulk op doesn't spawn 1000+ handler
  // promises in parallel. Each chunk runs in parallel; chunks run serially.
  const handlers = getEntityFieldChangeHooks(entitySlug)
  if (handlers.length === 0) return

  const CHUNK_SIZE = 100
  for (let i = 0; i < writes.length; i += CHUNK_SIZE) {
    const chunk = writes.slice(i, i + CHUNK_SIZE)
    await Promise.all(
      chunk.map(async (w) => {
        const snapshot = snapshots.get(`${w.recordId}:${w.field.id}`)
        for (const handler of handlers) {
          try {
            await handler({
              recordId: w.recordId,
              entityDefinitionId,
              entityType,
              entitySlug,
              field: w.field,
              oldValue: w.oldValue,
              newValue: w.newValue,
              oldDisplay: snapshot?.oldDisplay ?? null,
              newDisplay: snapshot?.newDisplay ?? null,
              organizationId: ctx.organizationId,
              userId: ctx.userId!,
              bulkOperationId,
            })
          } catch (error) {
            logger.error(`Bulk field-change handler failed for ${entitySlug}`, {
              fieldId: w.field.id,
              recordId: w.recordId,
              bulkOperationId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      })
    )
  }
}

/**
 * Build per-record field-change events for `addValuesBulk` /
 * `removeValuesBulk`. The event carries the *full* old + new typed value
 * arrays so the renderer can show "added X" / "removed Y" diffs without
 * any post-write read.
 */
async function dispatchAddRemoveFieldChangeEvents(
  args: {
    ctx: FieldValueContext
    field: CachedField
    fieldType: FieldType
    entityDefinitionId: string
    entitySlug: string
    entityType: string | null
    recordIds: RecordId[]
    entityIds: string[]
    oldRowsByEntity: Map<string, FieldValueRow[]>
  } & (
    | { mode: 'add'; deltaTypedByEntity: Map<string, TypedFieldValueInput[]> }
    | { mode: 'remove'; deletedIdsByEntity: Map<string, Set<string>> }
  )
): Promise<void> {
  const {
    ctx,
    field,
    fieldType,
    entityDefinitionId,
    entitySlug,
    entityType,
    recordIds,
    entityIds,
    oldRowsByEntity,
  } = args

  const writes: BulkSnapshotWrite[] = []
  for (let i = 0; i < entityIds.length; i++) {
    const entityId = entityIds[i]!
    const recordId = recordIds[i]!
    const oldRows = oldRowsByEntity.get(entityId) ?? []
    const oldTyped = oldRows.map((r) => rowToTypedValue(r, fieldType))

    let newTyped: TypedFieldValue[]
    if (args.mode === 'add') {
      const delta = args.deltaTypedByEntity.get(entityId)
      if (!delta || delta.length === 0) continue
      // Cast TypedFieldValueInput[] → TypedFieldValue[]; for renderer purposes
      // the input shape carries the same display-relevant fields. We don't
      // synthesize ids/sortKeys here — the snapshot resolver doesn't need them.
      const newAdditions = delta as unknown as TypedFieldValue[]
      newTyped = [...oldTyped, ...newAdditions]
    } else {
      const deletedIds = args.deletedIdsByEntity.get(entityId)
      if (!deletedIds || deletedIds.size === 0) continue
      newTyped = oldTyped.filter((tv) => !deletedIds.has(tv.id))
      if (newTyped.length === oldTyped.length) continue
    }

    writes.push({
      recordId,
      field,
      oldValue: oldTyped.length > 0 ? oldTyped : null,
      newValue: newTyped.length > 0 ? newTyped : null,
    })
  }

  if (writes.length === 0) return

  const bulkOperationId = generateId()

  let snapshots: Awaited<ReturnType<typeof resolveFieldChangeSnapshotsBulk>>
  try {
    const cache = await preloadSnapshotCache(ctx.organizationId, writes)
    snapshots = await resolveFieldChangeSnapshotsBulk(
      { db: ctx.db, organizationId: ctx.organizationId, cache },
      writes
    )
  } catch (error) {
    logger.error('Bulk add/remove snapshot resolution failed; dispatching with empty snapshots', {
      writes: writes.length,
      error: error instanceof Error ? error.message : String(error),
    })
    snapshots = new Map()
  }

  const handlers = getEntityFieldChangeHooks(entitySlug)
  if (handlers.length === 0) return

  const CHUNK_SIZE = 100
  for (let i = 0; i < writes.length; i += CHUNK_SIZE) {
    const chunk = writes.slice(i, i + CHUNK_SIZE)
    await Promise.all(
      chunk.map(async (w) => {
        const snapshot = snapshots.get(`${w.recordId}:${w.field.id}`)
        for (const handler of handlers) {
          try {
            await handler({
              recordId: w.recordId,
              entityDefinitionId,
              entityType,
              entitySlug,
              field: w.field,
              oldValue: w.oldValue,
              newValue: w.newValue,
              oldDisplay: snapshot?.oldDisplay ?? null,
              newDisplay: snapshot?.newDisplay ?? null,
              organizationId: ctx.organizationId,
              userId: ctx.userId!,
              bulkOperationId,
            })
          } catch (error) {
            logger.error(`Bulk add/remove field-change handler failed for ${entitySlug}`, {
              fieldId: w.field.id,
              recordId: w.recordId,
              bulkOperationId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      })
    )
  }
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
  const sortKeys = nKeysAfter(null, values.length)
  const insertInputs = values.map((v, index) => ({
    recordId,
    fieldId,
    organizationId: ctx.organizationId,
    sortKey: sortKeys[index]!,
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
  sortKey: string
}): typeof schema.FieldValue.$inferInsert {
  const { organizationId, entityId, entityDefinitionId, fieldId, value, sortKey } = params

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
