// packages/lib/src/field-values/field-value-queries.ts

import { schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import { isArrayReturnFieldType, type TypedFieldValue } from '@auxx/types'
import {
  type FieldPath,
  type FieldReference,
  isFieldPath,
  parseResourceFieldId,
  type ResourceFieldId,
} from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { findCachedResource } from '../cache'
import type { FieldOptions, NameFieldOptions } from '../custom-fields/field-options'
import type { AiStatus } from '../realtime/events'
import type { TableId } from '../resources/registry/field-registry'
import { isSystemResourceId } from '../resources/registry/types'
import { parseRecordId, toRecordId } from '../resources/resource-id'
import { readAiMetadata } from './ai-commit'
import {
  type CachedField,
  type FieldValueContext,
  getField,
  getFieldInfoFromRegistry,
  rowsToTypedValues,
  rowToTypedValue,
  validateFieldReferences,
} from './field-value-helpers'
import {
  batchFetchSystemRelationships,
  isVirtualField,
  resolveSystemTableFields,
  resolveVirtualFields,
  type SystemFieldDescriptor,
} from './resolvers'
import type {
  BatchFieldValueResult,
  BatchGetValuesInput,
  FieldValueRow,
  GetValueInput,
  GetValuesInput,
  TypedFieldValueResult,
} from './types'

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * Get a single field value for an entity.
 * Returns TypedFieldValue for single-value fields, TypedFieldValue[] for multi-value fields, or null.
 *
 * @param ctx - Field value context
 * @param params.recordId - RecordId of the entity (e.g. "contact:abc123")
 * @param params.fieldId - UUID of the field
 * @param cachedField - Optional pre-fetched CachedField to avoid lookup
 * @returns TypedFieldValue | TypedFieldValue[] | null
 *
 * @example
 * const email = await getValue(ctx, { recordId: "contact:abc123", fieldId: "field-email" })
 */
export async function getValue(
  ctx: FieldValueContext,
  params: GetValueInput,
  cachedField?: CachedField
): Promise<TypedFieldValue | TypedFieldValue[] | null> {
  const { entityInstanceId } = parseRecordId(params.recordId)

  // Use cached field if provided (avoids redundant CustomField join)
  const field = cachedField ?? (await getField(ctx, params.fieldId))

  const rows = await ctx.db
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, params.fieldId),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  if (rows.length === 0) {
    return null
  }

  return rowsToTypedValues(
    rows as unknown as FieldValueRow[],
    field.type,
    isArrayReturnFieldType(field.type, field.options as FieldOptions | undefined)
  )
}

/**
 * Get multiple field values for an entity in a single efficient query.
 * Returns Map keyed by fieldId. Use this instead of calling getValue() multiple times.
 * Single DB join of FieldValue + CustomField avoids N+1 queries.
 *
 * @param ctx - Field value context
 * @param params.recordId - RecordId of the entity (e.g. "contact:abc123")
 * @param params.fieldIds - Optional array of field UUIDs (omit to get all fields)
 * @returns Map<fieldId, TypedFieldValue | TypedFieldValue[]>
 *
 * @example
 * const values = await getValues(ctx, {
 *   recordId: "contact:abc123",
 *   fieldIds: ["field-email", "field-phone"]
 * })
 * const email = values.get("field-email")
 */
export async function getValues(
  ctx: FieldValueContext,
  params: GetValuesInput
): Promise<Map<string, TypedFieldValue | TypedFieldValue[]>> {
  const { entityInstanceId } = parseRecordId(params.recordId)

  const query = ctx.db
    .select()
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        params.fieldIds ? inArray(schema.FieldValue.fieldId, params.fieldIds) : undefined
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  const rows = await query
  const result = new Map<string, TypedFieldValue | TypedFieldValue[]>()

  // Group by fieldId
  const groupedByField = new Map<string, typeof rows>()
  for (const row of rows) {
    const existing = groupedByField.get(row.FieldValue.fieldId) ?? []
    existing.push(row)
    groupedByField.set(row.FieldValue.fieldId, existing)
  }

  // Convert and store results
  for (const [fieldId, fieldRows] of groupedByField) {
    const fieldType = fieldRows[0]!.CustomField.type as FieldType
    const fieldOptions = fieldRows[0]!.CustomField.options as FieldOptions | undefined
    const fieldValueRows = fieldRows.map((r) => r.FieldValue as unknown as FieldValueRow)
    const typedValues = rowsToTypedValues(
      fieldValueRows,
      fieldType,
      isArrayReturnFieldType(fieldType, fieldOptions)
    )
    if (typedValues !== null) {
      result.set(fieldId, typedValues)
    }
  }

  return result
}

