// packages/lib/src/events/handlers/trigger-resource-workflows.ts

import { createScopedLogger } from '@auxx/logger'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { getCachedWorkflowAppsByTrigger } from '../../cache'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import { fetchResourceById, getRecordIdField } from '../../resources/resource-fetcher'
import type { AuxxEvent } from '../types'

const logger = createScopedLogger('trigger-resource-workflows')

export type ResourceTriggerType = 'created' | 'updated' | 'deleted'

export type ResourceTriggerMatch = {
  triggerType: ResourceTriggerType
  entityDefinitionId: string
}

/**
 * Resolve which resource CRUD trigger this event maps to. Shared with the
 * agent-trigger dispatcher (see `./trigger-agents.ts`).
 *
 * Modern-shape events (emitted from unified-handler-mutations) carry
 * `entityDefinitionId` directly in the payload — including custom-entity
 * cuids. Legacy-shape events (ticket/contact emitters) don't carry it,
 * so the entity is derived from the event-type prefix.
 *
 * Returns null when the event is not a resource CRUD trigger.
 */
export function getResourceTriggerMatch(event: AuxxEvent): ResourceTriggerMatch | null {
  const payload = event.data as Record<string, unknown>
  const payloadEntityDefinitionId =
    typeof payload.entityDefinitionId === 'string' ? payload.entityDefinitionId : undefined

  switch (event.type) {
    // Modern shape — entityDefinitionId on payload
    case 'entity:created':
    case 'company:created':
    case 'stock_movement:created':
    case 'vendor_part:created':
    case 'subpart:created':
      return payloadEntityDefinitionId
        ? { triggerType: 'created', entityDefinitionId: payloadEntityDefinitionId }
        : null
    case 'entity:updated':
      return payloadEntityDefinitionId
        ? { triggerType: 'updated', entityDefinitionId: payloadEntityDefinitionId }
        : null
    case 'entity:deleted':
    case 'company:deleted':
    case 'stock_movement:deleted':
    case 'vendor_part:deleted':
    case 'subpart:deleted':
      return payloadEntityDefinitionId
        ? { triggerType: 'deleted', entityDefinitionId: payloadEntityDefinitionId }
        : null

    // Legacy shape — entity comes from event-type prefix
    case 'ticket:created':
      return { triggerType: 'created', entityDefinitionId: 'ticket' }
    case 'ticket:updated':
      return { triggerType: 'updated', entityDefinitionId: 'ticket' }
    case 'ticket:deleted':
      return { triggerType: 'deleted', entityDefinitionId: 'ticket' }
    case 'contact:created':
      return { triggerType: 'created', entityDefinitionId: 'contact' }
    case 'contact:updated':
      return { triggerType: 'updated', entityDefinitionId: 'contact' }
    case 'contact:deleted':
      return { triggerType: 'deleted', entityDefinitionId: 'contact' }

    default:
      return null
  }
}

/**
 * Resolve the RecordId for the event's subject resource.
 *
 * Modern-shape events already carry `recordId`. Legacy events don't —
 * construct it from the per-event id field (`ticketId`, `contactId`) and
 * the matched entityDefinitionId.
 */
export function getEventRecordId(event: AuxxEvent, match: ResourceTriggerMatch): RecordId | null {
  const payload = event.data as Record<string, unknown>

  if (typeof payload.recordId === 'string' && payload.recordId.includes(':')) {
    return payload.recordId as RecordId
  }

  const idField = getRecordIdField(event.type)
  if (!idField) return null
  const instanceId = payload[idField]
  if (typeof instanceId !== 'string' || !instanceId) return null
  return toRecordId(match.entityDefinitionId, instanceId)
}

/** Fetches the full resolved record for an event's subject resource. */
export type ResourceFetcher = (recordId: RecordId, organizationId: string) => Promise<any | null>

/**
 * Event handler that triggers workflows when resource events occur.
 * Fetches matching workflows and queues execution jobs.
 */
export const triggerResourceWorkflows = async ({ data: event }: { data: AuxxEvent }) =>
  dispatchResourceWorkflows(event, fetchResourceById)

/**
 * Core workflow dispatch with an injectable record fetcher so the combined
 * CRUD dispatcher (`trigger-resource-dispatch.ts`) can share one
 * `fetchResourceById` result with the agent dispatcher.
 */
export const dispatchResourceWorkflows = async (
  event: AuxxEvent,
  fetchResource: ResourceFetcher
) => {
  // 1. Map event to workflow trigger criteria
  const match = getResourceTriggerMatch(event)
  if (!match) {
    logger.debug('No workflow trigger mapping for event', { eventType: event.type })
    return
  }
  const { triggerType, entityDefinitionId } = match

  // 2. Query workflows via org cache
  const matchingApps = await getCachedWorkflowAppsByTrigger({
    organizationId: event.data.organizationId,
    triggerType,
    entityDefinitionId,
  })

  const matchingWorkflows = matchingApps
    .filter((app) => app.publishedWorkflow)
    .map((app) => ({
      workflowApp: app,
      publishedWorkflow: app.publishedWorkflow!,
    }))

  if (matchingWorkflows.length === 0) {
    logger.debug('No enabled workflows found', { triggerType, entityDefinitionId })
    return
  }

  // 3. Fetch complete resource data
  const recordId = getEventRecordId(event, match)
  if (!recordId) {
    logger.error('Could not resolve recordId for event', {
      eventType: event.type,
      entityDefinitionId,
    })
    return
  }

  const resourceData = await fetchResource(recordId, event.data.organizationId)
  if (!resourceData) {
    logger.warn('Resource not found, skipping workflows', {
      recordId,
      eventType: event.type,
    })
    return
  }

  // 4. Enqueue jobs
  const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)

  for (const workflow of matchingWorkflows) {
    await workflowDelayQueue.add('executeResourceTrigger', {
      workflowAppId: workflow.workflowApp.id,
      workflowId: workflow.publishedWorkflow.id,
      organizationId: event.data.organizationId,
      entityDefinitionId,
      resourceData,
      triggerType,
      triggeredAt: new Date().toISOString(),
    })
  }

  logger.info('Queued workflows for resource trigger', {
    eventType: event.type,
    workflowCount: matchingWorkflows.length,
    triggerType,
    entityDefinitionId,
    recordId,
  })
}
