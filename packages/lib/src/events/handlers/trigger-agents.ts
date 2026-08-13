// packages/lib/src/events/handlers/trigger-agents.ts

import { createScopedLogger } from '@auxx/logger'
import { matchesFilter } from '../../agents/agent-trigger-queries'
import { getCachedAgents } from '../../cache'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import { fetchResourceById } from '../../resources/resource-fetcher'
import { parseRecordId } from '../../resources/resource-id'
import type { AuxxEvent } from '../types'
import {
  getEventRecordId,
  type ResourceFetcher,
  resolveResourceTriggerMatch,
} from './trigger-resource-workflows'

const logger = createScopedLogger('trigger-agents')

/**
 * Sibling to `triggerResourceWorkflows` — for every resource CRUD event AND
 * the allowlisted direct-match events, look up matching `AgentTrigger` rows
 * and enqueue an autonomous agent run for each.
 *
 * Two independent branches:
 *   1. CRUD: reuse `resolveResourceTriggerMatch` and match by `{triggerType, entityDefinitionId}`.
 *   2. Direct: match by `eventType` literal.
 *
 * The two branches are independent; one event may match both kinds of
 * triggers, but a single row only ever hits one branch (column-driven mode).
 *
 * All trigger reads come from the org `agents` cache — see
 * plans/kopilot/agents/cache/plan.md.
 */
export const triggerAgents = async ({ data: event }: { data: AuxxEvent }) =>
  dispatchAgentTriggers(event, fetchResourceById)

/**
 * Core agent-trigger dispatch with an injectable record fetcher so the
 * combined CRUD dispatcher (`trigger-resource-dispatch.ts`) can share one
 * `fetchResourceById` result with the workflow dispatcher.
 */
export const dispatchAgentTriggers = async (event: AuxxEvent, fetchResource: ResourceFetcher) => {
  const organizationId = (event.data as { organizationId?: string }).organizationId
  if (!organizationId) {
    logger.debug('Skipping agent triggers — event has no organizationId', { type: event.type })
    return
  }

  const agents = await getCachedAgents(organizationId)
  const queue = getQueue(Queues.scheduledTriggerQueue)
  let totalFired = 0

  // CRUD branch. Normalized to the org's EntityDefinition id before the strict
  // compare below — agent triggers store the picker's CUID, while `ticket:*` /
  // `contact:*` events report the slug (see `resolveResourceTriggerMatch`).
  const match = await resolveResourceTriggerMatch(event, organizationId)
  if (match) {
    const crudMatches: Array<{
      agentId: string
      triggerId: string
      filter: Record<string, unknown> | undefined
    }> = []
    for (const agent of agents) {
      for (const trigger of agent.triggers) {
        if (trigger.kind !== 'event' || !trigger.enabled) continue
        if (trigger.triggerType !== match.triggerType) continue
        // `matchIds`, not the canonical id — agent triggers store the CUID on
        // some rows and the bare slug on others.
        if (!trigger.entityDefinitionId || !match.matchIds.includes(trigger.entityDefinitionId))
          continue
        crudMatches.push({
          agentId: agent.id,
          triggerId: trigger.id,
          filter: (trigger.config as { filter?: Record<string, unknown> } | null)?.filter,
        })
      }
    }

    if (crudMatches.length > 0) {
      const recordId = getEventRecordId(event, match)
      const resourceData = recordId ? await fetchResource(recordId, organizationId) : null
      const payload = (resourceData ?? event.data) as Record<string, unknown>

      for (const m of crudMatches) {
        if (!matchesFilter(m.filter, payload)) continue
        await queue.add('executeAgentEventTrigger', {
          agentTriggerId: m.triggerId,
          agentId: m.agentId,
          organizationId,
          eventType: event.type,
          recordId,
          resourceData: payload,
          firedAt: new Date().toISOString(),
        })
        totalFired++
      }
    }
  }

  // Direct-match branch
  const directMatches: Array<{
    agentId: string
    triggerId: string
    filter: Record<string, unknown> | undefined
  }> = []
  for (const agent of agents) {
    for (const trigger of agent.triggers) {
      if (trigger.kind !== 'event' || !trigger.enabled) continue
      if (trigger.eventType !== event.type) continue
      directMatches.push({
        agentId: agent.id,
        triggerId: trigger.id,
        filter: (trigger.config as { filter?: Record<string, unknown> } | null)?.filter,
      })
    }
  }

  if (directMatches.length > 0) {
    const payload = event.data as Record<string, unknown>
    for (const m of directMatches) {
      if (!matchesFilter(m.filter, payload)) continue
      await queue.add('executeAgentEventTrigger', {
        agentTriggerId: m.triggerId,
        agentId: m.agentId,
        organizationId,
        eventType: event.type,
        recordId: (payload.recordId as string | undefined) ?? null,
        resourceData: payload,
        firedAt: new Date().toISOString(),
      })
      totalFired++
    }
  }

  // Mention branch — fires for the referenced agent. Agent references use
  // the `agent:<agentId>` ActorId prefix (Agent.id, not the synthetic User row).
  if (event.type === 'comment:referenced') {
    const { referencedRecordId, mentionerUserId, commentId, parentRecordId, siblingReferences } =
      event.data
    const { entityDefinitionId, entityInstanceId } = parseRecordId(referencedRecordId)
    if (entityDefinitionId === 'agent') {
      const agentId = entityInstanceId
      const referencedAgent = agents.find((a) => a.id === agentId)
      if (referencedAgent) {
        for (const trigger of referencedAgent.triggers) {
          if (trigger.kind !== 'mention' || !trigger.enabled) continue
          await queue.add('executeAgentMentionTrigger', {
            agentTriggerId: trigger.id,
            agentId,
            organizationId,
            commentId,
            mentionerUserId,
            parentRecordId,
            siblingReferences,
            firedAt: new Date().toISOString(),
          })
          totalFired++
        }
      }
    }
  }

  // Assignment branch — fires when an agent is the new assignee on a ticket.
  if (event.type === 'ticket:assignee:added') {
    const data = event.data as Record<string, unknown>
    const assigneeIds = Array.isArray(data.assigneeIds) ? (data.assigneeIds as string[]) : []
    const assignerUserId = (data.userId as string | undefined) ?? null
    const ticketId = (data.ticketId as string | undefined) ?? null
    const threadRecordId = ticketId ? `ticket:${ticketId}` : null

    if (assigneeIds.length > 0) {
      // Look up agents backing the assignee user ids. AGENT user rows have
      // userType='AGENT' and a single Agent row pointing at them.
      const assigneeSet = new Set(assigneeIds)
      const assigneeAgents = agents.filter((a) => a.userId && assigneeSet.has(a.userId))
      for (const agent of assigneeAgents) {
        for (const trigger of agent.triggers) {
          if (trigger.kind !== 'assignment' || !trigger.enabled) continue
          await queue.add('executeAgentAssignmentTrigger', {
            agentTriggerId: trigger.id,
            agentId: agent.id,
            organizationId,
            threadRecordId,
            assignerUserId,
            firedAt: new Date().toISOString(),
          })
          totalFired++
        }
      }
    }
  }

  if (totalFired > 0) {
    logger.info('Queued agent event-trigger runs', {
      eventType: event.type,
      organizationId,
      count: totalFired,
    })
  }
}