/**
 * Get field values for multiple entities.
 * Handles both direct fields (ResourceFieldId) and relationship paths (FieldPath).
 *
 * For paths like ["product:vendor", "vendor:name"]:
 * 1. Fetch product:vendor relationships for all products
 * 2. Collect all vendor IDs from step 1
 * 3. Fetch vendor:name for all vendors
 * 4. Map results back to source products
 *
 * Query count = max path depth (e.g., depth 2 = 2 queries, regardless of record count)
 *
 * @param ctx - Field value context
 * @param registryService - Resource registry service for field type lookups
 * @param params - The BatchGetValuesInput object
 * @param params.recordIds - Array of RecordIds in format "entityDefinitionId:entityInstanceId"
 * @param params.fieldReferences - Array of FieldReference (ResourceFieldId or FieldPath)
 *
 * @returns BatchFieldValueResult containing values array
 *
 * @example
 * // Direct field fetch
 * const result = await batchGetValues(ctx, registryService, {
 *   recordIds: ["contact:contact-1", "contact:contact-2"],
 *   fieldReferences: ["contact:email", "contact:name"]
 * });
 *
 * @example
 * // Relationship path fetch
 * const result = await batchGetValues(ctx, registryService, {
 *   recordIds: ["product:prod-1"],
 *   fieldReferences: [["product:vendor", "vendor:name"]]
 * });
 */
export async function batchGetValues(
  ctx: FieldValueContext,
  params: BatchGetValuesInput
): Promise<BatchFieldValueResult> {
  const { recordIds, fieldReferences } = params

  if (recordIds.length === 0 || fieldReferences.length === 0) {
    return { values: [] }
  }

  // Validate all field references upfront (fail-fast)
  await validateFieldReferences(ctx.organizationId, fieldReferences)

  // Fast path: if all refs are direct fields (not multi-hop paths), batch into a single query
  const allDirect = fieldReferences.every((ref) => !isFieldPath(ref))

  if (allDirect) {
    return batchGetAllDirectFieldValues(ctx, recordIds, fieldReferences as ResourceFieldId[])
  }

  // Slow path: sequential per-field resolution (handles relationship traversals)
  const results: TypedFieldValueResult[] = []

  for (const ref of fieldReferences) {
    const refResults = await resolveFieldReference(ctx, recordIds, ref)
    results.push(...refResults)
  }

  return { values: results }
}

/**
 * Batch fetch all direct field values.
 * Categorizes fields into system table, virtual, FieldValue-backed, and NAME,
 * then delegates to the appropriate resolver.
 */
