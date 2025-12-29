// packages/services/src/custom-fields/upsert-field-value.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input for upserting a field value
 */
export interface UpsertFieldValueInput {
  entityId: string
  fieldId: string
  value: any
  existingValueId?: string
}

/**
 * Upsert a field value (DB operation only)
 *
 * @param input - Value data
 * @returns Result with upserted value
 */
export async function upsertFieldValueQuery(input: UpsertFieldValueInput) {
  const { entityId, fieldId, value, existingValueId } = input

  if (existingValueId) {
    // Update existing
    const updateResult = await fromDatabase(
      database
        .update(schema.CustomFieldValue)
        .set({ value })
        .where(
          and(
            eq(schema.CustomFieldValue.entityId, entityId),
            eq(schema.CustomFieldValue.fieldId, fieldId)
          )
        )
        .returning(),
      'update-field-value'
    )

    if (updateResult.isErr()) {
      return updateResult
    }
    return ok(updateResult.value[0])
  } else {
    // Insert new
    const insertResult = await fromDatabase(
      database
        .insert(schema.CustomFieldValue)
        .values({ entityId, fieldId, value, updatedAt: new Date() })
        .returning(),
      'insert-field-value'
    )

    if (insertResult.isErr()) {
      return insertResult
    }
    return ok(insertResult.value[0])
  }
}
