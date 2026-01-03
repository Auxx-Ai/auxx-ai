// packages/services/src/field-values/insert-value.ts

import { database, schema } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { InsertFieldValueInput, FieldValueRow } from './types'

/**
 * Insert a single field value row.
 *
 * @param input - Insert parameters
 * @returns Result with inserted row
 */
export async function insertFieldValue(input: InsertFieldValueInput) {
  const dbResult = await fromDatabase(
    database
      .insert(schema.FieldValue)
      .values({
        organizationId: input.organizationId,
        entityId: input.entityId,
        fieldId: input.fieldId,
        sortKey: input.sortKey,
        valueText: input.valueText ?? null,
        valueNumber: input.valueNumber ?? null,
        valueBoolean: input.valueBoolean ?? null,
        valueDate: input.valueDate ?? null,
        valueJson: input.valueJson ?? null,
        optionId: input.optionId ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
      })
      .returning(),
    'insert-field-value'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(dbResult.value[0] as FieldValueRow)
}

/**
 * Batch insert multiple field value rows.
 *
 * @param inputs - Array of insert parameters
 * @returns Result with inserted rows
 */
export async function batchInsertFieldValues(inputs: InsertFieldValueInput[]) {
  if (inputs.length === 0) {
    return ok([])
  }

  const values = inputs.map((input) => ({
    organizationId: input.organizationId,
    entityId: input.entityId,
    fieldId: input.fieldId,
    sortKey: input.sortKey,
    valueText: input.valueText ?? null,
    valueNumber: input.valueNumber ?? null,
    valueBoolean: input.valueBoolean ?? null,
    valueDate: input.valueDate ?? null,
    valueJson: input.valueJson ?? null,
    optionId: input.optionId ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
  }))

  const dbResult = await fromDatabase(
    database.insert(schema.FieldValue).values(values).returning(),
    'batch-insert-field-values'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok(dbResult.value as FieldValueRow[])
}
