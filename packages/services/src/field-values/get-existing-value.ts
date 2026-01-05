// packages/services/src/field-values/get-existing-value.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { GetExistingValueInput, ExistingFieldValueRow } from './types'

/**
 * Check if a field value already exists for the given entity and field.
 * Used to determine whether to UPDATE or INSERT for single-value fields.
 *
 * @param input - Query parameters
 * @returns Result with existing row or null if no value exists
 */
export async function getExistingFieldValue(input: GetExistingValueInput) {
  const { entityId, fieldId, organizationId } = input

  const dbResult = await fromDatabase(
    database
      .select({
        id: schema.FieldValue.id,
        valueText: schema.FieldValue.valueText,
        valueNumber: schema.FieldValue.valueNumber,
        valueBoolean: schema.FieldValue.valueBoolean,
        valueDate: schema.FieldValue.valueDate,
        valueJson: schema.FieldValue.valueJson,
        optionId: schema.FieldValue.optionId,
        relatedEntityId: schema.FieldValue.relatedEntityId,
        relatedEntityDefinitionId: schema.FieldValue.relatedEntityDefinitionId,
        sortKey: schema.FieldValue.sortKey,
      })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityId),
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, organizationId)
        )
      )
      .limit(1),
    'get-existing-field-value'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(dbResult.value[0] || null)
}
