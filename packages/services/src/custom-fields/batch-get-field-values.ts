// packages/services/src/custom-fields/batch-get-field-values.ts

import { database, schema } from '@auxx/database'
import { eq, and, inArray } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ModelType } from './types'

/** Single value result */
export interface FieldValueResult {
  resourceId: string
  fieldId: string
  value: unknown
}

/** Input for batch getting field values */
export interface BatchGetFieldValuesInput {
  /** Resource type: 'contact', 'ticket', or 'entity' */
  resourceType: 'contact' | 'ticket' | 'entity'
  /** Organization ID for authorization */
  orgId: string
  /** Entity definition ID (required for 'entity' type) */
  entityDefId?: string
  /** Resource IDs to fetch values for */
  resourceIds: string[]
  /** Field IDs to fetch */
  fieldIds: string[]
}

/**
 * Batch get field values for multiple resources and fields.
 * Returns null for missing values (field exists but no value set).
 *
 * All resource types (contact, ticket, entity) use the CustomFieldValue table.
 * The query joins with CustomField to filter by modelType and organization.
 */
export async function batchGetFieldValuesQuery(input: BatchGetFieldValuesInput) {
  const { resourceType, orgId, entityDefId, resourceIds, fieldIds } = input

  // Validate inputs
  if (resourceIds.length === 0 || fieldIds.length === 0) {
    return ok({ values: [] })
  }

  if (resourceType === 'entity' && !entityDefId) {
    return err({ code: 'INVALID_INPUT' as const, message: 'entityDefId required for entity type' })
  }

  // Build model type for CustomField filter
  const modelType = resourceType as ModelType

  // Query custom field values with field metadata
  const dbResult = await fromDatabase(
    database
      .select({
        resourceId: schema.CustomFieldValue.entityId,
        fieldId: schema.CustomFieldValue.fieldId,
        value: schema.CustomFieldValue.value,
      })
      .from(schema.CustomFieldValue)
      .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.CustomFieldValue.fieldId))
      .where(
        and(
          eq(schema.CustomField.modelType, modelType),
          eq(schema.CustomField.organizationId, orgId),
          // For entity type, also filter by entityDefinitionId
          resourceType === 'entity' && entityDefId
            ? eq(schema.CustomField.entityDefinitionId, entityDefId)
            : undefined,
          inArray(schema.CustomFieldValue.entityId, resourceIds),
          inArray(schema.CustomFieldValue.fieldId, fieldIds)
        )
      ),
    'batch-get-custom-field-values'
  )

  if (dbResult.isErr()) return dbResult

  const existingValues = dbResult.value

  // Fill in nulls for missing values (field exists but no value set)
  // This is important so the syncer knows the value was fetched (not missing from store)
  const result: FieldValueResult[] = []
  for (const resourceId of resourceIds) {
    for (const fieldId of fieldIds) {
      const existing = existingValues.find(
        (v) => v.resourceId === resourceId && v.fieldId === fieldId
      )
      result.push(existing ?? { resourceId, fieldId, value: null })
    }
  }

  return ok({ values: result })
}
