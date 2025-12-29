// packages/services/src/custom-fields/delete-field.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { RelationshipConfig } from './types'
import type { CustomFieldNotFoundError, AccessDeniedError } from './errors'

/**
 * Input for deleting a custom field
 */
export interface DeleteCustomFieldInput {
  id: string
  organizationId: string
}

/**
 * Delete a custom field and its values
 * For RELATIONSHIP fields, also deletes the inverse field and its values
 *
 * @param input - Field identification
 * @returns Result with success status
 */
export async function deleteCustomField(input: DeleteCustomFieldInput) {
  const { id, organizationId } = input

  // Get full field data to check type and options
  const fieldResult = await fromDatabase(
    database
      .select()
      .from(schema.CustomField)
      .where(eq(schema.CustomField.id, id))
      .limit(1),
    'get-field-for-delete'
  )

  if (fieldResult.isErr()) {
    return fieldResult
  }

  const field = fieldResult.value[0]
  if (!field) {
    return err({
      code: 'CUSTOM_FIELD_NOT_FOUND',
      message: 'Field not found',
      fieldId: id,
    } as CustomFieldNotFoundError)
  }

  if (field.organizationId !== organizationId) {
    return err({
      code: 'ACCESS_DENIED',
      message: 'Access denied',
    } as AccessDeniedError)
  }

  // Check if it's a relationship field with an inverse
  const isRelationship = field.type === 'RELATIONSHIP'
  const relationshipConfig = (field.options as { relationship?: RelationshipConfig })?.relationship
  const inverseFieldId = isRelationship ? relationshipConfig?.inverseFieldId : null

  // Delete in transaction
  const deleteResult = await fromDatabase(
    database.transaction(async (tx) => {
      // Delete values for primary field
      await tx.delete(schema.CustomFieldValue).where(eq(schema.CustomFieldValue.fieldId, id))

      // If relationship field with inverse, also delete inverse values and field
      if (inverseFieldId) {
        await tx
          .delete(schema.CustomFieldValue)
          .where(eq(schema.CustomFieldValue.fieldId, inverseFieldId))

        await tx
          .delete(schema.CustomField)
          .where(
            and(
              eq(schema.CustomField.id, inverseFieldId),
              eq(schema.CustomField.organizationId, organizationId)
            )
          )
      }

      // Delete primary field
      await tx
        .delete(schema.CustomField)
        .where(
          and(eq(schema.CustomField.id, id), eq(schema.CustomField.organizationId, organizationId))
        )

      return {
        success: true,
        deletedFieldIds: inverseFieldId ? [id, inverseFieldId] : [id],
      }
    }),
    'delete-custom-field'
  )

  if (deleteResult.isErr()) {
    return deleteResult
  }

  return ok(deleteResult.value)
}
