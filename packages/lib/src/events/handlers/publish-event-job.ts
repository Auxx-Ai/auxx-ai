// packages/lib/src/events/handlers/publish-event-job.ts

import type { Job } from 'bullmq'
import { handleEntityTriggers } from '../../field-hooks/entity-hook-handler'
import { handleFieldTriggerJob } from '../../field-hooks/field-hook-job'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import type { AuxxEvent, IEventsHandlers } from '../types'
import { createAuditLog } from './create-audit-log'
import { createTimelineEvent } from './create-timeline-event'
import { handleRecordRules } from './handle-record-rules'
import { publishThreadEventToRealtime } from './publish-thread-event-to-realtime'
import { sendInvitationUserJob } from './send-invitation-user-job'
import { triggerAgents } from './trigger-agents'
import { triggerResourceWorkflows } from './trigger-resource-workflows'
import { updateWebhookLastTriggeredAt } from './update-webhook-last-triggered'

export const EventHandlers: IEventsHandlers = {
  // user events
  'user:created': [],
  'project:created': [],

  'membership:created': [sendInvitationUserJob, createAuditLog],

  // Ticket events → CREATE TIMELINE
  'ticket:created': [
    createTimelineEvent,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],
  'ticket:updated': [createTimelineEvent, triggerResourceWorkflows, triggerAgents],
  'ticket:deleted': [triggerResourceWorkflows, triggerAgents, handleRecordRules],
  'ticket:status:changed': [createTimelineEvent, triggerAgents],
  'ticket:assignee:added': [triggerAgents],
  'ticket:assignee:removed': [triggerAgents],
  'ticket:reply:created': [triggerAgents],

  // message events → CREATE TIMELINE
  'message:received': [createTimelineEvent],
  'message:sent': [createTimelineEvent],
  'message:failed': [],
  'message:comment:created': [],
  'message:assignee:changed': [],
  'message:tag:added': [],
  'message:tag:removed': [],

  // thread events
  'thread:moved': [],
  'thread:deleted': [],
  'thread:restored': [],
  // Chat thread lifecycle events — persisted via the generic createEventJob
  // pipeline AND fanned out to the per-thread realtime room so widget +
  // admin clients render centered system lines without polling.
  'thread:archived': [publishThreadEventToRealtime],
  'thread:reopened': [publishThreadEventToRealtime],
  'thread:taken_over': [publishThreadEventToRealtime],
  'thread:returned_to_ai': [publishThreadEventToRealtime],
  'thread:assignee:changed': [publishThreadEventToRealtime],
  'thread:visitor:identified': [publishThreadEventToRealtime],

  'messages:sync:pending': [],
  'messages:sync:processing': [],
  'messages:sync:complete': [],
  'messages:sync:failed': [],

  'message:processing:started': [],
  'message:processing:completed': [],
  'message:processing:failed': [],

  'message:bulk:processing:started': [],
  'message:bulk:processing:completed': [],
  'message:bulk:processing:failed': [],

  'workflow:paused': [],
  'workflow:resumed': [],
  'workflow:resume:failed': [],

  // approval events
  'approval:created': [],
  'approval:responded': [],
  'approval:cancelled': [],
  'approval:timeout': [],

  // webhook events
  'webhook:delivery:created': [updateWebhookLastTriggeredAt],

  // Contact events → CREATE TIMELINE + TRIGGER WORKFLOWS
  'contact:created': [
    createTimelineEvent,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],
  'contact:updated': [createTimelineEvent, triggerResourceWorkflows, triggerAgents],
  'contact:deleted': [
    createTimelineEvent,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],
  'contact:merged': [createTimelineEvent],
  'contact:field:updated': [createTimelineEvent],
  'contact:group:added': [createTimelineEvent],
  'contact:group:removed': [createTimelineEvent],
  'ticket:field:updated': [createTimelineEvent],

  // Comment events → CREATE TIMELINE
  'comment:created': [createTimelineEvent],
  'comment:updated': [createTimelineEvent],
  'comment:deleted': [createTimelineEvent],
  'comment:replied': [createTimelineEvent],
  // Mention/agent reference → AGENT TRIGGERS (no timeline; reference is implicit in the comment).
  'comment:referenced': [triggerAgents],

  // Entity instance events → CREATE TIMELINE + ENTITY TRIGGERS + WORKFLOWS
  'entity:created': [
    createTimelineEvent,
    handleEntityTriggers,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],
  'entity:updated': [createTimelineEvent, triggerResourceWorkflows, triggerAgents],
  'entity:deleted': [
    createTimelineEvent,
    handleEntityTriggers,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],
  'entity:field:updated': [createTimelineEvent],

  // Stock movement events → ENTITY TRIGGERS (inventory QoH recalculation) + WORKFLOWS
  'stock_movement:created': [
    handleEntityTriggers,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],
  'stock_movement:deleted': [
    handleEntityTriggers,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],

  // Vendor part / subpart events → ENTITY TRIGGERS (BOM cost recalculation) + WORKFLOWS
  'vendor_part:created': [
    handleEntityTriggers,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],
  'vendor_part:deleted': [
    handleEntityTriggers,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],
  'subpart:created': [
    handleEntityTriggers,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],
  'subpart:deleted': [
    handleEntityTriggers,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],

  // Company events → TIMELINE + ENTITY TRIGGERS (website enrichment on create) + WORKFLOWS
  'company:created': [
    createTimelineEvent,
    handleEntityTriggers,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],
  'company:deleted': [
    createTimelineEvent,
    handleEntityTriggers,
    triggerResourceWorkflows,
    triggerAgents,
    handleRecordRules,
  ],

  // Field trigger events → FIELD TRIGGER HANDLERS
  'field:trigger': [handleFieldTriggerJob],

  // Integration events → AUDIT LOG (+ analytics)
  'integration:connected': [createAuditLog],
  'integration:connection_failed': [createAuditLog],
  'shopify:connected': [createAuditLog],
}

export const publishEventJob = async (job: Job<AuxxEvent>) => {
  const event = job.data
  const handlers = EventHandlers[event.type]

  const queue = getQueue(Queues.eventHandlersQueue)
  if (!handlers?.length) return
  handlers.forEach((handler) => {
    queue.add(handler.name, event)
  })
}
