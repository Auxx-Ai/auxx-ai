// packages/services/src/custom-fields/delete-field.ts

import { database, schema } from '@auxx/database'
import type { CalcOptions } from '@auxx/types/custom-field'
import { isResourceFieldId, parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { AccessDeniedError, CustomFieldNotFoundError } from './errors'
import { getInverseFieldId, type RelationshipConfig } from './types'

/**
 * Input for deleting a custom field
 */
export interface DeleteCustomFieldInput {
  resourceFieldId: ResourceFieldId
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
  const { resourceFieldId, organizationId } = input

  // Parse ResourceFieldId to get components
  const { fieldId: id } = parseResourceFieldId(resourceFieldId)

  // Get full field data to check type and options
  const fieldResult = await fromDatabase(
    database.select().from(schema.CustomField).where(eq(schema.CustomField.id, id)).limit(1),
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
      fieldId: id as string,
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
  const inverseFieldId =
    isRelationship && relationshipConfig ? getInverseFieldId(relationshipConfig) : null

  // Delete in transaction
  const deleteResult = await fromDatabase(
    database.transaction(async (tx) => {
      // Delete values for primary field from FieldValue table
      await tx.delete(schema.FieldValue).where(eq(schema.FieldValue.fieldId, id))

      // If relationship field with inverse, also delete inverse values and field
      if (inverseFieldId) {
        await tx.delete(schema.FieldValue).where(eq(schema.FieldValue.fieldId, inverseFieldId))

        await tx
          .delete(schema.CustomField)
          .where(
            and(
              eq(schema.CustomField.id, inverseFieldId),
              eq(schema.CustomField.organizationId, organizationId)
            )
          )
      }

      // Find and disable CALC fields that depend on the deleted field
      // Search all CALC fields in org (source fields can reference any entity via relationships)
      const deletedFieldId = id
      const allCalcFields = await tx
        .select()
        .from(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.organizationId, organizationId),
            eq(schema.CustomField.type, 'CALC' as any)
          )
        )

      // Check each CALC field's sourceFields for dependency on deleted field
      const disabledCalcFieldIds: string[] = []
      for (const calcField of allCalcFields) {
        const calcOptions = (calcField.options as { calc?: CalcOptions })?.calc
        if (!calcOptions?.sourceFields) continue

        // sourceFields is Record<placeholderName, ResourceFieldId>
        // Extract plain fieldId from ResourceFieldId format and check if deleted field is referenced
        const sourceFieldIds = Object.values(calcOptions.sourceFields)
        const referencesDeletedField = sourceFieldIds.some((resourceFieldId) => {
          if (isResourceFieldId(resourceFieldId)) {
            const { fieldId } = parseResourceFieldId(resourceFieldId as ResourceFieldId)
            return fieldId === deletedFieldId
          }
          return resourceFieldId === deletedFieldId // fallback for legacy format
        })
        if (referencesDeletedField) {
          // Disable this CALC field
          await tx
            .update(schema.CustomField)
            .set({
              options: {
                ...(calcField.options as Record<string, unknown>),
                calc: {
                  ...calcOptions,
                  disabled: true,
                  disabledReason: `Source field was deleted`,
                },
              },
              updatedAt: new Date(),
            })
            .where(eq(schema.CustomField.id, calcField.id))

          disabledCalcFieldIds.push(calcField.id)
        }
      }

      if (disabledCalcFieldIds.length > 0) {
        console.log(
          `Disabled ${disabledCalcFieldIds.length} CALC fields due to deletion of field ${deletedFieldId}`
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
        disabledCalcFieldIds,
      }
    }),
    'delete-custom-field'
  )

  if (deleteResult.isErr()) {
    return deleteResult
  }

  return ok(deleteResult.value)
}
