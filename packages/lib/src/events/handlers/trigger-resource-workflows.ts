// packages/lib/src/events/handlers/trigger-resource-workflows.ts

import { createScopedLogger } from '@auxx/logger'
import { getWorkflowAppsByTrigger } from '@auxx/services/workflows'
import { toRecordId } from '@auxx/types/resource'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import {
  fetchResourceById,
  getRecordIdField,
  getResourceTypeFromEvent,
} from '../../resources/resource-fetcher'
import { WorkflowNodeType } from '../../workflow-engine/core/types'
import type { AuxxEvent } from '../types'

const logger = createScopedLogger('trigger-resource-workflows')

/**
 * Event to workflow trigger type and entity mapping
 */
const EVENT_TO_WORKFLOW_MAP: Record<string, { triggerType: string; entityDefinitionId: string }> = {
  'contact:created': { triggerType: 'created', entityDefinitionId: 'contact' },
  'contact:updated': { triggerType: 'updated', entityDefinitionId: 'contact' },
  'contact:deleted': { triggerType: 'deleted', entityDefinitionId: 'contact' },
  'ticket:created': { triggerType: 'created', entityDefinitionId: 'ticket' },
  'ticket:updated': { triggerType: 'updated', entityDefinitionId: 'ticket' },
  'ticket:deleted': { triggerType: 'deleted', entityDefinitionId: 'ticket' },
  'thread:created': { triggerType: 'created', entityDefinitionId: 'thread' },
  'thread:updated': { triggerType: 'updated', entityDefinitionId: 'thread' },
  'thread:deleted': { triggerType: 'deleted', entityDefinitionId: 'thread' },
  // Add more as needed
}

/**
 * Event handler that triggers workflows when resource events occur
 * Fetches matching workflows and queues execution jobs
 */
export const triggerResourceWorkflows = async ({ data: event }: { data: AuxxEvent }) => {
  // 1. Map event type to workflow trigger criteria
  const mapping = EVENT_TO_WORKFLOW_MAP[event.type]
  if (!mapping) {
    logger.debug('No workflow trigger mapping for event', { eventType: event.type })
    return
  }

  const { triggerType, entityDefinitionId } = mapping

  // 2. Query workflows using NEW service signature
  const workflowAppsResult = await getWorkflowAppsByTrigger({
    organizationId: event.data.organizationId,
    triggerType,
    entityDefinitionId,
  })

  if (workflowAppsResult.isErr()) {
    logger.error('Failed to query workflow apps', {
      error: workflowAppsResult.error.message,
      triggerType,
      entityDefinitionId,
      eventType: event.type,
    })
    throw new Error(`Database error: ${workflowAppsResult.error.message}`)
  }

  const matchingWorkflows = workflowAppsResult.value

  if (matchingWorkflows.length === 0) {
    logger.debug('No enabled workflows found', { triggerType, entityDefinitionId })
    return
  }

  // 3. Fetch complete resource data
  const resourceType = getResourceTypeFromEvent(event.type)
  const recordIdField = getRecordIdField(event.type)

  if (!resourceType || !recordIdField) {
    logger.error('Invalid event type mapping', { eventType: event.type })
    return
  }

  const resourceInstanceId = (event.data as any)[recordIdField] as string
  const fullRecordId = toRecordId(resourceType, resourceInstanceId)
  const resourceData = await fetchResourceById(fullRecordId, event.data.organizationId)

  if (!resourceData) {
    logger.warn('Resource not found, skipping workflows', {
      resourceType,
      resourceId: resourceInstanceId,
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
      entityDefinitionId, // NEW: pass entityDefinitionId instead of resourceType
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
    resourceId: resourceInstanceId,
  })
}
