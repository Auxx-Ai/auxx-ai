// packages/lib/src/custom-fields/custom-field-service.ts

import { type Database, database } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import type { RelationshipOptions } from '@auxx/types/custom-field'
import type { ResourceFieldId } from '@auxx/types/field'
import { onCacheEvent } from '../cache/invalidate'
import { createCustomField } from './create-field'
import { deleteCustomField } from './delete-field'
import { getRelationshipPair } from './get-relationship-pair'
import type { CustomFieldOptionsInput } from './types'
import { updateCustomField } from './update-field'

/**
 * Only the database-backed service errors carry a `cause`; the not-found,
 * access-denied and validation shapes are just a code and a message. Reading it
 * off the union directly does not typecheck, and at runtime it was always
 * `undefined` for those.
 */
function errorCause(error: { message: string; cause?: unknown }): unknown {
  return error.cause
}

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
   * Get all custom fields for the organization by entity definition ID.
   * Now served from org cache (15m TTL).
   *
   * @param entityDefinitionId - Entity definition ID (e.g., 'contact', 'ticket', or custom entity ID)
   */
  async getAllFields(entityDefinitionId: string) {
    const { getCachedCustomFields } = await import('../cache')
    return getCachedCustomFields(this.organizationId, entityDefinitionId)
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
    options?: CustomFieldOptionsInput
    addressComponents?: string[]
    /** ADDRESS_STRUCT input variant — see addressFieldOptionsSchema. */
    inputMode?: 'single' | 'structured'
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

    await onCacheEvent('custom-field.created', { orgId: this.organizationId })
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
    options?: CustomFieldOptionsInput
    addressComponents?: string[]
    /** ADDRESS_STRUCT input variant — see addressFieldOptionsSchema. */
    inputMode?: 'single' | 'structured'
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
      throw new Error(result.error.message, { cause: errorCause(result.error) })
    }

    await onCacheEvent('custom-field.updated', { orgId: this.organizationId })
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
      throw new Error(result.error.message, { cause: errorCause(result.error) })
    }

    await onCacheEvent('custom-field.deleted', { orgId: this.organizationId })
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
      throw new Error(result.error.message, { cause: errorCause(result.error) })
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
