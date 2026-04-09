// packages/lib/src/field-triggers/entity-trigger-handler.ts

import { createScopedLogger } from '@auxx/logger'
import type { EntityInstanceCreatedEvent, EntityInstanceDeletedEvent } from '../events/types'
import { getEntityTriggers } from './registry'

const logger = createScopedLogger('field-triggers:entity')

/**
 * Event handler for entity:created and entity:deleted events.
 * Looks up registered entity triggers by entitySlug and calls each handler.
 */
export async function handleEntityTriggers({
  data,
}: {
  data: EntityInstanceCreatedEvent | EntityInstanceDeletedEvent
}): Promise<void> {
  const { entitySlug } = data.data
  const triggers = getEntityTriggers(entitySlug)
  if (triggers.length === 0) return

  const action = data.type === 'entity:created' ? 'created' : 'deleted'

  logger.info(`Processing entity trigger: ${entitySlug} ${action}`, {
    handlerCount: triggers.length,
  })

  for (const handler of triggers) {
    try {
      await handler({
        action,
        entitySlug: data.data.entitySlug,
        entityType: '', // Not in event data; handlers can derive from slug if needed
        entityDefinitionId: data.data.entityDefinitionId,
        entityInstanceId: data.data.recordId.split(':')[1] ?? '',
        organizationId: data.data.organizationId,
        userId: data.data.userId,
        values: data.data.eventData,
      })
    } catch (error) {
      logger.error(`Entity trigger handler failed for ${entitySlug}`, {
        action,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
