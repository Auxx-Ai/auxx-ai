// packages/services/src/custom-fields/get-existing-value.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input for getting an existing field value
 */
export interface GetExistingValueInput {
  entityId: string
  fieldId: string
}

/**
 * Get an existing field value (DB query only)
 *
 * @param input - Query parameters
 * @returns Result with existing value or null
 */
export async function getExistingValueQuery(input: GetExistingValueInput) {
  const { entityId, fieldId } = input

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.CustomFieldValue)
      .where(
        and(
          eq(schema.CustomFieldValue.entityId, entityId),
          eq(schema.CustomFieldValue.fieldId, fieldId)
        )
      )
      .limit(1),
    'get-existing-value'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(dbResult.value[0] || null)
}
