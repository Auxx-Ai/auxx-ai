// packages/services/src/custom-fields/check-unique-value.ts

import { database, schema } from '@auxx/database'
import { eq, and, ne, sql } from 'drizzle-orm'
import { ok, err, type Result } from 'neverthrow'

/**
 * Input for checking unique value
 */
export interface CheckUniqueValueInput {
  fieldId: string
  value: unknown
  /** Organization ID for scoping */
  organizationId: string
  /** Model type (contact, ticket, entity) */
  modelType: string
  /** Entity definition ID (for custom entities) */
  entityDefinitionId?: string | null
  /** Exclude this entity from the check (for updates) */
  excludeEntityId?: string
}

/**
 * Unique value violation error
 */
export interface UniqueViolation {
  code: 'UNIQUE_VIOLATION'
  message: string
  fieldId: string
  existingEntityId: string
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
  if (typeof value === 'number') {
    return String(value)
  }
  // For complex objects, this shouldn't happen for uniqueable types
  return null
}

/**
 * Check if a value already exists for a unique field within the organization scope.
 * Returns the existing entity ID if a duplicate is found.
 *
 * @param input - Check parameters
 * @returns Result with null if unique, or UniqueViolation error if duplicate found
 */
export async function checkUniqueValue(
  input: CheckUniqueValueInput
): Promise<Result<null, UniqueViolation>> {
  const { fieldId, value, organizationId, modelType, entityDefinitionId, excludeEntityId } = input

  // Normalize value to string for comparison
  const valueStr = normalizeValueForComparison(value)
  if (valueStr === null) {
    // Null/empty values don't violate uniqueness
    return ok(null)
  }

  let existingEntityId: string | null = null

  if (modelType === 'entity' && entityDefinitionId) {
    // Custom entity - join with EntityInstance
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
          sql`${schema.CustomFieldValue.value}->>'data' = ${valueStr}`,
          excludeEntityId ? ne(schema.CustomFieldValue.entityId, excludeEntityId) : sql`true`
        )
      )
      .limit(1)

    existingEntityId = result[0]?.entityId ?? null
  } else if (modelType === 'contact') {
    // Contact - join with Contact table
    const result = await database
      .select({ entityId: schema.CustomFieldValue.entityId })
      .from(schema.CustomFieldValue)
      .innerJoin(schema.Contact, eq(schema.CustomFieldValue.entityId, schema.Contact.id))
      .where(
        and(
          eq(schema.CustomFieldValue.fieldId, fieldId),
          eq(schema.Contact.organizationId, organizationId),
          sql`${schema.CustomFieldValue.value}->>'data' = ${valueStr}`,
          excludeEntityId ? ne(schema.CustomFieldValue.entityId, excludeEntityId) : sql`true`
        )
      )
      .limit(1)

    existingEntityId = result[0]?.entityId ?? null
  } else if (modelType === 'ticket') {
    // Ticket - join with Ticket table
    const result = await database
      .select({ entityId: schema.CustomFieldValue.entityId })
      .from(schema.CustomFieldValue)
      .innerJoin(schema.Ticket, eq(schema.CustomFieldValue.entityId, schema.Ticket.id))
      .where(
        and(
          eq(schema.CustomFieldValue.fieldId, fieldId),
          eq(schema.Ticket.organizationId, organizationId),
          sql`${schema.CustomFieldValue.value}->>'data' = ${valueStr}`,
          excludeEntityId ? ne(schema.CustomFieldValue.entityId, excludeEntityId) : sql`true`
        )
      )
      .limit(1)

    existingEntityId = result[0]?.entityId ?? null
  }

  if (existingEntityId) {
    return err({
      code: 'UNIQUE_VIOLATION',
      message: 'A record with this value already exists',
      fieldId,
      existingEntityId,
    })
  }

  return ok(null)
}

/**
 * Check for existing duplicate values in a field.
 * Used when enabling uniqueness on an existing field.
 *
 * @param fieldId - Field ID to check
 * @param organizationId - Organization ID for scoping
 * @param modelType - Model type (contact, ticket, entity)
 * @param entityDefinitionId - Entity definition ID (for custom entities)
 * @returns True if duplicates exist
 */
export async function checkExistingDuplicates(
  fieldId: string,
  organizationId: string,
  modelType: string,
  entityDefinitionId?: string | null
): Promise<boolean> {
  let query

  if (modelType === 'entity' && entityDefinitionId) {
    query = sql`
      SELECT cfv.value->>'data' as val, COUNT(*) as cnt
      FROM "CustomFieldValue" cfv
      JOIN "EntityInstance" ei ON cfv."entityId" = ei.id
      WHERE cfv."fieldId" = ${fieldId}
        AND ei."entityDefinitionId" = ${entityDefinitionId}
        AND ei."organizationId" = ${organizationId}
        AND cfv.value->>'data' IS NOT NULL
      GROUP BY cfv.value->>'data'
      HAVING COUNT(*) > 1
      LIMIT 1
    `
  } else if (modelType === 'contact') {
    query = sql`
      SELECT cfv.value->>'data' as val, COUNT(*) as cnt
      FROM "CustomFieldValue" cfv
      JOIN "Contact" c ON cfv."entityId" = c.id
      WHERE cfv."fieldId" = ${fieldId}
        AND c."organizationId" = ${organizationId}
        AND cfv.value->>'data' IS NOT NULL
      GROUP BY cfv.value->>'data'
      HAVING COUNT(*) > 1
      LIMIT 1
    `
  } else if (modelType === 'ticket') {
    query = sql`
      SELECT cfv.value->>'data' as val, COUNT(*) as cnt
      FROM "CustomFieldValue" cfv
      JOIN "Ticket" t ON cfv."entityId" = t.id
      WHERE cfv."fieldId" = ${fieldId}
        AND t."organizationId" = ${organizationId}
        AND cfv.value->>'data' IS NOT NULL
      GROUP BY cfv.value->>'data'
      HAVING COUNT(*) > 1
      LIMIT 1
    `
  } else {
    return false
  }

  const result = await database.execute(query)
  return result.rows.length > 0
}