async function batchGetAllDirectFieldValues(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  fieldRefs: ResourceFieldId[]
): Promise<BatchFieldValueResult> {
  const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)

  // Build lookup: instanceId → full RecordId
  const instanceToRecordId = new Map<string, RecordId>()
  for (const rid of recordIds) {
    const { entityInstanceId } = parseRecordId(rid)
    instanceToRecordId.set(entityInstanceId, rid)
  }

  // Parse all field refs to get fieldIds and build ref lookup
  const fieldIdToRef = new Map<string, ResourceFieldId>()
  const allFieldIds: string[] = []
  for (const ref of fieldRefs) {
    const { fieldId } = parseResourceFieldId(ref)
    fieldIdToRef.set(fieldId, ref)
    allFieldIds.push(fieldId)
  }

  // Resolve field types + options from registry
  const fieldTypeMap = new Map<string, FieldType>()
  const fieldOptionsMap = new Map<string, FieldOptions | undefined>()
  for (const ref of fieldRefs) {
    const { entityDefinitionId, fieldId } = parseResourceFieldId(ref)
    const info = await getFieldInfoFromRegistry(ctx.organizationId, entityDefinitionId, fieldId)
    fieldTypeMap.set(fieldId, info.fieldType)
    fieldOptionsMap.set(fieldId, info.fieldOptions)
  }

  // Separate NAME fields
  const nameFieldIds = allFieldIds.filter((fid) => fieldTypeMap.get(fid) === FieldTypeEnum.NAME)

  // Categorize remaining fields into system vs FieldValue-backed
  const { entityDefinitionId } = parseRecordId(recordIds[0]!)
  const categorized = await categorizeFields(
    ctx,
    fieldRefs,
    entityDefinitionId,
    fieldTypeMap,
    fieldOptionsMap
  )

  const results: TypedFieldValueResult[] = []

  // FieldValue-backed fields (custom resource fields + system fields stored in FieldValue)
  if (categorized.fieldValueFieldIds.length > 0) {
    const fvResults = await fetchFieldValueResults(
      ctx,
      entityInstanceIds,
      categorized.fieldValueFieldIds,
      instanceToRecordId,
      fieldIdToRef,
      fieldTypeMap,
      fieldOptionsMap
    )
    results.push(...fvResults)
  }

  // System table fields (Layer 1)
  if (categorized.systemDbFields.length > 0) {
    const systemResults = await resolveSystemTableFields(
      ctx,
      entityDefinitionId as TableId,
      entityInstanceIds,
      categorized.systemDbFields
    )
    results.push(...systemResults)
  }

  // Virtual fields (Layer 2)
  if (categorized.virtualFields.length > 0) {
    const virtualResults = await fetchVirtualFieldResults(
      ctx,
      entityDefinitionId,
      entityInstanceIds,
      categorized.virtualFields,
      categorized.fieldIdToKeyMap,
      instanceToRecordId
    )
    results.push(...virtualResults)
  }

  // NAME fields
  for (const nameFieldId of nameFieldIds) {
    const nameValues = await resolveNameFieldValues(ctx, recordIds, nameFieldId)
    const ref = fieldIdToRef.get(nameFieldId)!
    const nameFieldType = fieldTypeMap.get(nameFieldId)!
    const nameFieldOptions = fieldOptionsMap.get(nameFieldId)

    for (const [recordId, value] of nameValues) {
      results.push({
        recordId,
        fieldRef: ref,
        value,
        fieldType: nameFieldType,
        fieldOptions: nameFieldOptions,
      })
    }
  }

  return { values: results }
}

// =============================================================================
// FIELD CATEGORIZATION
// =============================================================================

interface CategorizedFields {
  systemDbFields: SystemFieldDescriptor[]
  virtualFields: Array<{
    fieldKey: string
    fieldId: string
    fieldRef: ResourceFieldId
    fieldType: FieldType
    fieldOptions?: FieldOptions
  }>
  fieldValueFieldIds: string[]
  fieldIdToKeyMap: Map<string, string>
}

/**
 * Categorize field refs into system table, virtual, or FieldValue-backed.
 * Uses the org-scoped cached resource to resolve field metadata.
 */
