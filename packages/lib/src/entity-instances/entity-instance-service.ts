// packages/lib/src/entity-instances/entity-instance-service.ts

import type { Result } from 'neverthrow'
import {
  createEntityInstance,
  getEntityInstance,
  listEntityInstances,
  updateEntityInstance,
  deleteEntityInstance,
} from '@auxx/services/entity-instances'
import { getEntityDefinition } from '@auxx/services/entity-definitions'
import { ModelTypes } from '../custom-fields'
import { FieldValueService } from '../field-values'
import { database } from '@auxx/database'
import { getCustomFields, checkUniqueValue } from '@auxx/services/custom-fields'
import { publisher } from '../events/publisher'
import { CommentService } from '../comments'
import { invalidateSnapshots } from '../snapshot'

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
 * Service for managing entity instances (records of custom entities)
 * Note: Field values are managed separately via the CustomFieldValue service
 */
export class EntityInstanceService {
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
   * Helper to get entity slug for event publishing
   */
  private async getEntitySlug(entityDefinitionId: string): Promise<string> {
    const result = await getEntityDefinition({
      id: entityDefinitionId,
      organizationId: this.organizationId,
    })
    if (result.isErr()) {
      throw new Error(`Entity definition not found: ${entityDefinitionId}`)
    }
    return result.value.apiSlug
  }

  /**
   * Invalidate query snapshots for an entity type
   * Called after mutations to ensure filtered views are refreshed
   */
  private async invalidateEntitySnapshots(entityDefinitionId: string): Promise<void> {
    try {
      await invalidateSnapshots({
        organizationId: this.organizationId,
        resourceType: entityDefinitionId, // UUID only, no prefix
      })
    } catch {
      // Snapshot invalidation is non-critical, don't fail the mutation
    }
  }

  /**
   * Create a new entity instance
   * Field values should be set separately using CustomFieldValue service
   */
  async create(entityDefinitionId: string) {
    const result = await createEntityInstance({
      entityDefinitionId,
      organizationId: this.organizationId,
      createdById: this.userId,
    })
    const instance = unwrapResult(result)

    // Invalidate snapshots for this entity type
    await this.invalidateEntitySnapshots(entityDefinitionId)

    return instance
  }

  /**
   * Get entity instance by ID
   */
  async getById(id: string) {
    const result = await getEntityInstance({
      id,
      organizationId: this.organizationId,
    })
    if (result.isErr()) {
      if (result.error.code === 'ENTITY_INSTANCE_NOT_FOUND') {
        return undefined
      }
      throw new Error(result.error.message)
    }
    return result.value
  }

  /**
   * List instances for an entity definition with cursor-based pagination
   */
  async list(params: {
    entityDefinitionId: string
    includeArchived?: boolean
    limit?: number
    cursor?: string
  }) {
    const result = await listEntityInstances({
      organizationId: this.organizationId,
      entityDefinitionId: params.entityDefinitionId,
      includeArchived: params.includeArchived,
      limit: params.limit,
      cursor: params.cursor,
    })
    return unwrapResult(result)
  }

  /**
   * Archive an entity instance (soft delete)
   * Publishes entity:deleted event with hardDelete: false
   */
  async archive(id: string) {
    const instance = await this.getById(id)
    if (!instance) {
      throw new Error(`Entity instance not found: ${id}`)
    }

    const entitySlug = await this.getEntitySlug(instance.entityDefinitionId)

    const result = await updateEntityInstance({
      id,
      organizationId: this.organizationId,
      data: { archivedAt: new Date().toISOString() },
    })
    const archived = unwrapResult(result)

    // Invalidate snapshots for this entity type
    await this.invalidateEntitySnapshots(instance.entityDefinitionId)

    // Publish delete event (soft delete)
    publisher.publishLater({
      type: 'entity:deleted',
      data: {
        instanceId: id,
        entityDefinitionId: instance.entityDefinitionId,
        entitySlug,
        organizationId: this.organizationId,
        userId: this.userId,
        hardDelete: false,
      },
    })

    return archived
  }

  /**
   * Restore an archived entity instance
   * Publishes entity:updated event with restored: true
   */
  async restore(id: string) {
    const instance = await this.getById(id)
    if (!instance) {
      throw new Error(`Entity instance not found: ${id}`)
    }

    const entitySlug = await this.getEntitySlug(instance.entityDefinitionId)

    const result = await updateEntityInstance({
      id,
      organizationId: this.organizationId,
      data: { archivedAt: null },
    })
    const restored = unwrapResult(result)

    // Invalidate snapshots for this entity type
    await this.invalidateEntitySnapshots(instance.entityDefinitionId)

    // Publish update event with restored flag
    publisher.publishLater({
      type: 'entity:updated',
      data: {
        instanceId: id,
        entityDefinitionId: instance.entityDefinitionId,
        entitySlug,
        organizationId: this.organizationId,
        userId: this.userId,
        values: {},
        restored: true,
      },
    })

    return restored
  }

  /**
   * Permanently delete an entity instance
   * Publishes entity:deleted event with hardDelete: true
   */
  async delete(id: string) {
    const instance = await this.getById(id)
    if (!instance) {
      throw new Error(`Entity instance not found: ${id}`)
    }

    const entitySlug = await this.getEntitySlug(instance.entityDefinitionId)

    // Soft delete associated comments (entityType is the entityDefinitionId for custom entities)
    const commentService = new CommentService(this.organizationId, this.userId, database)
    await commentService.deleteCommentsByEntity(id, instance.entityDefinitionId)

    const result = await deleteEntityInstance({
      id,
      organizationId: this.organizationId,
    })
    const deleted = unwrapResult(result)

    // Invalidate snapshots for this entity type
    await this.invalidateEntitySnapshots(instance.entityDefinitionId)

    // Publish delete event (hard delete)
    publisher.publishLater({
      type: 'entity:deleted',
      data: {
        instanceId: id,
        entityDefinitionId: instance.entityDefinitionId,
        entitySlug,
        organizationId: this.organizationId,
        userId: this.userId,
        hardDelete: true,
      },
    })

    return deleted
  }

