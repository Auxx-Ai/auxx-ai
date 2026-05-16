// packages/lib/src/events/handlers/trigger-agents.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import {
  getAgentTriggersByAssignment,
  getAgentTriggersByCrudEvent,
  getAgentTriggersByDirectEvent,
  getAgentTriggersByMention,
  matchesFilter,
} from '../../agents/agent-trigger-queries'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import { fetchResourceById } from '../../resources/resource-fetcher'
import { parseRecordId } from '../../resources/resource-id'
import type { AuxxEvent } from '../types'
import { getEventRecordId, getResourceTriggerMatch } from './trigger-resource-workflows'

const logger = createScopedLogger('trigger-agents')

/**
 * Sibling to `triggerResourceWorkflows` — for every resource CRUD event AND
 * the allowlisted direct-match events, look up matching `AgentTrigger` rows
 * and enqueue an autonomous agent run for each.
 *
 * Two independent branches:
 *   1. CRUD: reuse `getResourceTriggerMatch` and query by `{triggerType, entityDefinitionId}`.
 *   2. Direct: query by `eventType` literal.
 *
 * The two branches are independent; one event may match both kinds of
 * triggers, but a single row only ever hits one branch (column-driven mode).
 */
export const triggerAgents = async ({ data: event }: { data: AuxxEvent }) => {
  const organizationId = (event.data as { organizationId?: string }).organizationId
  if (!organizationId) {
    logger.debug('Skipping agent triggers — event has no organizationId', { type: event.type })
    return
  }

  const queue = getQueue(Queues.scheduledTriggerQueue)
  let totalFired = 0

  // CRUD branch
  const match = getResourceTriggerMatch(event)
  if (match) {
    const crudTriggers = await getAgentTriggersByCrudEvent({
      organizationId,
      triggerType: match.triggerType,
      entityDefinitionId: match.entityDefinitionId,
    })

    if (crudTriggers.length > 0) {
      const recordId = getEventRecordId(event, match)
      const resourceData = recordId ? await fetchResourceById(recordId, organizationId) : null
      const payload = (resourceData ?? event.data) as Record<string, unknown>

      for (const trigger of crudTriggers) {
        const filter = (trigger.config as { filter?: Record<string, unknown> }).filter
        if (!matchesFilter(filter, payload)) continue

        await queue.add('executeAgentEventTrigger', {
          agentTriggerId: trigger.id,
          agentId: trigger.agentId,
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
  const directTriggers = await getAgentTriggersByDirectEvent({
    organizationId,
    eventType: event.type,
  })

  if (directTriggers.length > 0) {
    const payload = event.data as Record<string, unknown>
    for (const trigger of directTriggers) {
      const filter = (trigger.config as { filter?: Record<string, unknown> }).filter
      if (!matchesFilter(filter, payload)) continue

      await queue.add('executeAgentEventTrigger', {
        agentTriggerId: trigger.id,
        agentId: trigger.agentId,
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
      const mentionTriggers = await getAgentTriggersByMention({ organizationId, agentId })
      for (const trigger of mentionTriggers) {
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

  // Assignment branch — fires when an agent is the new assignee on a ticket.
  if (event.type === 'ticket:assignee:added') {
    const data = event.data as Record<string, unknown>
    const assigneeIds = Array.isArray(data.assigneeIds) ? (data.assigneeIds as string[]) : []
    const assignerUserId = (data.userId as string | undefined) ?? null
    const ticketId = (data.ticketId as string | undefined) ?? null
    const threadRecordId = ticketId ? `ticket:${ticketId}` : null

    for (const assigneeId of assigneeIds) {
      // Look up the agent backing this assignee user id. AGENT user rows
      // have userType='AGENT' and a single Agent row pointing at them.
      const [agent] = await database
        .select({ id: schema.Agent.id })
        .from(schema.Agent)
        .where(
          and(eq(schema.Agent.userId, assigneeId), eq(schema.Agent.organizationId, organizationId))
        )
        .limit(1)
      if (!agent) continue

      const assignmentTriggers = await getAgentTriggersByAssignment({
        organizationId,
        agentId: agent.id,
      })
      for (const trigger of assignmentTriggers) {
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

  if (totalFired > 0) {
    logger.info('Queued agent event-trigger runs', {
      eventType: event.type,
      organizationId,
      count: totalFired,
    })
  }
}
