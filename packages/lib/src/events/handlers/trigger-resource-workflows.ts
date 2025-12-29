// packages/lib/src/events/handlers/trigger-resource-workflows.ts

import type { AuxxEvent } from '../types'
import { createScopedLogger } from '@auxx/logger'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import { WorkflowNodeType } from '../../workflow-engine/core/types'
import {
  fetchResourceById,
  getResourceTypeFromEvent,
  getResourceIdField,
} from '../../resources/resource-fetcher'
import { getWorkflowAppsByTrigger } from '@auxx/services/workflows'

const logger = createScopedLogger('trigger-resource-workflows')

/**
 * Event to workflow trigger type mapping
 * Only includes existing trigger types in WorkflowNodeType enum
 */
const EVENT_TO_TRIGGER_MAP: Record<string, string> = {
  'contact:created': WorkflowNodeType.CONTACT_CREATED,
  'contact:updated': WorkflowNodeType.CONTACT_UPDATED,
  'contact:deleted': WorkflowNodeType.CONTACT_DELETED,
  'ticket:created': WorkflowNodeType.TICKET_CREATED,
  'ticket:updated': WorkflowNodeType.TICKET_UPDATED,
  'ticket:deleted': WorkflowNodeType.TICKET_DELETED,
}

/**
 * Event handler that triggers workflows when resource events occur
 * Fetches matching workflows and queues execution jobs
 */
export const triggerResourceWorkflows = async ({ data: event }: { data: AuxxEvent }) => {
  // 1. Map event type to workflow trigger type
  const workflowTriggerType = EVENT_TO_TRIGGER_MAP[event.type]
  if (!workflowTriggerType) {
    logger.debug('No workflow trigger type for event', { eventType: event.type })
    return
  }

  // 2. Query workflows using service method
  const workflowAppsResult = await getWorkflowAppsByTrigger({
    organizationId: event.data.organizationId,
    triggerType: workflowTriggerType,
  })

  if (workflowAppsResult.isErr()) {
    logger.error('Failed to query workflow apps', {
      error: workflowAppsResult.error.message,
      triggerType: workflowTriggerType,
      eventType: event.type,
    })
    throw new Error(`Database error: ${workflowAppsResult.error.message}`)
  }

  const matchingWorkflows = workflowAppsResult.value

  if (matchingWorkflows.length === 0) {
    logger.debug('No enabled workflows found', { triggerType: workflowTriggerType })
    return
  }

  // 3. Fetch complete resource data using shared utility
  const resourceType = getResourceTypeFromEvent(event.type)
  const resourceIdField = getResourceIdField(event.type)

  if (!resourceType || !resourceIdField) {
    logger.error('Invalid event type mapping', { eventType: event.type })
    return
  }

  const resourceId = (event.data as any)[resourceIdField] as string

  // Uses resource-fetcher utility (automatically enriches with virtual fields)
  const resourceData = await fetchResourceById(resourceType, resourceId, event.data.organizationId)

  if (!resourceData) {
    logger.warn('Resource not found, skipping workflows', {
      resourceType,
      resourceId,
      eventType: event.type,
    })
    return
  }

  // 4. Enqueue jobs to workflow delay queue
  const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)

  for (const workflow of matchingWorkflows) {
    await workflowDelayQueue.add('executeResourceTrigger', {
      workflowAppId: workflow.workflowApp.id,
      workflowId: workflow.publishedWorkflow.id,
      organizationId: event.data.organizationId,
      resourceType,
      resourceData, // Already enriched with virtual fields (contact.name)
      triggerType: workflowTriggerType,
      triggeredAt: new Date().toISOString(),
    })
  }

  logger.info('Queued workflows for resource trigger', {
    eventType: event.type,
    workflowCount: matchingWorkflows.length,
    resourceType,
    resourceId,
  })
}
