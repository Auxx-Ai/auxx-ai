// packages/services/src/custom-fields/find-by-unique-value.ts

import { database, schema } from '@auxx/database'
import { and, eq, or, sql } from 'drizzle-orm'
import { ok, type Result } from 'neverthrow'

/**
 * Input for finding a record by unique value
 */
export interface FindByUniqueValueInput {
  fieldId: string
  value: unknown
  organizationId: string
  modelType: string
  entityDefinitionId?: string | null
}

/**
 * Normalize a value to string for comparison.
 * Handles both raw values and normalized FieldValue objects ({ data: ... })
 * Returns null if the value is empty/null.
 */
function normalizeValueForComparison(value: unknown): string | null {
  if (value === null || value === undefined) return null

  // Handle normalized { data: ... } object format
  if (typeof value === 'object' && value !== null && 'data' in value) {
    return normalizeValueForComparison((value as { data: unknown }).data)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  if (typeof value === 'number') return String(value)
  return null
}

/**
 * Find a record by its unique custom field value.
 * Uses the FieldValue table with typed columns.
 * Used by data import to match existing records.
 *
 * @param input - Search parameters
 * @returns The entity ID if found, null otherwise
 */
export async function findByUniqueValue(
  input: FindByUniqueValueInput
): Promise<Result<string | null, { code: string; message: string }>> {
  const { fieldId, value, organizationId, modelType, entityDefinitionId } = input

  const valueStr = normalizeValueForComparison(value)
  if (valueStr === null) {
    return ok(null)
  }

  let entityId: string | null = null

  // Build the value match condition - check text and number columns
  // (unique fields are typically TEXT, EMAIL, NUMBER, etc.)
  const valueMatchCondition = or(
    eq(schema.FieldValue.valueText, valueStr),
    // For numbers, try parsing the string
    !Number.isNaN(parseFloat(valueStr))
      ? eq(schema.FieldValue.valueNumber, parseFloat(valueStr))
      : sql`false`
  )

  // All entity types (including contact and ticket) now use EntityInstance.
  // The entityDefinitionId filter scopes to the correct entity type.
  const effectiveEntityDefId = entityDefinitionId ?? modelType

  const result = await database
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.FieldValue.entityId, schema.EntityInstance.id))
    .where(
      and(
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, effectiveEntityDefId),
        valueMatchCondition
      )
    )
    .limit(1)

  entityId = result[0]?.entityId ?? null

  return ok(entityId)
}
