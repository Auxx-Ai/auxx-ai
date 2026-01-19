// packages/lib/src/field-values/field-value-queries.ts

import { schema } from '@auxx/database'
import { type FieldType } from '@auxx/database/types'
import { and, eq, inArray, asc } from 'drizzle-orm'
import { type TypedFieldValue, isArrayReturnFieldType } from '@auxx/types'
import type { FieldWithDefinition } from '@auxx/services'
import { parseRecordId, toRecordId } from '../resources/resource-id'
import type { RecordId } from '@auxx/types/resource'
import { ResourceRegistryService } from '../resources/registry/resource-registry-service'
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
 * Efficiently get field values for multiple entities in a single batch query.
 *
 * Uses the RecordId format (entityDefinitionId:entityInstanceId) which encodes
 * both the entity type and instance in a single value.
 *
 * Returns a normalized array with one result per entity+field combination that has a value.
 * Missing combinations are omitted (rather than returning null for each missing field).
 *
 * @param ctx - Field value context
 * @param registryService - Resource registry service for field type lookups
 * @param params - The BatchGetValuesInput object
 * @param params.recordIds - Array of RecordIds in format "entityDefinitionId:entityInstanceId"
 * @param params.fieldIds - Array of field UUIDs to retrieve
 *
 * @returns BatchFieldValueResult containing:
 *          - values: Array of TypedFieldValueResult, one per entity+field with actual data
 *
 * @example
 * const result = await batchGetValues(ctx, registryService, {
 *   recordIds: ["contact:contact-1", "contact:contact-2"],
 *   fieldIds: ["field-email", "field-name"]
 * });
 */
export async function batchGetValues(
  ctx: FieldValueContext,
  registryService: ResourceRegistryService,
  params: BatchGetValuesInput
): Promise<BatchFieldValueResult> {
  const { recordIds, fieldIds } = params

  if (recordIds.length === 0 || fieldIds.length === 0) {
    return { values: [] }
  }

  // Parse RecordIds to extract entityInstanceIds for DB query
  const parsedResources = recordIds.map((rid) => parseRecordId(rid))
  const entityInstanceIds = parsedResources.map((p) => p.entityInstanceId)

  // Create lookup: instanceId -> RecordId
  const instanceToRecordId = new Map<string, RecordId>()
  for (const parsed of parsedResources) {
    instanceToRecordId.set(
      parsed.entityInstanceId,
      toRecordId(parsed.entityDefinitionId, parsed.entityInstanceId)
    )
  }

  // Get unique entityDefinitionIds for field type lookups
  const uniqueEntityDefIds = [...new Set(parsedResources.map((p) => p.entityDefinitionId))]

  // Query field values using instance IDs
  const rows = await ctx.db
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, ctx.organizationId),
        inArray(schema.FieldValue.entityId, entityInstanceIds),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))

  // Group by entityId + fieldId
  const valueMap = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.entityId}:${row.fieldId}`
    const existing = valueMap.get(key) ?? []
    existing.push(row)
    valueMap.set(key, existing)
  }

  // Build combined field type map from all entity definitions
  const fieldTypeMap = new Map<string, FieldType>()
  for (const entityDefId of uniqueEntityDefIds) {
    const typeMap = await getFieldTypeMapByDefinition(registryService, entityDefId, fieldIds)
    for (const [fid, ftype] of typeMap) {
      fieldTypeMap.set(fid, ftype)
    }
  }

  // Build result with validation (only include combinations that have actual data)
  const results: TypedFieldValueResult[] = []
  for (const instanceId of entityInstanceIds) {
    const fullRecordId = instanceToRecordId.get(instanceId)
    if (!fullRecordId) continue

    for (const fieldId of fieldIds) {
      const key = `${instanceId}:${fieldId}`
      const fieldRows = valueMap.get(key)
      const issues: string[] = []

      // Skip combinations with no data - only return values that exist
      if (!fieldRows || fieldRows.length === 0) {
        continue
      } else {
        const fieldType = fieldTypeMap.get(fieldId)

        if (!fieldType) {
          // Field definition not found - orphaned reference
          issues.push(`Field type not found for field ${fieldId}`)
          results.push({
            recordId: fullRecordId,
            fieldId,
            value: null,
            issues,
          })
          continue
        }

        const typedValues = fieldRows.map((row) => {
          const typed = rowToTypedValue(row as unknown as FieldValueRow, fieldType)
          // Check for invalid values
          if (!isValidTypedValue(typed, fieldType)) {
            issues.push(`Invalid value for ${fieldType} field`)
          }
          return typed
        })

        // Check for orphaned option/relationship references
        for (const row of fieldRows) {
          const rowIssues = validateRowReferences(row as unknown as FieldValueRow, fieldType)
          issues.push(...rowIssues)
        }

        // Build the result with proper value assignment
        const resultValue = isArrayReturnFieldType(fieldType)
          ? typedValues
          : typedValues[0]!

        const result: TypedFieldValueResult = {
          recordId: fullRecordId,
          fieldId,
          value: resultValue,
        }

        if (issues.length > 0) {
          result.issues = issues
        }

        results.push(result)
      }
    }
  }

  return { values: results }
}
