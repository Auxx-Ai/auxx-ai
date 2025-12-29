// packages/services/src/custom-fields/get-field-values.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ModelType } from './types'

/**
 * Input for getting field values
 */
export interface GetFieldValuesInput {
  entityId: string
  modelType: ModelType
}

/**
 * Get all field values for an entity (DB query only)
 *
 * @param input - Query parameters
 * @returns Result with field values
 */
export async function getFieldValuesQuery(input: GetFieldValuesInput) {
  const { entityId, modelType } = input

  const dbResult = await fromDatabase(
    database
      .select({
        id: schema.CustomFieldValue.id,
        entityId: schema.CustomFieldValue.entityId,
        fieldId: schema.CustomFieldValue.fieldId,
        value: schema.CustomFieldValue.value,
        createdAt: schema.CustomFieldValue.createdAt,
        updatedAt: schema.CustomFieldValue.updatedAt,
        field: {
          id: schema.CustomField.id,
          name: schema.CustomField.name,
          type: schema.CustomField.type,
          modelType: schema.CustomField.modelType,
          position: schema.CustomField.position,
          required: schema.CustomField.required,
          description: schema.CustomField.description,
          defaultValue: schema.CustomField.defaultValue,
          options: schema.CustomField.options,
          icon: schema.CustomField.icon,
          isCustom: schema.CustomField.isCustom,
          active: schema.CustomField.active,
          organizationId: schema.CustomField.organizationId,
          createdAt: schema.CustomField.createdAt,
          updatedAt: schema.CustomField.updatedAt,
        },
      })
      .from(schema.CustomFieldValue)
      .innerJoin(schema.CustomField, eq(schema.CustomFieldValue.fieldId, schema.CustomField.id))
      .where(
        and(
          eq(schema.CustomFieldValue.entityId, entityId),
          // modelType is already lowercase and matches DB format
          eq(schema.CustomField.modelType, modelType as any)
        )
      ),
    'get-field-values'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(dbResult.value)
}
