// packages/services/src/field-values/update-value.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { UpdateFieldValueInput, FieldValueRow, FieldValueNotFoundError } from './types'

/**
 * Update an existing field value row.
 * Only updates the value columns, not entityId/fieldId/organizationId.
 *
 * @param input - Update parameters
 * @returns Result with updated row
 */
export async function updateFieldValue(input: UpdateFieldValueInput) {
  const { id, organizationId, ...updateData } = input

  const dbResult = await fromDatabase(
    database
      .update(schema.FieldValue)
      .set({
        valueText: updateData.valueText ?? null,
        valueNumber: updateData.valueNumber ?? null,
        valueBoolean: updateData.valueBoolean ?? null,
        valueDate: updateData.valueDate ?? null,
        valueJson: updateData.valueJson ?? null,
        optionId: updateData.optionId ?? null,
        relatedEntityId: updateData.relatedEntityId ?? null,
        relatedEntityDefinitionId: updateData.relatedEntityDefinitionId ?? null,
      })
      .where(
        and(
          eq(schema.FieldValue.id, id),
          eq(schema.FieldValue.organizationId, organizationId)
        )
      )
      .returning(),
    'update-field-value'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  const row = dbResult.value[0]
  if (!row) {
    return err({
      code: 'FIELD_VALUE_NOT_FOUND' as const,
      message: `Field value with ID "${id}" not found`,
      entityId: '',
      fieldId: '',
    })
  }

  return ok(row as FieldValueRow)
}
