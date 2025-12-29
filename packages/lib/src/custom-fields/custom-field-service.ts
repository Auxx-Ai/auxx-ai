// packages/lib/src/custom-fields/custom-field-service.ts

import { database, type Database } from '@auxx/database'
import {
  getCustomFields,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  updateFieldPositions,
  getFieldValuesQuery,
  getFieldByIdQuery,
  getExistingValueQuery,
  upsertFieldValueQuery,
  deleteFieldValueQuery,
  verifyEntityExistsQuery,
  normalizeCustomFieldValue,
  getRelationshipPair,
  checkUniqueValue,
  ModelTypes,
  type ModelType,
  type RelationshipOptions,
} from '@auxx/services/custom-fields'
import type { FieldType } from '@auxx/database/types'
import { isBuiltInField, getBuiltInFieldHandler } from './built-in-fields'
import { publisher } from '../events'
import type { ContactFieldUpdatedEvent } from '../events/types'
import type { SelectOption, CurrencyOptions, FileOptions } from '@auxx/services/custom-fields'

/**
 * Service for managing custom fields and their values across different models
 */
export class CustomFieldService {
  organizationId: string
  userId: string
  db: Database

  /**
   * @param organizationId - Current org id
   * @param userId - Current user id
   * @param db - Database instance (not used - we use the imported db directly)
   */
  constructor(organizationId: string, userId: string, db: Database = database) {
    this.organizationId = organizationId
    this.userId = userId
    this.db = db
  }

  /**
   * Get all custom fields for the organization for a specific model type
   *
   * @param modelType - Type of model the fields belong to
   * @param entityDefinitionId - Optional entity definition ID for custom entities
   */
  async getAllFields(modelType: ModelType = ModelTypes.CONTACT, entityDefinitionId?: string) {
    const result = await getCustomFields({
      organizationId: this.organizationId,
      modelType,
      entityDefinitionId,
    })

    if (result.isErr()) {
      throw new Error(result.error.message)
    }

    return result.value
  }

  /**
   * Create a new custom field
   * For RELATIONSHIP type, automatically creates the inverse field
   *
   * @param input - Field data
   * @param modelType - Type of model the field belongs to
   */
  async createField(
    input: {
      name: string
      type: FieldType
      description?: string
      required?: boolean
      defaultValue?: string
      options?: SelectOption[] | { file: FileOptions } | { currency: CurrencyOptions }
      addressComponents?: string[]
      icon?: string
      isCustom?: boolean
      entityDefinitionId?: string | null
      relationship?: RelationshipOptions
      isUnique?: boolean
    },
    modelType: ModelType = ModelTypes.CONTACT
  ) {
    const result = await createCustomField({
      ...input,
      organizationId: this.organizationId,
      modelType,
    })

    if (result.isErr()) {
      throw new Error(result.error.message)
    }

    return result.value
  }

