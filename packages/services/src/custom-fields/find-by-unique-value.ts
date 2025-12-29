// packages/services/src/custom-fields/find-by-unique-value.ts

import { database, schema } from '@auxx/database'
import { eq, and, sql } from 'drizzle-orm'
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
 * Handles both raw values and normalized CustomFieldValue objects ({ data: ... })
 * Returns null if the value is empty/null.
 */
function normalizeValueForComparison(value: unknown): string | null {
  if (value === null || value === undefined) return null

  // Handle normalized CustomFieldValue object format: { data: ... }
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

  if (modelType === 'entity' && entityDefinitionId) {
    const result = await database
      .select({ entityId: schema.CustomFieldValue.entityId })
      .from(schema.CustomFieldValue)
      .innerJoin(
        schema.EntityInstance,
        eq(schema.CustomFieldValue.entityId, schema.EntityInstance.id)
      )
      .where(
        and(
          eq(schema.CustomFieldValue.fieldId, fieldId),
          eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
          eq(schema.EntityInstance.organizationId, organizationId),
          sql`${schema.CustomFieldValue.value}->>'data' = ${valueStr}`
        )
      )
      .limit(1)

    entityId = result[0]?.entityId ?? null
  } else if (modelType === 'contact') {
    const result = await database
      .select({ entityId: schema.CustomFieldValue.entityId })
      .from(schema.CustomFieldValue)
      .innerJoin(schema.Contact, eq(schema.CustomFieldValue.entityId, schema.Contact.id))
      .where(
        and(
          eq(schema.CustomFieldValue.fieldId, fieldId),
          eq(schema.Contact.organizationId, organizationId),
          sql`${schema.CustomFieldValue.value}->>'data' = ${valueStr}`
        )
      )
      .limit(1)

    entityId = result[0]?.entityId ?? null
  } else if (modelType === 'ticket') {
    const result = await database
      .select({ entityId: schema.CustomFieldValue.entityId })
      .from(schema.CustomFieldValue)
      .innerJoin(schema.Ticket, eq(schema.CustomFieldValue.entityId, schema.Ticket.id))
      .where(
        and(
          eq(schema.CustomFieldValue.fieldId, fieldId),
          eq(schema.Ticket.organizationId, organizationId),
          sql`${schema.CustomFieldValue.value}->>'data' = ${valueStr}`
        )
      )
      .limit(1)

    entityId = result[0]?.entityId ?? null
  }

  return ok(entityId)
}
