// packages/lib/src/custom-fields/custom-field-service.ts

import { type Database, database } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import type { DisplayOptions, FileOptions, SelectOption } from '@auxx/services/custom-fields'
import {
  createCustomField,
  deleteCustomField,
  getCustomFields,
  getRelationshipPair,
  type RelationshipOptions,
  updateCustomField,
} from '@auxx/services/custom-fields'
import type { CurrencyOptions } from '@auxx/types/custom-field'
import type { ResourceFieldId } from '@auxx/types/field'

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
   * Get all custom fields for the organization by entity definition ID
   *
   * @param entityDefinitionId - Entity definition ID (e.g., 'contact', 'ticket', or custom entity ID)
   */
  async getAllFields(entityDefinitionId: string) {
    const result = await getCustomFields({
      organizationId: this.organizationId,
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
   */
  async createField(input: {
    name: string
    type: FieldType
    description?: string
    required?: boolean
    defaultValue?: string
    options?:
      | SelectOption[]
      | { file: FileOptions }
      | { currency: CurrencyOptions }
      | DisplayOptions
    addressComponents?: string[]
    icon?: string
    isCustom?: boolean
    entityDefinitionId: string
    relationship?: RelationshipOptions
    isUnique?: boolean
  }) {
    const result = await createCustomField({
      ...input,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      // Preserve code and cause for frontend error handling
      throw new Error(result.error.message, { cause: { code: result.error.code } })
    }

    return result.value
  }

  /**
   * Update a custom field
   *
   * @param input - Field data to update
   */
  async updateField(input: {
    resourceFieldId: ResourceFieldId
    name?: string
    description?: string
    required?: boolean
    defaultValue?: string
    options?:
      | SelectOption[]
      | { file: FileOptions }
      | { currency: CurrencyOptions }
      | DisplayOptions
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
   * @param resourceFieldId - ResourceFieldId of the field to delete
   */
  async deleteField(resourceFieldId: ResourceFieldId) {
    const result = await deleteCustomField({
      resourceFieldId,
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
   * @param resourceFieldId - ResourceFieldId of the relationship field
   * @returns Object with primary and inverse fields
   */
  async getRelationshipPair(resourceFieldId: ResourceFieldId) {
    const result = await getRelationshipPair({
      resourceFieldId,
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
export { normalizeFieldValue } from '@auxx/services/custom-fields'
