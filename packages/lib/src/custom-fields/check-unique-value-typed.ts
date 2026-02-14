// packages/lib/src/custom-fields/check-unique-value-typed.ts

import type { ModelType } from '@auxx/database'
import { type Database, database, schema } from '@auxx/database'
import type { TypedFieldValueInput } from '@auxx/types'
import { and, eq, ne, sql } from 'drizzle-orm'

/**
 * Input for checking if a value is unique for a field
 */
export interface CheckUniqueValueTypedInput {
  fieldId: string
  value: TypedFieldValueInput | TypedFieldValueInput[] | null
  organizationId: string
  modelType: ModelType
  entityDefinitionId?: string | null
  excludeEntityId?: string
}

/**
 * Check if a typed field value is unique within its scope.
 * Uses the new FieldValue table with typed columns.
 *
 * @param input - Check parameters
 * @returns True if value is unique, throws error if not
 */
export async function checkUniqueValueTyped(
  input: CheckUniqueValueTypedInput,
  db: Database = database
): Promise<boolean> {
  const { fieldId, value, organizationId, modelType, entityDefinitionId, excludeEntityId } = input

  // Null values are always allowed (no uniqueness constraint)
  if (value === null) {
    return true
  }

  // For arrays, we don't support uniqueness checking on multi-value fields
  if (Array.isArray(value)) {
    return true
  }

  // Build the value condition based on type
  let valueCondition: ReturnType<typeof sql> | undefined

  switch (value.type) {
    case 'text':
      valueCondition = eq(schema.FieldValue.valueText, value.value)
      break
    case 'number':
      valueCondition = eq(schema.FieldValue.valueNumber, value.value)
      break
    case 'boolean':
      valueCondition = eq(schema.FieldValue.valueBoolean, value.value)
      break
    case 'date':
      valueCondition = eq(
        schema.FieldValue.valueDate,
        typeof value.value === 'string' ? value.value : value.value.toISOString()
      )
      break
    case 'option':
      valueCondition = eq(schema.FieldValue.optionId, value.optionId)
      break
    case 'relationship':
      valueCondition = eq(schema.FieldValue.relatedEntityId, value.relatedEntityId)
      break
    case 'json':
      // JSON fields are not typically unique, but support it anyway
      valueCondition = sql`${schema.FieldValue.valueJson}::text = ${JSON.stringify(value.value)}`
      break
  }

  if (!valueCondition) {
    return true
  }

  // Query for existing values with the same value
  const query = db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.CustomField.modelType, modelType),
        entityDefinitionId
          ? eq(schema.CustomField.entityDefinitionId, entityDefinitionId)
          : undefined,
        excludeEntityId ? ne(schema.FieldValue.entityId, excludeEntityId) : undefined,
        valueCondition
      )
    )
    .limit(1)

  const result = await query

  if (result.length > 0) {
    throw new Error('Value already exists')
  }

  return true
}