  /**
   * Bulk delete entity instances
   * Fires individual entity:deleted events per instance
   * @param ids - Array of entity instance IDs to delete
   * @returns Count of deleted instances
   */
  async bulkDelete(ids: string[]): Promise<{ count: number }> {
    let count = 0
    for (const id of ids) {
      try {
        await this.delete(id)
        count++
      } catch {
        // Skip instances that fail to delete (not found, etc.)
      }
    }
    return { count }
  }

  /**
   * Bulk archive entity instances (soft delete)
   * Fires individual entity:deleted events per instance
   * @param ids - Array of entity instance IDs to archive
   * @returns Count of archived instances
   */
  async bulkArchive(ids: string[]): Promise<{ count: number }> {
    let count = 0
    for (const id of ids) {
      try {
        await this.archive(id)
        count++
      } catch {
        // Skip instances that fail to archive (not found, etc.)
      }
    }
    return { count }
  }

  /**
   * Create a new entity instance with field values in one call
   * Publishes entity:created event after all operations complete
   * @param entityDefinitionId - The entity definition ID
   * @param values - Field values to set (fieldId -> value)
   * @returns Created instance with id
   */
  async createWithValues(
    entityDefinitionId: string,
    values: Record<string, any>
  ): Promise<{ id: string; entityInstance: any }> {
    // Get entity slug FIRST for event publishing
    const entitySlug = await this.getEntitySlug(entityDefinitionId)

    // Get all fields for this entity to check uniqueness BEFORE creating instance
    const fieldsResult = await getCustomFields({
      organizationId: this.organizationId,
      modelType: ModelTypes.ENTITY,
      entityDefinitionId,
    })

    if (fieldsResult.isOk()) {
      const uniqueFields = fieldsResult.value.filter((f) => f.isUnique)

      // Check uniqueness for all unique fields before creating
      for (const field of uniqueFields) {
        const value = values[field.id]
        if (value !== undefined && value !== null && value !== '') {
          const uniqueCheck = await checkUniqueValue({
            fieldId: field.id,
            value,
            organizationId: this.organizationId,
            modelType: ModelTypes.ENTITY,
            entityDefinitionId,
            // No excludeEntityId - we're creating new
          })

          if (uniqueCheck.isErr()) {
            throw new Error(`${field.name} must be unique: value already exists`)
          }
        }
      }
    }

    // Create the instance first
    const instance = await this.create(entityDefinitionId)

    // Set field values if provided
    if (Object.keys(values).length > 0) {
      const fieldValueService = new FieldValueService(this.organizationId, this.userId, database)

      // Convert values object to array format expected by setValuesForEntity
      const valueArray = Object.entries(values)
        .filter(([_, value]) => value !== undefined && value !== null && value !== '')
        .map(([fieldId, value]) => ({ fieldId, value }))

      if (valueArray.length > 0) {
        await fieldValueService.setValuesForEntity({
          entityId: instance.id,
          values: valueArray,
          modelType: 'entity',
        })
      }
    }

    // Invalidate snapshots for this entity type
    await this.invalidateEntitySnapshots(entityDefinitionId)

    // Publish event AFTER all operations complete
    publisher.publishLater({
      type: 'entity:created',
      data: {
        instanceId: instance.id,
        entityDefinitionId,
        entitySlug,
        organizationId: this.organizationId,
        userId: this.userId,
        values,
      },
    })

    return { id: instance.id, entityInstance: instance }
  }

  /**
   * Update entity instance field values
   * Publishes entity:updated event after all operations complete
   * @param instanceId - The entity instance ID
   * @param values - Field values to update (fieldId -> value)
   * @returns Updated instance with id
   */
  async updateValues(
    instanceId: string,
    values: Record<string, any>
  ): Promise<{ id: string; entityInstance: any }> {
    // Verify instance exists
    const instance = await this.getById(instanceId)
    if (!instance) {
      throw new Error(`Entity instance not found: ${instanceId}`)
    }

    // Get entity slug for event
    const entitySlug = await this.getEntitySlug(instance.entityDefinitionId)

    // Set field values if provided
    if (Object.keys(values).length > 0) {
      const fieldValueService = new FieldValueService(this.organizationId, this.userId, database)

      // Convert values object to array format expected by setValuesForEntity
      const valueArray = Object.entries(values)
        .filter(([_, value]) => value !== undefined && value !== null && value !== '')
        .map(([fieldId, value]) => ({ fieldId, value }))

      if (valueArray.length > 0) {
        await fieldValueService.setValuesForEntity({
          entityId: instanceId,
          values: valueArray,
          modelType: 'entity',
        })
      }
    }

    // Invalidate snapshots for this entity type
    await this.invalidateEntitySnapshots(instance.entityDefinitionId)

    // Publish event AFTER update completes
    publisher.publishLater({
      type: 'entity:updated',
      data: {
        instanceId,
        entityDefinitionId: instance.entityDefinitionId,
        entitySlug,
        organizationId: this.organizationId,
        userId: this.userId,
        values,
      },
    })

    // Return updated instance
    const updated = await this.getById(instanceId)
    return { id: instanceId, entityInstance: updated }
  }
}