  /**
   * Update a custom field
   *
   * @param input - Field data to update
   */
  async updateField(input: {
    id: string
    name?: string
    description?: string
    required?: boolean
    defaultValue?: string
    options?: SelectOption[] | { file: FileOptions } | { currency: CurrencyOptions }
    addressComponents?: string[]
    icon?: string
    isCustom?: boolean
    active?: boolean
    position?: number
    type?: FieldType
    isUnique?: boolean
  }) {
    const result = await updateCustomField({
      ...input,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      throw new Error(result.error.message)
    }

    return result.value
  }

  /**
   * Delete a custom field and its values
   *
   * @param id - ID of the field to delete
   */
  async deleteField(id: string) {
    const result = await deleteCustomField({
      id,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      throw new Error(result.error.message)
    }

    return result.value
  }

  /**
   * Get all field values for a specific entity
   *
   * @param entityId - ID of the entity (contact, company, thread, ticket)
   * @param modelType - Type of model the values belong to
   */
  async getValues(entityId: string, modelType: ModelType = ModelTypes.CONTACT) {
    // First verify entity belongs to organization
    const entityCheck = await verifyEntityExistsQuery({
      organizationId: this.organizationId,
      entityId,
      modelType,
    })

    if (entityCheck.isErr()) {
      throw new Error(entityCheck.error.message)
    }

    const result = await getFieldValuesQuery({ entityId, modelType })

    if (result.isErr()) {
      throw new Error(result.error.message)
    }

    return result.value
  }

  /**
   * Set a field value for an entity
   *
   * @param params - Value parameters
   */
  async setValue({
    entityId,
    fieldId,
    value,
    modelType = ModelTypes.CONTACT,
  }: {
    entityId: string
    fieldId: string
    value: any
    modelType?: ModelType
  }) {
    // Verify entity belongs to organization
    const entityCheck = await verifyEntityExistsQuery({
      organizationId: this.organizationId,
      entityId,
      modelType,
    })

    if (entityCheck.isErr()) {
      throw new Error(entityCheck.error.message)
    }

    // Check if this is a built-in field
    if (isBuiltInField(fieldId, modelType)) {
      const handler = getBuiltInFieldHandler(fieldId, modelType)
      if (handler) {
        await handler(this.db, entityId, value, this.organizationId)
        return { entityId, fieldId, value }
      }
      throw new Error(`Built-in field ${fieldId} has no handler`)
    }

    // Get field definition
    const fieldResult = await getFieldByIdQuery({
      fieldId,
      organizationId: this.organizationId,
      modelType,
    })

    if (fieldResult.isErr()) {
      throw new Error(fieldResult.error.message)
    }

    const field = fieldResult.value
    if (!field) {
      throw new Error('Field not found')
    }

    // Get existing value
    const existingResult = await getExistingValueQuery({ entityId, fieldId })

    if (existingResult.isErr()) {
      throw new Error(existingResult.error.message)
    }

    const oldValue = existingResult.value?.value

    // Normalize value based on field type
    const normalizedValue = normalizeCustomFieldValue(value, {
      type: field.type,
      name: field.name,
      options: field.options,
    })

    // Check uniqueness if field is marked as unique
    if (field.isUnique) {
      const uniqueCheck = await checkUniqueValue({
        fieldId,
        value: normalizedValue,
        organizationId: this.organizationId,
        modelType,
        entityDefinitionId: field.entityDefinitionId,
        excludeEntityId: entityId, // Exclude current record for updates
      })

      if (uniqueCheck.isErr()) {
        throw new Error(`${field.name} must be unique: ${uniqueCheck.error.message}`)
      }
    }

    // Upsert value
    const upsertResult = await upsertFieldValueQuery({
      entityId,
      fieldId,
      value: normalizedValue,
      existingValueId: existingResult.value?.id,
    })

    if (upsertResult.isErr()) {
      throw new Error(upsertResult.error.message)
    }

    // Publish event for contacts
    if (modelType === ModelTypes.CONTACT && this.userId) {
      await publisher.publishLater({
        type: 'contact:field:updated',
        data: {
          contactId: entityId,
          organizationId: this.organizationId,
          userId: this.userId,
          fieldId: field.id,
          fieldName: field.name,
          fieldType: field.type,
          oldValue,
          newValue: normalizedValue,
        },
      } as ContactFieldUpdatedEvent)
    }

    return upsertResult.value
  }

  /**
   * Delete a field value for an entity
   *
   * @param params - Parameters to identify the value
   */
  async deleteValue({
    entityId,
    fieldId,
    modelType = ModelTypes.CONTACT,
  }: {
    entityId: string
    fieldId: string
    modelType?: ModelType
  }) {
    // Verify entity belongs to organization
    const entityCheck = await verifyEntityExistsQuery({
      organizationId: this.organizationId,
      entityId,
      modelType,
    })

    if (entityCheck.isErr()) {
      throw new Error(entityCheck.error.message)
    }

    // Verify the field exists and belongs to the organization and model type
    const fieldResult = await getFieldByIdQuery({
      fieldId,
      organizationId: this.organizationId,
      modelType,
    })

    if (fieldResult.isErr()) {
      throw new Error(fieldResult.error.message)
    }

    if (!fieldResult.value) {
      throw new Error('Field not found or does not match model type')
    }

    const deleteResult = await deleteFieldValueQuery({ entityId, fieldId })

    if (deleteResult.isErr()) {
      throw new Error(deleteResult.error.message)
    }

    return deleteResult.value
  }

  /**
   * Update the positions of multiple custom fields in bulk
   *
   * @param params - Object containing array of {id, position} and modelType
   * @returns Success object
   */
  async updatePositions({
    positions,
    modelType = ModelTypes.CONTACT,
  }: {
    positions: { id: string; position: number }[]
    modelType?: ModelType
  }) {
    const result = await updateFieldPositions({
      organizationId: this.organizationId,
      positions,
      modelType,
    })

    if (result.isErr()) {
      throw new Error(result.error.message)
    }

    return result.value
  }

  /**
   * Get both sides of a relationship field
   *
   * @param fieldId - ID of the relationship field
   * @returns Object with primary and inverse fields
   */
  async getRelationshipPair(fieldId: string) {
    const result = await getRelationshipPair({
      fieldId,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      throw new Error(result.error.message)
    }

    return result.value
  }

  /**
   * Check if a field is a relationship field
   *
   * @param field - Field object with type property
   * @returns True if field is a RELATIONSHIP type
   */
  isRelationshipField(field: { type: string }): boolean {
    return field.type === 'RELATIONSHIP'
  }

  /**
   * Set multiple field values for an entity in a batch operation
   * Uses Promise.all for parallel saves
   *
   * @param params - Batch value parameters
   * @returns Array of results from each setValue call
   */
  async setValues({
    entityId,
    values,
    modelType = ModelTypes.CONTACT,
  }: {
    entityId: string
    values: Array<{ fieldId: string; value: any }>
    modelType?: ModelType
  }) {
    // Filter out empty values
    const validValues = values.filter(
      (v) => v.value !== undefined && v.value !== null && v.value !== ''
    )

    if (validValues.length === 0) {
      return []
    }

    // Use Promise.all for parallel saves
    const results = await Promise.all(
      validValues.map((v) =>
        this.setValue({
          entityId,
          fieldId: v.fieldId,
          value: v.value,
          modelType,
        })
      )
    )

    return results
  }

  /**
   * Set custom field values for multiple entities at once
   * Updates all entities in parallel for better performance
   * @param params - Object containing entityIds, values, and modelType
   * @returns Count of successfully updated entities
   */
  async bulkSetValues({
    entityIds,
    values,
    modelType = ModelTypes.CONTACT,
  }: {
    entityIds: string[]
    values: Array<{ fieldId: string; value: unknown }>
    modelType?: ModelType
  }): Promise<{ count: number }> {
    const validValues = values.filter(
      (v) => v.value !== undefined && v.value !== null && v.value !== ''
    )

    if (validValues.length === 0 || entityIds.length === 0) {
      return { count: 0 }
    }

    // Update all entities in parallel
    const results = await Promise.allSettled(
      entityIds.map((entityId) =>
        this.setValues({
          entityId,
          values: validValues,
          modelType,
        })
      )
    )

    const count = results.filter((r) => r.status === 'fulfilled').length
    return { count }
  }
}

// Re-export for convenience
export { normalizeCustomFieldValue } from '@auxx/services/custom-fields'