async function categorizeFields(
  ctx: FieldValueContext,
  fieldRefs: ResourceFieldId[],
  entityDefinitionId: string,
  fieldTypeMap: Map<string, FieldType>,
  fieldOptionsMap: Map<string, FieldOptions | undefined>
): Promise<CategorizedFields> {
  const isSystem = isSystemResourceId(entityDefinitionId)
  const cachedResource = isSystem
    ? await findCachedResource(ctx.organizationId, entityDefinitionId)
    : null

  const systemDbFields: SystemFieldDescriptor[] = []
  const virtualFields: CategorizedFields['virtualFields'] = []
  const fieldValueFieldIds: string[] = []
  const fieldIdToKeyMap = new Map<string, string>()

  for (const ref of fieldRefs) {
    const { fieldId } = parseResourceFieldId(ref)
    const fieldType = fieldTypeMap.get(fieldId)

    // Skip NAME fields (handled separately)
    if (!fieldType || fieldType === FieldTypeEnum.NAME) continue

    if (isSystem && cachedResource) {
      const cachedField = cachedResource.fields.find((f) => f.id === fieldId || f.key === fieldId)

      if (cachedField?.dbColumn) {
        systemDbFields.push({
          fieldKey: cachedField.key,
          fieldId,
          fieldRef: ref,
          fieldType,
          fieldOptions: fieldOptionsMap.get(fieldId),
          dbColumn: cachedField.dbColumn,
          relationship: cachedField.relationship,
        })
      } else if (cachedField && isVirtualField(entityDefinitionId, cachedField.key)) {
        virtualFields.push({
          fieldKey: cachedField.key,
          fieldId,
          fieldRef: ref,
          fieldType,
          fieldOptions: fieldOptionsMap.get(fieldId),
        })
        fieldIdToKeyMap.set(cachedField.key, fieldId)
      } else {
        // System field stored in FieldValue (e.g. tags) or unknown
        fieldValueFieldIds.push(fieldId)
      }
    } else {
      fieldValueFieldIds.push(fieldId)
    }
  }

  return { systemDbFields, virtualFields, fieldValueFieldIds, fieldIdToKeyMap }
}

// =============================================================================
// FIELD VALUE TABLE QUERY
// =============================================================================

/**
 * Fetch field values from the FieldValue table and convert to typed results.
 * This is the original FieldValue query, extracted into its own function.
 */
async function fetchFieldValueResults(
  ctx: FieldValueContext,
  entityInstanceIds: string[],
  fieldIds: string[],
  instanceToRecordId: Map<string, RecordId>,
  fieldIdToRef: Map<string, ResourceFieldId>,
  fieldTypeMap: Map<string, FieldType>,
  fieldOptionsMap: Map<string, FieldOptions | undefined>
): Promise<TypedFieldValueResult[]> {
  const rows = await ctx.db
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        inArray(schema.FieldValue.fieldId, fieldIds),
        inArray(schema.FieldValue.entityId, entityInstanceIds)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  // Group by (entityId, fieldId)
  const grouped = new Map<string, (typeof rows)[number][]>()
  for (const row of rows) {
    const key = `${row.entityId}:${row.fieldId}`
    const existing = grouped.get(key) ?? []
    existing.push(row)
    grouped.set(key, existing)
  }

  const results: TypedFieldValueResult[] = []

  for (const [, fieldRows] of grouped) {
    const entityId = fieldRows[0]!.entityId
    const fieldId = fieldRows[0]!.fieldId
    const recordId = instanceToRecordId.get(entityId)
    const fieldRef = fieldIdToRef.get(fieldId)
    const fieldType = fieldTypeMap.get(fieldId)

    if (!recordId || !fieldRef || !fieldType) continue

    const fieldOptions = fieldOptionsMap.get(fieldId)
    const isMulti = isArrayReturnFieldType(fieldType, fieldOptions)
    const typedValues = fieldRows.map((row) =>
      rowToTypedValue(row as unknown as FieldValueRow, fieldType)
    )
    const value = isMulti ? typedValues : typedValues[0]!

    // AI marker lives on a single row per (entity, field). Multi-value fields
    // don't carry AI markers today — take the first row's marker for safety.
    // `ai-commit.ts` only ever writes 'generating' | 'result' | 'error', so
    // narrowing the broad DB text column to AiStatus here is safe. Metadata
    // lives in the `valueJson` column (no dedicated column), so we go through
    // `readAiMetadata` — the same helper the write path uses — to keep the
    // storage detail in one place.
    const firstRow = fieldRows[0]!
    const aiStatus = (firstRow.aiStatus ?? null) as AiStatus | null
    const aiMetadata = readAiMetadata(firstRow)

    results.push({
      recordId,
      fieldRef,
      value,
      fieldType,
      fieldOptions,
      aiStatus,
      aiMetadata,
    })
  }

  return results
}

