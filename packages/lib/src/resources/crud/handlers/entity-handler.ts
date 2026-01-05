// packages/lib/src/resources/crud/handlers/entity-handler.ts

import {
  createEntityInstance,
  updateEntityInstance,
  deleteEntityInstance,
} from '@auxx/services/entity-instances'
import { publisher } from '../../../events'
import type {
  EntityInstanceCreatedEvent,
  EntityInstanceUpdatedEvent,
  EntityInstanceDeletedEvent,
} from '../../../events/types'
import type { ResourceHandler } from './types'
import type { CrudResult, CrudContext, TransformedData } from '../types'
import { setCustomFields } from '../utils/custom-fields'

/**
 * Entity (custom entity) CRUD handler.
 * Uses @auxx/services/entity-instances for DB operations.
 * Publishes events after successful operations.
 */
export const entityHandler: ResourceHandler = {
  supports: (resourceType) => resourceType.startsWith('entity_'),

  async create(data: TransformedData, ctx: CrudContext): Promise<CrudResult> {
    const { standardFields, customFields } = data
    const { organizationId, userId } = ctx

    // Extract entity definition ID from the standardFields
    const entityDefinitionId = standardFields._entityDefinitionId as string

    if (!entityDefinitionId) {
      return { success: false, error: 'Entity definition ID required', errorCode: 'MISSING_FIELD' }
    }

    // Extract slug for event data
    const entitySlug = (standardFields._entitySlug as string) || ''

    const result = await createEntityInstance({
      organizationId,
      entityDefinitionId,
      createdById: userId,
    })

    if (result.isErr()) {
      return { success: false, error: result.error.message }
    }

    const record = result.value

    // Set custom fields in batch
    if (Object.keys(customFields).length > 0) {
      await setCustomFields(record.id, customFields, entityDefinitionId, ctx)
    }

    // Publish event
    if (!ctx.skipEvents) {
      await publisher.publishLater({
        type: 'entity:created',
        data: {
          instanceId: record.id,
          entityDefinitionId,
          entitySlug,
          organizationId,
          userId,
          values: customFields,
        },
      } as EntityInstanceCreatedEvent)
    }

    return { success: true, id: record.id, record }
  },

  async update(id: string, data: TransformedData, ctx: CrudContext): Promise<CrudResult> {
    const { standardFields, customFields } = data
    const { organizationId, userId } = ctx

    // Get entity definition ID for custom fields context
    const entityDefinitionId = (standardFields._entityDefinitionId as string) || ''
    const entitySlug = (standardFields._entitySlug as string) || ''

    // Update the entity instance timestamp
    const result = await updateEntityInstance({
      id,
      organizationId,
      data: {},
    })

    if (result.isErr()) {
      const code = result.error.code
      if (code === 'ENTITY_INSTANCE_NOT_FOUND') {
        return { success: false, error: `Entity ${id} not found`, errorCode: 'NOT_FOUND' }
      }
      return { success: false, error: result.error.message }
    }

    // Set custom fields in batch
    if (Object.keys(customFields).length > 0) {
      await setCustomFields(id, customFields, entityDefinitionId, ctx)
    }

    // Publish event
    if (!ctx.skipEvents) {
      await publisher.publishLater({
        type: 'entity:updated',
        data: {
          instanceId: id,
          entityDefinitionId,
          entitySlug,
          organizationId,
          userId,
          values: customFields,
        },
      } as EntityInstanceUpdatedEvent)
    }

    return { success: true, id, record: result.value }
  },

  async delete(id: string, ctx: CrudContext): Promise<CrudResult> {
    const { organizationId, userId, skipEvents } = ctx

    // For soft delete (archive), use updateEntityInstance
    // For hard delete, use deleteEntityInstance
    // Default to hard delete for now

    const result = await deleteEntityInstance({
      id,
      organizationId,
    })

    if (result.isErr()) {
      return { success: false, error: result.error.message }
    }

    // Publish event
    if (!skipEvents) {
      await publisher.publishLater({
        type: 'entity:deleted',
        data: {
          instanceId: id,
          entityDefinitionId: '',
          entitySlug: '',
          organizationId,
          userId,
          hardDelete: true,
        },
      } as EntityInstanceDeletedEvent)
    }

    return { success: true, id }
  },
}
