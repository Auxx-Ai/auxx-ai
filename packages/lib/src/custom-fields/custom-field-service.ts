// packages/lib/src/custom-fields/custom-field-service.ts

import { database, type Database } from '@auxx/database'
import {
  getCustomFields,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  getRelationshipPair,
  ModelTypes,
  type ModelType,
  type RelationshipOptions,
} from '@auxx/services/custom-fields'
import type { FieldType } from '@auxx/database/types'
import type {
  SelectOption,
  FileOptions,
  DisplayOptions,
} from '@auxx/services/custom-fields'
import type { CurrencyOptions } from '@auxx/types/custom-field'

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
      // Preserve the cause for better error debugging
      throw new Error(result.error.message, { cause: result.error.cause })
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
      options?: SelectOption[] | { file: FileOptions } | { currency: CurrencyOptions } | DisplayOptions
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
      // Preserve the cause for better error debugging
      throw new Error(result.error.message, { cause: result.error.cause })
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
    options?: SelectOption[] | { file: FileOptions } | { currency: CurrencyOptions } | DisplayOptions
    addressComponents?: string[]
    icon?: string
    isCustom?: boolean
    active?: boolean
    sortOrder?: string
    type?: FieldType
    isUnique?: boolean
  }) {
    const result = await updateCustomField({
      ...input,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      // Preserve the cause for better error debugging
      throw new Error(result.error.message, { cause: result.error.cause })
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
      // Preserve the cause for better error debugging
      throw new Error(result.error.message, { cause: result.error.cause })
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
      // Preserve the cause for better error debugging
      throw new Error(result.error.message, { cause: result.error.cause })
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
