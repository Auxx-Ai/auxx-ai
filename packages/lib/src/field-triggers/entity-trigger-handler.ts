// packages/lib/src/field-triggers/entity-trigger-handler.ts

import { createScopedLogger } from '@auxx/logger'
import type {
  CompanyCreatedEvent,
  CompanyDeletedEvent,
  EntityInstanceCreatedEvent,
  EntityInstanceDeletedEvent,
  StockMovementCreatedEvent,
  StockMovementDeletedEvent,
  SubpartCreatedEvent,
  SubpartDeletedEvent,
  VendorPartCreatedEvent,
  VendorPartDeletedEvent,
} from '../events/types'
import { getEntityTriggers } from './registry'

const logger = createScopedLogger('field-triggers:entity')

/** All entity event types that can carry entity triggers */
type EntityTriggerEvent =
  | EntityInstanceCreatedEvent
  | EntityInstanceDeletedEvent
  | StockMovementCreatedEvent
  | StockMovementDeletedEvent
  | VendorPartCreatedEvent
  | VendorPartDeletedEvent
  | SubpartCreatedEvent
  | SubpartDeletedEvent
  | CompanyCreatedEvent
  | CompanyDeletedEvent

/**
 * Event handler for entity lifecycle events (created/deleted).
 * Looks up registered entity triggers by entitySlug and calls each handler.
 */
export async function handleEntityTriggers({ data }: { data: EntityTriggerEvent }): Promise<void> {
  const { entitySlug } = data.data
  const triggers = getEntityTriggers(entitySlug)
  if (triggers.length === 0) return

  const action = data.type.endsWith(':created') ? 'created' : 'deleted'

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
