// packages/services/src/custom-fields/delete-field-value.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input for deleting a field value
 */
export interface DeleteFieldValueInput {
  entityId: string
  fieldId: string
}

/**
 * Delete a field value (DB operation only)
 *
 * @param input - Value identification
 * @returns Result with deleted value or undefined
 */
export async function deleteFieldValueQuery(input: DeleteFieldValueInput) {
  const { entityId, fieldId } = input

  const deleteResult = await fromDatabase(
    database
      .delete(schema.CustomFieldValue)
      .where(
        and(
          eq(schema.CustomFieldValue.entityId, entityId),
          eq(schema.CustomFieldValue.fieldId, fieldId)
        )
      )
      .returning(),
    'delete-field-value'
  )

  if (deleteResult.isErr()) {
    return deleteResult
  }

  return ok(deleteResult.value[0])
}
