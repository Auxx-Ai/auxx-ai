// packages/services/src/field-values/get-field-with-definition.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { FieldNotFoundError, FieldWithDefinition, GetFieldWithDefinitionInput } from './types'

/**
 * Get a CustomField by ID with its associated EntityDefinition.
 * Used for determining field type and whether the field is the primary display field.
 *
 * @param input - Query parameters
 * @returns Result with field and definition, or error
 */
export async function getFieldWithDefinition(input: GetFieldWithDefinitionInput) {
  const { fieldId, organizationId } = input

  const dbResult = await fromDatabase(
    database
      .select({
        id: schema.CustomField.id,
        name: schema.CustomField.name,
        type: schema.CustomField.type,
        options: schema.CustomField.options,
        entityDefinitionId: schema.CustomField.entityDefinitionId,
        entityDefinition: {
          id: schema.EntityDefinition.id,
          primaryDisplayFieldId: schema.EntityDefinition.primaryDisplayFieldId,
          secondaryDisplayFieldId: schema.EntityDefinition.secondaryDisplayFieldId,
        },
      })
      .from(schema.CustomField)
      .leftJoin(
        schema.EntityDefinition,
        eq(schema.CustomField.entityDefinitionId, schema.EntityDefinition.id)
      )
      .where(
        and(
          eq(schema.CustomField.id, fieldId),
          eq(schema.CustomField.organizationId, organizationId)
        )
      )
      .limit(1),
    'get-field-with-definition'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  const row = dbResult.value[0]
  if (!row) {
    return err({
      code: 'FIELD_NOT_FOUND' as const,
      message: `Field with ID "${fieldId}" not found`,
      fieldId,
    })
  }

  return ok({
    id: row.id,
    name: row.name,
    type: row.type,
    options: row.options,
    entityDefinitionId: row.entityDefinitionId,
    entityDefinition: row.entityDefinition?.id
      ? {
          id: row.entityDefinition.id,
          primaryDisplayFieldId: row.entityDefinition.primaryDisplayFieldId,
          secondaryDisplayFieldId: row.entityDefinition.secondaryDisplayFieldId,
        }
      : null,
  })
}
