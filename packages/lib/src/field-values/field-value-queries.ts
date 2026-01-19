// packages/lib/src/field-values/field-value-queries.ts

import { schema } from '@auxx/database'
import { type FieldType } from '@auxx/database/types'
import { and, eq, inArray, asc } from 'drizzle-orm'
import { type TypedFieldValue, isArrayReturnFieldType } from '@auxx/types'
import type { FieldWithDefinition } from '@auxx/services'
import { parseRecordId, toRecordId } from '../resources/resource-id'
import type { RecordId } from '@auxx/types/resource'
import { ResourceRegistryService } from '../resources/registry/resource-registry-service'
import {
  type FieldPath,
  type FieldReference,
  type ResourceFieldId,
  isFieldPath,
  parseResourceFieldId,
} from '@auxx/types/field'
import type {
  GetValueInput,
  GetValuesInput,
  BatchGetValuesInput,
  TypedFieldValueResult,
  BatchFieldValueResult,
  FieldValueRow,
} from './types'
import {
  type FieldValueContext,
  getField,
  rowToTypedValue,
  rowsToTypedValues,
  isValidTypedValue,
  validateRowReferences,
  getFieldTypeMapByDefinition,
  validateFieldReferences,
  getFieldTypeFromRegistry,
} from './field-value-helpers'

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
 * @param cachedField - Optional pre-fetched FieldWithDefinition to avoid lookup
 * @returns TypedFieldValue | TypedFieldValue[] | null
 *
 * @example
 * const email = await getValue(ctx, { recordId: "contact:abc123", fieldId: "field-email" })
 */
export async function getValue(
  ctx: FieldValueContext,
  params: GetValueInput,
  cachedField?: FieldWithDefinition
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
    isArrayReturnFieldType(field.type)
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
    const fieldValueRows = fieldRows.map((r) => r.FieldValue as unknown as FieldValueRow)
    const typedValues = rowsToTypedValues(
      fieldValueRows,
      fieldType,
      isArrayReturnFieldType(fieldType)
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
  registryService: ResourceRegistryService,
  params: BatchGetValuesInput
): Promise<BatchFieldValueResult> {
  const { recordIds, fieldReferences } = params

  if (recordIds.length === 0 || fieldReferences.length === 0) {
    return { values: [] }
  }

  // Validate all field references upfront (fail-fast)
  await validateFieldReferences(registryService, fieldReferences)

  const results: TypedFieldValueResult[] = []

  for (const ref of fieldReferences) {
    const refResults = await resolveFieldReference(ctx, registryService, recordIds, ref)
    results.push(...refResults)
  }

  return { values: results }
}

// =============================================================================
// FIELD PATH RESOLUTION
// =============================================================================

/**
 * Resolve a single field reference (direct or path) for multiple source records.
 *
 * - Direct field "product:price": fetch directly
 * - Path ["product:vendor", "vendor:name"]: traverse relationships, then fetch terminal
 */
async function resolveFieldReference(
  ctx: FieldValueContext,
  registryService: ResourceRegistryService,
  sourceRecordIds: RecordId[],
  ref: FieldReference
): Promise<TypedFieldValueResult[]> {
  // Normalize to path (direct field becomes single-element path)
  const path: FieldPath = isFieldPath(ref) ? ref : [ref]

  if (path.length === 0) {
    return []
  }

  // Track source → intermediate mappings for final result assembly
  // Map: sourceRecordId → relatedRecordIds at each depth
  let currentRecordIds = sourceRecordIds
  const traversalMaps: Map<RecordId, RecordId[]>[] = []

  // Process all hops except the last (which is the terminal field)
  for (let depth = 0; depth < path.length - 1; depth++) {
    const resourceFieldId = path[depth]
    const { fieldId } = parseResourceFieldId(resourceFieldId)

    // Fetch relationships at this depth
    const relationshipMap = await batchFetchRelationships(ctx, currentRecordIds, fieldId)

    traversalMaps.push(relationshipMap)

    // Collect all related IDs for next depth
    const nextRecordIds: RecordId[] = []
    for (const relatedIds of relationshipMap.values()) {
      nextRecordIds.push(...relatedIds)
    }

    // Dedupe for efficiency
    currentRecordIds = [...new Set(nextRecordIds)]

    // Early exit if no records to fetch
    if (currentRecordIds.length === 0) {
      break
    }
  }

  // Fetch terminal field values
  const terminalResourceFieldId = path[path.length - 1]
  const { entityDefinitionId: terminalEntityId, fieldId: terminalFieldId } =
    parseResourceFieldId(terminalResourceFieldId)

  // Get field type for the terminal field
  const terminalFieldType = await getFieldTypeFromRegistry(
    registryService,
    terminalEntityId,
    terminalFieldId
  )

  const terminalValues =
    currentRecordIds.length > 0
      ? await batchFetchFieldValues(ctx, currentRecordIds, terminalFieldId, terminalFieldType)
      : new Map()

  // Map terminal values back to source records
  return mapResultsToSources(sourceRecordIds, traversalMaps, terminalValues, ref, terminalFieldType)
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
  fieldType: FieldType
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
  const isMulti = isArrayReturnFieldType(fieldType)

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
  terminalFieldType: FieldType
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
      const isMultiValueField = isArrayReturnFieldType(terminalFieldType)
      const shouldBeArray = hasMultiHop || values.length > 1 || isMultiValueField

      results.push({
        recordId: sourceRecordId,
        fieldRef,
        value: shouldBeArray ? values : values[0] ?? null,
      })
    }
  }

  return results
}
