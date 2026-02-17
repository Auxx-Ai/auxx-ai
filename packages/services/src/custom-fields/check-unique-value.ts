// packages/services/src/custom-fields/check-unique-value.ts

import { database, schema } from '@auxx/database'
import { and, eq, ne, or, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'

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
 * Uses the FieldValue table with typed columns.
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
        valueMatchCondition,
        excludeEntityId ? ne(schema.FieldValue.entityId, excludeEntityId) : sql`true`
      )
    )
    .limit(1)

  existingEntityId = result[0]?.entityId ?? null

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
 * Uses the FieldValue table with typed columns.
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
  // All entity types now use EntityInstance - use entityDefinitionId to scope.
  const effectiveEntityDefId = entityDefinitionId ?? modelType

  const query = sql`
    SELECT COALESCE(fv."valueText", fv."valueNumber"::text) as val, COUNT(*) as cnt
    FROM "FieldValue" fv
    JOIN "EntityInstance" ei ON fv."entityId" = ei.id
    WHERE fv."fieldId" = ${fieldId}
      AND fv."organizationId" = ${organizationId}
      AND ei."entityDefinitionId" = ${effectiveEntityDefId}
      AND (fv."valueText" IS NOT NULL OR fv."valueNumber" IS NOT NULL)
    GROUP BY COALESCE(fv."valueText", fv."valueNumber"::text)
    HAVING COUNT(*) > 1
    LIMIT 1
  `

  const result = await database.execute(query)
  return result.rows.length > 0
}
