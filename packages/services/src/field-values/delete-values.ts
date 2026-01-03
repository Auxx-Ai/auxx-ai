// packages/services/src/field-values/delete-values.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { DeleteFieldValuesInput } from './types'

/**
 * Delete all field values for a given entity and field.
 * Used for multi-value fields (DELETE all then INSERT all).
 *
 * @param input - Delete parameters
 * @returns Result with void on success
 */
export async function deleteFieldValues(input: DeleteFieldValuesInput) {
  const { entityId, fieldId, organizationId } = input

  const dbResult = await fromDatabase(
    database
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityId),
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, organizationId)
        )
      ),
    'delete-field-values'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(undefined)
}

/**
 * Delete a single field value by ID.
 * Used for removing one value from a multi-value field.
 *
 * @param id - Field value ID
 * @param organizationId - Organization ID for security
 * @returns Result with void on success
 */
export async function deleteFieldValueById(id: string, organizationId: string) {
  const dbResult = await fromDatabase(
    database
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.id, id),
          eq(schema.FieldValue.organizationId, organizationId)
        )
      ),
    'delete-field-value-by-id'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(undefined)
}
