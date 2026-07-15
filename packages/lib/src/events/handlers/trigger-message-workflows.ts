// packages/lib/src/events/handlers/trigger-message-workflows.ts

import { createScopedLogger } from '@auxx/logger'
import { getCachedWorkflowAppsByTrigger } from '../../cache'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import { WorkflowTriggerType } from '../../workflow-engine/core/types'
import { loadProcessedMessage } from '../../workflow-engine/nodes/trigger-nodes/message-loader'
import type { AuxxEvent, MessageReceivedEvent } from '../types'

const logger = createScopedLogger('trigger-message-workflows')

/**
 * Event handler that dispatches the MESSAGE_RECEIVED workflow trigger.
 * Mirrors `dispatchResourceWorkflows` (`trigger-resource-workflows.ts`): look
 * up matching published workflows via the org cache, hydrate the trigger
 * payload once (shared across every matching workflow), and enqueue one
 * `executeMessageTrigger` job per workflow.
 *
 * v1: dispatched org-wide — there's no inbox/channel pre-filter here. The
 * trigger node's own config filters (fromDomain/subjectContains/isInbound/...)
 * are applied inside `MessageReceivedProcessor.executeNode` at run time.
 */
export const triggerMessageWorkflows = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'message:received') return
  const { messageId, organizationId, threadId } = (event as MessageReceivedEvent).data

  const matchingApps = await getCachedWorkflowAppsByTrigger({
    organizationId,
    triggerType: WorkflowTriggerType.MESSAGE_RECEIVED,
  })

  const matchingWorkflows = matchingApps
    .filter((app) => app.publishedWorkflow)
    .map((app) => ({ workflowApp: app, publishedWorkflow: app.publishedWorkflow! }))

  if (matchingWorkflows.length === 0) {
    logger.debug('No enabled MESSAGE_RECEIVED workflows found', { organizationId })
    return
  }

  const messageData = await loadProcessedMessage(messageId, organizationId)
  if (!messageData) {
    logger.warn('Message not found, skipping MESSAGE_RECEIVED workflows', {
      messageId,
      organizationId,
    })
    return
  }

  const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
  for (const workflow of matchingWorkflows) {
    await workflowDelayQueue.add('executeMessageTrigger', {
      workflowAppId: workflow.workflowApp.id,
      workflowId: workflow.publishedWorkflow.id,
      organizationId,
      messageData,
      messageId,
      threadId,
      triggeredAt: new Date().toISOString(),
    })
  }

  logger.info('Queued workflows for message:received trigger', {
    messageId,
    organizationId,
    workflowCount: matchingWorkflows.length,
  })
}
