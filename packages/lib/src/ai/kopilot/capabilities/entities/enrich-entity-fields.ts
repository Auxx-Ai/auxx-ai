// packages/lib/src/ai/kopilot/capabilities/entities/enrich-entity-fields.ts

import { type Database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { isArrayReturnFieldType } from '@auxx/types/field-value'
import type { RecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedResource } from '../../../../cache/org-cache-helpers'
import { rowsToTypedValues } from '../../../../field-values/field-value-helpers'
import { formatToDisplayValue, formatToRawValue } from '../../../../field-values/formatter'
import type { FieldValueRow } from '../../../../field-values/types'
import { RecordPickerService } from '../../../../resources/picker'
import { isCustomResourceId } from '../../../../resources/registry/types'
import { isRecordId } from '../../../../resources/resource-id'

const logger = createScopedLogger('enrich-entity-fields')

/** Enriched field value with raw data for rich cell rendering */
export interface EnrichedField {
  displayValue: unknown
  rawValue: unknown
  fieldType: FieldType
  options?: Record<string, unknown>
}

/**
 * Enrich entity instances with all custom field values resolved to human-readable labels.
 *
 * Returns a map of recordId → { fieldLabel: EnrichedField } for each entity.
 * Handles batching, relationship resolution, and select option label mapping.
 */
export async function enrichEntitiesWithFieldValues(params: {
  organizationId: string
  userId: string
  db: Database
  entities: Array<{ recordId: string; entityDefinitionId: string; entityInstanceId: string }>
}): Promise<Map<string, Record<string, EnrichedField>>> {
  const { organizationId, userId, db, entities } = params
  const result = new Map<string, Record<string, EnrichedField>>()

  if (entities.length === 0) return result

  // Group entities by entityDefinitionId for batch processing
  const grouped = new Map<string, typeof entities>()
  for (const entity of entities) {
    if (!isCustomResourceId(entity.entityDefinitionId)) continue
    const group = grouped.get(entity.entityDefinitionId) ?? []
    group.push(entity)
    grouped.set(entity.entityDefinitionId, group)
  }

  // Track all relationship recordIds for batch resolution
  const relationshipRecordIds = new Set<string>()
  // Track where relationship values appear so we can replace them later
  const relationshipReplacements: Array<{
    recordId: string
    fieldLabel: string
    relRecordId: string
  }> = []

  for (const [entityDefId, groupEntities] of grouped) {
    const resource = await getCachedResource(organizationId, entityDefId)
    if (!resource) {
      logger.warn('Resource not found for field enrichment', { entityDefId })
      continue
    }

    // Build field metadata lookup: fieldId → { label, fieldType, options }
    const fieldMeta = new Map<
      string,
      { label: string; fieldType: FieldType; options: (typeof resource.fields)[0]['options'] }
    >()
    for (const field of resource.fields) {
      if (!field.fieldType) continue
      fieldMeta.set(field.id, {
        label: field.label,
        fieldType: field.fieldType,
        options: field.options,
      })
    }

    // Batch-fetch all FieldValue rows for entities in this group
    const entityInstanceIds = groupEntities.map((e) => e.entityInstanceId)
    const rows = await db
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.entityId, entityInstanceIds)
        )
      )

    // Group rows by entityId, then by fieldId
    const rowsByEntity = new Map<string, Map<string, FieldValueRow[]>>()
    for (const row of rows) {
      if (!rowsByEntity.has(row.entityId)) rowsByEntity.set(row.entityId, new Map())
      const entityRows = rowsByEntity.get(row.entityId)!
      if (!entityRows.has(row.fieldId)) entityRows.set(row.fieldId, [])
      entityRows.get(row.fieldId)!.push(row as unknown as FieldValueRow)
    }

    // Convert each entity's field values to display format
    for (const entity of groupEntities) {
      const fields: Record<string, EnrichedField> = {}
      const entityFieldRows = rowsByEntity.get(entity.entityInstanceId)

      if (!entityFieldRows) {
        result.set(entity.recordId, fields)
        continue
      }

      // Process fields in resource order (user-configured field order)
      for (const field of resource.fields) {
        const meta = fieldMeta.get(field.id)
        if (!meta) continue

        const fieldRows = entityFieldRows.get(field.id)
        if (!fieldRows || fieldRows.length === 0) continue

        const typedValue = rowsToTypedValues(
          fieldRows,
          meta.fieldType,
          isArrayReturnFieldType(meta.fieldType, { actor: meta.options?.actor })
        )

        if (typedValue === null) continue

        const displayValue = formatToDisplayValue(typedValue, meta.fieldType, meta.options)
        if (displayValue === null || displayValue === undefined) continue

        const rawValue = formatToRawValue(typedValue, meta.fieldType)

        // Track relationship recordIds for batch resolution
        if (meta.fieldType === 'RELATIONSHIP') {
          if (Array.isArray(displayValue)) {
            for (const v of displayValue) {
              if (typeof v === 'string' && isRecordId(v)) {
                relationshipRecordIds.add(v)
                relationshipReplacements.push({
                  recordId: entity.recordId,
                  fieldLabel: meta.label,
                  relRecordId: v,
                })
              }
            }
          } else if (typeof displayValue === 'string' && isRecordId(displayValue)) {
            relationshipRecordIds.add(displayValue)
            relationshipReplacements.push({
              recordId: entity.recordId,
              fieldLabel: meta.label,
              relRecordId: displayValue,
            })
          }
        }

        fields[meta.label] = {
          displayValue,
          rawValue,
          fieldType: meta.fieldType,
          options: meta.options,
        }
      }

      result.set(entity.recordId, fields)
    }
  }

  // Batch-resolve all relationship display names
  if (relationshipRecordIds.size > 0) {
    const pickerService = new RecordPickerService(organizationId, userId, db)
    const resolved = await pickerService.getResourcesByIds([...relationshipRecordIds] as RecordId[])

    // Replace recordIds with display names in enriched displayValue
    for (const replacement of relationshipReplacements) {
      const entityFields = result.get(replacement.recordId)
      if (!entityFields) continue

      const resolvedItem = resolved[replacement.relRecordId as RecordId]
      const displayName = resolvedItem?.displayName ?? replacement.relRecordId

      const enriched = entityFields[replacement.fieldLabel]
      if (!enriched) continue

      if (Array.isArray(enriched.displayValue)) {
        enriched.displayValue = enriched.displayValue.map((v) =>
          v === replacement.relRecordId ? displayName : v
        )
      } else {
        enriched.displayValue = displayName
      }
    }
  }

  return result
}
