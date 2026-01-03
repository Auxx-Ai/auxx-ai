// packages/lib/src/custom-fields/custom-field-service.ts

import { database, type Database } from '@auxx/database'
import {
  getCustomFields,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  updateFieldPositions,
  getRelationshipPair,
  ModelTypes,
  type ModelType,
  type RelationshipOptions,
} from '@auxx/services/custom-fields'
import type { FieldType } from '@auxx/database/types'
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
}

// Re-export for convenience
export { normalizeCustomFieldValue } from '@auxx/services/custom-fields'
