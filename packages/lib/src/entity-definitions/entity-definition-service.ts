// packages/lib/src/entity-definitions/entity-definition-service.ts

import type { Result } from 'neverthrow'
import {
  getEntityDefinition,
  listEntityDefinitions,
  getEntityDefinitionBySlug,
  createEntityDefinition,
  updateEntityDefinition,
  deleteEntityDefinition,
} from '@auxx/services/entity-definitions'
import type { CreateEntityDefinitionInput, UpdateEntityDefinitionInput } from './types'

/**
 * Helper to unwrap neverthrow Result and throw on error
 */
function unwrapResult<T, E extends { message: string }>(result: Result<T, E>): T {
  if (result.isErr()) {
    throw new Error(result.error.message)
  }
  return result.value
}

/**
 * Service for managing entity definitions
 * Uses the service functions from @auxx/services for database operations
 */
export class EntityDefinitionService {
  organizationId: string
  userId: string

  /**
   * @param organizationId - Current org id
   * @param userId - Current user id
   */
  constructor(organizationId: string, userId: string) {
    this.organizationId = organizationId
    this.userId = userId
  }

  /**
   * Get all entity definitions for the organization
   */
  async getAll(options?: { includeArchived?: boolean }) {
    const result = await listEntityDefinitions({
      organizationId: this.organizationId,
      includeArchived: options?.includeArchived,
    })
    return unwrapResult(result)
  }

  /**
   * Get a single entity definition by ID
   */
  async getById(id: string) {
    const result = await getEntityDefinition({
      id,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      if (result.error.code === 'ENTITY_DEFINITION_NOT_FOUND') {
        return undefined
      }
      throw new Error(result.error.message)
    }

    return result.value
  }

  /**
   * Get entity definition by apiSlug
   */
  async getBySlug(slug: string) {
    const result = await getEntityDefinitionBySlug({
      slug,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      if (result.error.code === 'ENTITY_DEFINITION_NOT_FOUND') {
        return undefined
      }
      throw new Error(result.error.message)
    }

    return result.value
  }

  /**
   * Create a new entity definition
   */
  async create(input: CreateEntityDefinitionInput) {
    const result = await createEntityDefinition({
      ...input,
      organizationId: this.organizationId,
      entityType: input.entityType ?? null,
      standardType: input.standardType ?? null,
    })
    return unwrapResult(result)
  }

  /**
   * Update an entity definition
   * Only allows updating: icon, singular, plural, archivedAt
   */
  async update(id: string, input: UpdateEntityDefinitionInput) {
    const result = await updateEntityDefinition({
      id,
      organizationId: this.organizationId,
      data: input,
    })
    return unwrapResult(result)
  }

  /**
   * Archive an entity definition (soft delete)
   * Convenience method that calls update with archivedAt set
   */
  async archive(id: string) {
    return this.update(id, { archivedAt: new Date().toISOString() })
  }

  /**
   * Restore an archived entity definition
   * Convenience method that calls update with archivedAt: null
   */
  async restore(id: string) {
    return this.update(id, { archivedAt: null })
  }

  /**
   * Permanently delete an entity definition
   * Should only be used with caution - prefer archive()
   */
  async delete(id: string) {
    const result = await deleteEntityDefinition({
      id,
      organizationId: this.organizationId,
    })
    return unwrapResult(result)
  }
}