// =============================================================================
// VIRTUAL FIELD RESOLUTION
// =============================================================================

/**
 * Fetch virtual field values and map them to TypedFieldValueResult[].
 */
async function fetchVirtualFieldResults(
  ctx: FieldValueContext,
  entityDefinitionId: string,
  entityInstanceIds: string[],
  virtualFields: CategorizedFields['virtualFields'],
  fieldIdToKeyMap: Map<string, string>,
  instanceToRecordId: Map<string, RecordId>
): Promise<TypedFieldValueResult[]> {
  const fieldKeys = virtualFields.map((f) => f.fieldKey)
  const virtualValues = await resolveVirtualFields(
    ctx,
    entityDefinitionId,
    entityInstanceIds,
    fieldKeys,
    fieldIdToKeyMap
  )

  const results: TypedFieldValueResult[] = []

  for (const [entityId, fieldMap] of virtualValues) {
    const recordId = instanceToRecordId.get(entityId)
    if (!recordId) continue

    for (const entry of virtualFields) {
      const value = fieldMap.get(entry.fieldKey)
      if (value) {
        results.push({
          recordId,
          fieldRef: entry.fieldRef,
          value,
          fieldType: entry.fieldType,
          fieldOptions: entry.fieldOptions,
        })
      }
    }
  }

  return results
}

// =============================================================================
// FIELD PATH RESOLUTION
// =============================================================================

/**
 * Resolve a single field reference (direct or path) for multiple source records.
 *
 * - Direct field "product:price": fetch directly
 * - Path ["product:vendor", "vendor:name"]: traverse relationships, then fetch terminal
 *
 * System-aware: handles both FieldValue-backed and system table-backed fields
 * at every hop and at the terminal read.
 */
async function resolveFieldReference(
  ctx: FieldValueContext,
  sourceRecordIds: RecordId[],
  ref: FieldReference
): Promise<TypedFieldValueResult[]> {
  // Normalize to path (direct field becomes single-element path)
  const path: FieldPath = isFieldPath(ref) ? ref : [ref]

  if (path.length === 0) {
    return []
  }

  // Track source → intermediate mappings for final result assembly
  let currentRecordIds = sourceRecordIds
  const traversalMaps: Map<RecordId, RecordId[]>[] = []

  // Process all hops except the last (which is the terminal field)
  for (let depth = 0; depth < path.length - 1; depth++) {
    const resourceFieldId = path[depth]
    const relationshipMap = await fetchRelationshipHop(ctx, currentRecordIds, resourceFieldId)

    traversalMaps.push(relationshipMap)

    // Collect all related IDs for next depth
    const nextRecordIds: RecordId[] = []
    for (const relatedIds of relationshipMap.values()) {
      nextRecordIds.push(...relatedIds)
    }

    currentRecordIds = [...new Set(nextRecordIds)]

    if (currentRecordIds.length === 0) {
      break
    }
  }

  // Fetch terminal field values
  const terminalResourceFieldId = path[path.length - 1]
  const { entityDefinitionId: terminalEntityId, fieldId: terminalFieldId } =
    parseResourceFieldId(terminalResourceFieldId)

  const terminalFieldInfo = await getFieldInfoFromRegistry(
    ctx.organizationId,
    terminalEntityId,
    terminalFieldId
  )
  const terminalFieldType = terminalFieldInfo.fieldType
  const terminalFieldOptions = terminalFieldInfo.fieldOptions

  // Handle NAME fields
  if (terminalFieldType === FieldTypeEnum.NAME && currentRecordIds.length > 0) {
    const terminalValues = await resolveNameFieldValues(ctx, currentRecordIds, terminalFieldId)
    return mapResultsToSources(
      sourceRecordIds,
      traversalMaps,
      terminalValues,
      ref,
      terminalFieldType,
      terminalFieldOptions
    )
  }

  const terminalValues =
    currentRecordIds.length > 0
      ? await fetchTerminalFieldValues(
          ctx,
          currentRecordIds,
          terminalEntityId,
          terminalFieldId,
          terminalResourceFieldId,
          terminalFieldType,
          terminalFieldOptions
        )
      : new Map()

  return mapResultsToSources(
    sourceRecordIds,
    traversalMaps,
    terminalValues,
    ref,
    terminalFieldType,
    terminalFieldOptions
  )
}

