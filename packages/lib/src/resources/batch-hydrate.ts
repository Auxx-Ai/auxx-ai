// packages/lib/src/resources/batch-hydrate.ts

import type { FieldType } from '@auxx/database/types'
import { parseResourceFieldId, toResourceFieldIds } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { getCachedResourceFields } from '../cache'
import { createFieldValueContext, formatToRawValue } from '../field-values'
import { batchGetValues } from '../field-values/field-value-queries'
import { getFieldOutputKey } from './registry/field-types'

/**
 * Batch-hydrate field values onto bare EntityInstance results from a findMany query.
 * Uses batchGetValues (1 query) to fetch all field values for all instances,
 * then converts to raw values and attaches as `fieldValues` on each instance.
 *
 * @param instances - Bare EntityInstance results (from executeCustomEntityQuery)
 * @param entityDefinitionId - The entity definition ID
 * @param organizationId - The organization ID
 * @returns Same instances with `fieldValues` attached
 */
export async function batchHydrateFieldValues(
  instances: any[],
  entityDefinitionId: string,
  organizationId: string
): Promise<any[]> {
  if (instances.length === 0) return instances

  // Get field definitions from org cache
  const fields = await getCachedResourceFields(organizationId, entityDefinitionId)

  // Build field ID list (all non-computed fields that have an id)
  const fieldIds = fields.filter((f) => f.id && f.fieldType).map((f) => f.id!)

  if (fieldIds.length === 0) return instances

  // Build RecordIds and ResourceFieldIds
  const recordIds = instances.map((inst) => toRecordId(entityDefinitionId, inst.id))
  const fieldRefs = toResourceFieldIds(entityDefinitionId, fieldIds)

  // Build field lookup maps
  const fieldById = new Map(fields.filter((f) => f.id).map((f) => [f.id!, f]))
  const fieldTypeById = new Map(
    fields.filter((f) => f.id && f.fieldType).map((f) => [f.id!, f.fieldType as FieldType])
  )

  // Batch fetch all field values in one query
  const ctx = createFieldValueContext(organizationId)
  const result = await batchGetValues(ctx, { recordIds, fieldReferences: fieldRefs })

  // Group results by recordId
  const valuesByRecord = new Map<RecordId, Map<string, any>>()
  for (const { recordId, fieldRef, value } of result.values) {
    if (!valuesByRecord.has(recordId)) {
      valuesByRecord.set(recordId, new Map())
    }

    // Parse fieldRef to get fieldId, then resolve to output key
    const { fieldId } = parseResourceFieldId(fieldRef as string)
    const field = fieldById.get(fieldId)
    const fieldType = fieldTypeById.get(fieldId)

    if (!field || !fieldType) continue

    // Convert TypedFieldValue to raw value
    const rawValue = formatToRawValue(value, fieldType)
    const outputKey = getFieldOutputKey(field)

    // Store by output key (systemAttribute) for resolveNestedObject/variable paths
    valuesByRecord.get(recordId)!.set(outputKey, rawValue)
    // Also store by fieldId (UUID) for list node's getNestedValue with ResourceFieldId format
    if (fieldId !== outputKey) {
      valuesByRecord.get(recordId)!.set(fieldId, rawValue)
    }
  }

  // Attach fieldValues to each instance
  return instances.map((inst) => {
    const recordId = toRecordId(entityDefinitionId, inst.id)
    const fieldMap = valuesByRecord.get(recordId)

    if (!fieldMap || fieldMap.size === 0) return inst

    const fieldValues: Record<string, any> = {}
    for (const [key, val] of fieldMap) {
      fieldValues[key] = val
    }

    return { ...inst, fieldValues }
  })
}
