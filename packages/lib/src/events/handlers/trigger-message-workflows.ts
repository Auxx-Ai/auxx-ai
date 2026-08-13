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
 * Read the message-received trigger node's channel scope off the published
 * workflow graph (message-trigger-scoping plan §4). `data.channelIds` is a
 * `string[]` of `Integration.id`s the builder's channel/inbox scope picker
 * wrote; `undefined` or `[]` means "all channels" — every workflow published
 * before scoping shipped keeps firing on everything, no forced migration.
 * Returns true when the workflow should be dispatched for a message that
 * arrived on `integrationId`.
 */
function matchesChannelScope(
  publishedWorkflow: CachedPublishedWorkflow,
  integrationId: string | undefined
): boolean {
  const nodes = (publishedWorkflow.graph as { nodes?: any[] } | null | undefined)?.nodes
  if (!Array.isArray(nodes)) return true
  const triggerNode = nodes.find(
    (node) => (node?.data?.type ?? node?.type) === WorkflowNodeType.MESSAGE_RECEIVED
  )
  const channelIds = triggerNode?.data?.channelIds
  if (!Array.isArray(channelIds) || channelIds.length === 0) return true
  return !!integrationId && channelIds.includes(integrationId)
}

/**
 * Event handler that dispatches the MESSAGE_RECEIVED workflow trigger.
 * Mirrors `dispatchResourceWorkflows` (`trigger-resource-workflows.ts`): look
 * up matching published workflows via the org cache, hydrate the trigger
 * payload once (shared across every matching workflow), and enqueue one
 * `executeMessageTrigger` job per workflow.
 *
 * Channel scoping (message-trigger-scoping plan §4) is gated HERE, not in the
 * node: `integrationId` rides on the event (hydrated at the publish site,
 * `store-message.ts`), so a non-matching message costs zero queries — the
 * trigger node's own content filters run later, inside
 * `MessageReceivedProcessor.executeNode`.
 */
export const triggerMessageWorkflows = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'message:received') return
  const { messageId, organizationId, threadId, machineMail, integrationId } = (
    event as MessageReceivedEvent
  ).data

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

  // Channel scope (§4): a workflow whose trigger is restricted to specific
  // channels doesn't fire for a message on a different one. Sits beside the
  // machineMail filter above for the same reason — a non-match costs zero
  // queries, `integrationId` already rode in on the event.
  matchingWorkflows = matchingWorkflows.filter((workflow) => {
    const matches = matchesChannelScope(workflow.publishedWorkflow, integrationId)
    if (!matches) {
      logger.info('Skipping MESSAGE_RECEIVED workflow — message channel outside trigger scope', {
        messageId,
        organizationId,
        workflowAppId: workflow.workflowApp.id,
        integrationId,
      })
    }
    return matches
  })

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