/**
 * Fetch a single relationship hop — system-aware.
 * For system resources with dbColumn, reads FK from the DB table directly.
 * For FieldValue-backed relationships, uses the existing FieldValue query.
 */
async function fetchRelationshipHop(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  resourceFieldId: ResourceFieldId
): Promise<Map<RecordId, RecordId[]>> {
  const { entityDefinitionId: hopEntityDefId, fieldId } = parseResourceFieldId(resourceFieldId)

  if (isSystemResourceId(hopEntityDefId)) {
    const hopResource = await findCachedResource(ctx.organizationId, hopEntityDefId)
    const cachedField = hopResource?.fields.find((f) => f.id === fieldId || f.key === fieldId)

    if (cachedField?.dbColumn && cachedField.relationship) {
      return batchFetchSystemRelationships(ctx, recordIds, cachedField, hopEntityDefId)
    }
  }

  return batchFetchRelationships(ctx, recordIds, fieldId)
}

/**
 * Fetch terminal field values — system-aware.
 * Delegates to system table resolver, virtual field resolver, or FieldValue query.
 */
async function fetchTerminalFieldValues(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  terminalEntityId: string,
  terminalFieldId: string,
  terminalResourceFieldId: ResourceFieldId,
  terminalFieldType: FieldType,
  terminalFieldOptions?: FieldOptions
): Promise<Map<RecordId, TypedFieldValue | TypedFieldValue[]>> {
  if (!isSystemResourceId(terminalEntityId)) {
    return batchFetchFieldValues(
      ctx,
      recordIds,
      terminalFieldId,
      terminalFieldType,
      terminalFieldOptions
    )
  }

  const termResource = await findCachedResource(ctx.organizationId, terminalEntityId)
  const cachedField = termResource?.fields.find(
    (f) => f.id === terminalFieldId || f.key === terminalFieldId
  )

  if (cachedField?.dbColumn) {
    // System table field — use Layer 1 resolver
    const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)
    const systemResults = await resolveSystemTableFields(
      ctx,
      terminalEntityId as TableId,
      entityInstanceIds,
      [
        {
          fieldKey: cachedField.key,
          fieldId: terminalFieldId,
          fieldRef: terminalResourceFieldId,
          fieldType: terminalFieldType,
          fieldOptions: terminalFieldOptions,
          dbColumn: cachedField.dbColumn,
          relationship: cachedField.relationship,
        },
      ]
    )

    const resultMap = new Map<RecordId, TypedFieldValue | TypedFieldValue[]>()
    for (const r of systemResults) {
      resultMap.set(r.recordId, r.value!)
    }
    return resultMap
  }

  if (cachedField && isVirtualField(terminalEntityId, cachedField.key)) {
    // Virtual field — use Layer 2 resolver
    const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)
    const fieldIdMap = new Map([[cachedField.key, terminalFieldId]])
    const virtualValues = await resolveVirtualFields(
      ctx,
      terminalEntityId,
      entityInstanceIds,
      [cachedField.key],
      fieldIdMap
    )

    // Build instanceId → RecordId lookup
    const instanceToRecordId = new Map<string, RecordId>()
    for (const rid of recordIds) {
      const { entityInstanceId } = parseRecordId(rid)
      instanceToRecordId.set(entityInstanceId, rid)
    }

    const resultMap = new Map<RecordId, TypedFieldValue | TypedFieldValue[]>()
    for (const [entityId, fieldMap] of virtualValues) {
      const rid = instanceToRecordId.get(entityId)
      if (!rid) continue
      const val = fieldMap.get(cachedField.key)
      if (val) resultMap.set(rid, val)
    }
    return resultMap
  }

  // FieldValue-backed — existing path
  return batchFetchFieldValues(
    ctx,
    recordIds,
    terminalFieldId,
    terminalFieldType,
    terminalFieldOptions
  )
}

