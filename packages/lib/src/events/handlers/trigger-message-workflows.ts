// packages/lib/src/events/handlers/trigger-message-workflows.ts

import { createScopedLogger } from '@auxx/logger'
import { getCachedWorkflowAppsByTrigger } from '../../cache'
import type { CachedPublishedWorkflow } from '../../cache/providers/workflow-apps-provider'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import { WorkflowNodeType, WorkflowTriggerType } from '../../workflow-engine/core/types'
import { loadProcessedMessage } from '../../workflow-engine/nodes/trigger-nodes/message-loader'
import type { AuxxEvent, MessageReceivedEvent } from '../types'

const logger = createScopedLogger('trigger-message-workflows')

/**
 * Read the message-received trigger node's soft machine-mail opt-in off the
 * published workflow graph. Default `'exclude'` — a workflow only receives soft
 * machine mail (OOO, list/notification) when its trigger config explicitly sets
 * `machineMail: 'include'`. Returns `true` when the workflow should be dispatched
 * for soft machine mail.
 */
function includesSoftMachineMail(publishedWorkflow: CachedPublishedWorkflow): boolean {
  const nodes = (publishedWorkflow.graph as { nodes?: any[] } | null | undefined)?.nodes
  if (!Array.isArray(nodes)) return false
  const triggerNode = nodes.find(
    (node) => (node?.data?.type ?? node?.type) === WorkflowNodeType.MESSAGE_RECEIVED
  )
  return triggerNode?.data?.machineMail === 'include'
}

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
  const { messageId, organizationId, threadId, machineMail } = (event as MessageReceivedEvent).data

  // Hard-tier machine mail (bounces/NDRs) is loop-forming — never dispatch any
  // workflow. There is nothing sensible for an Answer node to say to a daemon.
  if (machineMail?.tier === 'hard') {
    logger.info('Skipping MESSAGE_RECEIVED workflows for hard-tier machine mail', {
      messageId,
      organizationId,
      reason: machineMail.reason,
    })
    return
  }

  const matchingApps = await getCachedWorkflowAppsByTrigger({
    organizationId,
    triggerType: WorkflowTriggerType.MESSAGE_RECEIVED,
  })

  let matchingWorkflows = matchingApps
    .filter((app) => app.publishedWorkflow)
    .map((app) => ({ workflowApp: app, publishedWorkflow: app.publishedWorkflow! }))

  // Soft-tier machine mail (OOO, list/notification) is automated but possibly
  // wanted — dispatch only to workflows whose trigger opted in
  // (`machineMail: 'include'`). Default (absent/`'exclude'`) skips. No
  // machineMail flag → dispatch to all, as normal.
  if (machineMail?.tier === 'soft') {
    matchingWorkflows = matchingWorkflows.filter((workflow) =>
      includesSoftMachineMail(workflow.publishedWorkflow)
    )
    if (matchingWorkflows.length === 0) {
      logger.info('No MESSAGE_RECEIVED workflows opted into soft-tier machine mail', {
        messageId,
        organizationId,
        reason: machineMail.reason,
      })
      return
    }
  }

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
