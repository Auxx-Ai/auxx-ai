// packages/lib/src/events/handlers/trigger-message-workflows.ts

import { createScopedLogger } from '@auxx/logger'
import { getCachedWorkflowAppsByTrigger, getOrgCache } from '../../cache'
import {
  type CachedPublishedWorkflow,
  hydrateCachedGraph,
} from '../../cache/providers/workflow-apps-provider'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import { WorkflowNodeType, WorkflowTriggerType } from '../../workflow-engine/core/types'
import { loadProcessedMessage } from '../../workflow-engine/nodes/trigger-nodes/message-loader'
import type { AuxxEvent, MessageReceivedEvent } from '../types'

const logger = createScopedLogger('trigger-message-workflows')

/**
 * The message-received trigger node of a published workflow, as the cache read
 * boundary hands it over.
 *
 * Resolved ONCE per matching workflow and shared by the three scope filters
 * below, which each used to walk the cached bytes themselves. The org cache is
 * an undeclared storage location for a workflow graph (plan 23 §4.1) and what
 * it holds is the CANONICAL document, so a reader of trigger config goes
 * through the hydrator rather than reading the blob: `data.type` is only
 * guaranteed present after hydration, and a legacy `app-trigger` type is only
 * normalized there.
 */
function messageTriggerNode(publishedWorkflow: CachedPublishedWorkflow): any | undefined {
  return hydrateCachedGraph(publishedWorkflow.graph).nodes.find(
    (node) => (node?.data?.type ?? node?.type) === WorkflowNodeType.MESSAGE_RECEIVED
  )
}

/**
 * Read the message-received trigger node's soft machine-mail opt-in off the
 * published workflow graph. Default `'exclude'` — a workflow only receives soft
 * machine mail (OOO, list/notification) when its trigger config explicitly sets
 * `machineMail: 'include'`. Returns `true` when the workflow should be dispatched
 * for soft machine mail.
 */
function includesSoftMachineMail(triggerNode: any | undefined): boolean {
  return triggerNode?.data?.machineMail === 'include'
}

/**
 * Read the message-received trigger node's own-address opt-out off the
 * published workflow graph. Default `'include'` — mail sent from one of the
 * org's own connected channel addresses DOES start a workflow, because at the
 * address level a teammate mailing the shared inbox from their own connected
 * mailbox is indistinguishable from a cross-channel echo, and the former is
 * real mail that should be automated. A workflow that genuinely must ignore
 * its own org's mail sets `ownAddress: 'exclude'`. The proven-echo case
 * (`ownEcho`) is not covered by this toggle — it is always skipped.
 * Returns `true` when the workflow should be dispatched for own-address mail.
 */
function includesOwnAddressMail(triggerNode: any | undefined): boolean {
  return (triggerNode?.data?.ownAddress ?? 'include') === 'include'
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
  triggerNode: any | undefined,
  integrationId: string | undefined
): boolean {
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
  const {
    messageId,
    organizationId,
    threadId,
    machineMail,
    integrationId,
    inboxId,
    ownEcho,
    fromOwnAddress,
  } = (event as MessageReceivedEvent).data

  // Proven self-send — the inbound copy's `X-AuxxAi-Message-Id` resolved to a
  // message THIS org sent (`store-message.ts`). Hard, no per-trigger opt-in:
  // it is a literal duplicate of our own outbound mail, so there is no
  // workflow for which running on it is correct. This is the only remaining
  // unconditional loop guard on the dispatch path — the address-level signal
  // below is the workflow author's call.
  if (ownEcho) {
    logger.info('Skipping MESSAGE_RECEIVED workflows — message is an echo of our own sent mail', {
      messageId,
      organizationId,
      sentMessageId: ownEcho.sentMessageId,
    })
    return
  }

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

  // Personal channels are not automatable (§8.2/§11): a message that landed in
  // a personal mailbox never dispatches message-received workflows. The
  // save-time guard (`mail-trigger-guard.ts`) blocks explicitly targeting a
  // personal channel; this covers unscoped triggers, whose scope defaults to
  // every channel in the org.
  if (inboxId) {
    const inboxes = await getOrgCache().get(organizationId, 'inboxes')
    if (inboxes.some((inbox) => inbox.id === inboxId && inbox.isPersonal)) {
      logger.info('Skipping MESSAGE_RECEIVED workflows — message is on a personal channel', {
        messageId,
        organizationId,
        inboxId,
      })
      return
    }
  }

  const matchingApps = await getCachedWorkflowAppsByTrigger({
    organizationId,
    triggerType: WorkflowTriggerType.MESSAGE_RECEIVED,
  })

  let matchingWorkflows = matchingApps
    .filter((app) => app.publishedWorkflow)
    .map((app) => ({
      workflowApp: app,
      publishedWorkflow: app.publishedWorkflow!,
      // One hydration per candidate workflow, reused by all three filters below.
      triggerNode: messageTriggerNode(app.publishedWorkflow!),
    }))

  // Soft-tier machine mail (OOO, list/notification) is automated but possibly
  // wanted — dispatch only to workflows whose trigger opted in
  // (`machineMail: 'include'`). Default (absent/`'exclude'`) skips. No
  // machineMail flag → dispatch to all, as normal.
  if (machineMail?.tier === 'soft') {
    matchingWorkflows = matchingWorkflows.filter((workflow) =>
      includesSoftMachineMail(workflow.triggerNode)
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

  // Own-address mail: the sender is one of the org's connected channel
  // addresses. Opt-OUT (default include), the inverse of machineMail above —
  // most such mail is a teammate writing to the shared inbox, which should
  // automate normally. Only a workflow that would loop on its org's own mail
  // sets `ownAddress: 'exclude'`.
  if (fromOwnAddress) {
    matchingWorkflows = matchingWorkflows.filter((workflow) => {
      const includes = includesOwnAddressMail(workflow.triggerNode)
      if (!includes) {
        logger.info('Skipping MESSAGE_RECEIVED workflow — opted out of own-address mail', {
          messageId,
          organizationId,
          workflowAppId: workflow.workflowApp.id,
        })
      }
      return includes
    })
  }

  // Channel scope (§4): a workflow whose trigger is restricted to specific
  // channels doesn't fire for a message on a different one. Sits beside the
  // machineMail filter above for the same reason — a non-match costs zero
  // queries, `integrationId` already rode in on the event.
  matchingWorkflows = matchingWorkflows.filter((workflow) => {
    const matches = matchesChannelScope(workflow.triggerNode, integrationId)
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