/**
 * Batch fetch relationship field values.
 * Returns Map: entityId → RecordId[] of related entities
 */
async function batchFetchRelationships(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  fieldId: string
): Promise<Map<RecordId, RecordId[]>> {
  const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)

  const rows = await ctx.db
    .select({
      entityId: schema.FieldValue.entityId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
      relatedEntityDefinitionId: schema.FieldValue.relatedEntityDefinitionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        eq(schema.FieldValue.fieldId, fieldId),
        inArray(schema.FieldValue.entityId, entityInstanceIds)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  // Group by source entityId → related RecordIds
  const result = new Map<RecordId, RecordId[]>()

  // Build lookup: instanceId → full RecordId
  const instanceToRecordId = new Map<string, RecordId>()
  for (const rid of recordIds) {
    const { entityInstanceId } = parseRecordId(rid)
    instanceToRecordId.set(entityInstanceId, rid)
  }

  for (const row of rows) {
    const sourceRecordId = instanceToRecordId.get(row.entityId)
    if (!sourceRecordId || !row.relatedEntityId || !row.relatedEntityDefinitionId) continue

    const relatedRecordId = toRecordId(row.relatedEntityDefinitionId, row.relatedEntityId)

    const existing = result.get(sourceRecordId) ?? []
    existing.push(relatedRecordId)
    result.set(sourceRecordId, existing)
  }

  return result
}

/**
 * Batch fetch terminal (non-relationship) field values.
 */
async function batchFetchFieldValues(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  fieldId: string,
  fieldType: FieldType,
  fieldOptions?: FieldOptions
): Promise<Map<RecordId, TypedFieldValue | TypedFieldValue[]>> {
  const entityInstanceIds = recordIds.map((rid) => parseRecordId(rid).entityInstanceId)

  const rows = await ctx.db
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        eq(schema.FieldValue.fieldId, fieldId),
        inArray(schema.FieldValue.entityId, entityInstanceIds)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  // Build lookup: instanceId → full RecordId
  const instanceToRecordId = new Map<string, RecordId>()
  for (const rid of recordIds) {
    const { entityInstanceId } = parseRecordId(rid)
    instanceToRecordId.set(entityInstanceId, rid)
  }

  // Group rows by record
  const rowsByRecord = new Map<RecordId, typeof rows>()
  for (const row of rows) {
    const recordId = instanceToRecordId.get(row.entityId)
    if (!recordId) continue

    const existing = rowsByRecord.get(recordId) ?? []
    existing.push(row)
    rowsByRecord.set(recordId, existing)
  }

  // Convert to typed values
  const result = new Map<RecordId, TypedFieldValue | TypedFieldValue[]>()
  const isMulti = isArrayReturnFieldType(fieldType, fieldOptions)

  for (const [recordId, fieldRows] of rowsByRecord) {
    const typedValues = fieldRows.map((row) =>
      rowToTypedValue(row as unknown as FieldValueRow, fieldType)
    )
    result.set(recordId, isMulti ? typedValues : typedValues[0]!)
  }

  return result
}

/**
 * Map terminal field values back through the traversal chain to source records.
 *
 * This handles the case where:
 * - Source A → Related B1, B2
 * - B1 → value "X", B2 → value "Y"
 * - Result: A → ["X", "Y"] (if any has_many in chain) or A → "X" (if all single)
 */
function mapResultsToSources(
  sourceRecordIds: RecordId[],
  traversalMaps: Map<RecordId, RecordId[]>[],
  terminalValues: Map<RecordId, TypedFieldValue | TypedFieldValue[]>,
  fieldRef: FieldReference,
  terminalFieldType: FieldType,
  terminalFieldOptions?: FieldOptions
): TypedFieldValueResult[] {
  const results: TypedFieldValueResult[] = []

  // Direct field (no traversal) - just map terminalValues directly
  if (traversalMaps.length === 0) {
    for (const sourceRecordId of sourceRecordIds) {
      const value = terminalValues.get(sourceRecordId)
      if (value !== undefined) {
        results.push({
          recordId: sourceRecordId,
          fieldRef,
          value,
          fieldType: terminalFieldType,
          fieldOptions: terminalFieldOptions,
        })
      }
    }
    return results
  }

  // Path with traversal - walk through maps
  for (const sourceRecordId of sourceRecordIds) {
    // Walk the traversal maps to collect all terminal record IDs reachable from source
    let currentIds: RecordId[] = [sourceRecordId]
    let hasMultiHop = false

    for (const map of traversalMaps) {
      const nextIds: RecordId[] = []
      for (const id of currentIds) {
        const related = map.get(id) ?? []
        nextIds.push(...related)
        if (related.length > 1) hasMultiHop = true
      }
      currentIds = nextIds
      if (currentIds.length === 0) break
    }

    // Collect terminal values for all reachable terminal records
    const values: TypedFieldValue[] = []
    for (const terminalId of currentIds) {
      const value = terminalValues.get(terminalId)
      if (value) {
        if (Array.isArray(value)) {
          values.push(...value)
        } else {
          values.push(value)
        }
      }
    }

    // Determine result shape based on traversal cardinality
    // If any hop produced multiple results, or terminal field is multi-value, return array
    // Otherwise, return single value or null
    if (values.length > 0) {
      const isMultiValueField = isArrayReturnFieldType(terminalFieldType, terminalFieldOptions)
      const shouldBeArray = hasMultiHop || values.length > 1 || isMultiValueField

      results.push({
        recordId: sourceRecordId,
        fieldRef,
        value: shouldBeArray ? values : (values[0] ?? null),
        fieldType: terminalFieldType,
        fieldOptions: terminalFieldOptions,
      })
    }
  }

  return results
}

// =============================================================================
// COMPUTED FIELD RESOLUTION
// =============================================================================

/**
 * Resolve NAME field values by fetching source fields (firstName, lastName)
 * and composing a TypedFieldValue with type NAME.
 *
 * Falls back to empty map if the NAME field's options.name is not linked.
 */
async function resolveNameFieldValues(
  ctx: FieldValueContext,
  recordIds: RecordId[],
  nameFieldId: string
): Promise<Map<RecordId, TypedFieldValue | TypedFieldValue[]>> {
  // Look up the NAME field to get source field IDs
  const nameField = await getField(ctx, nameFieldId)
  const nameOptions = (nameField.options as Record<string, any>)?.name as
    | NameFieldOptions
    | undefined

  if (!nameOptions?.firstNameFieldId || !nameOptions?.lastNameFieldId) {
    return new Map()
  }

  // Fetch both source fields in parallel
  const [firstNameValues, lastNameValues] = await Promise.all([
    batchFetchFieldValues(
      ctx,
      recordIds,
      nameOptions.firstNameFieldId,
      FieldTypeEnum.TEXT as FieldType
    ),
    batchFetchFieldValues(
      ctx,
      recordIds,
      nameOptions.lastNameFieldId,
      FieldTypeEnum.TEXT as FieldType
    ),
  ])

  // Compose NAME values from source fields
  const result = new Map<RecordId, TypedFieldValue | TypedFieldValue[]>()

  for (const recordId of recordIds) {
    const firstNameTyped = firstNameValues.get(recordId)
    const lastNameTyped = lastNameValues.get(recordId)

    const firstName =
      firstNameTyped && !Array.isArray(firstNameTyped) ? (firstNameTyped.value as string) : ''
    const lastName =
      lastNameTyped && !Array.isArray(lastNameTyped) ? (lastNameTyped.value as string) : ''

    if (firstName || lastName) {
      result.set(recordId, {
        type: 'NAME',
        value: JSON.stringify({ firstName, lastName }),
      } as TypedFieldValue)
    }
  }

  return result
}
