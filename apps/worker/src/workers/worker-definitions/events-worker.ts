import {
  createAuditLog,
  createEventJob,
  createTimelineEvent,
  handleEntityTriggers,
  handleFieldTriggerJob,
  handleRecordRules,
  publishEventJob,
  publishThreadEventToRealtime,
  publishToAnalyticsJob,
  sendInvitationUserJob,
  triggerAgents,
  triggerResourceWorkflows,
  updateWebhookLastTriggeredAt,
} from '@auxx/lib/events/handlers'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

// Events Queue job mappings
const eventsJobMappings = {
  publishEventJob,
  createEventJob,
  publishToAnalyticsJob,
}

// Event Handlers Queue job mappings
const eventHandlersJobMappings = {
  sendInvitationUserJob,
  updateWebhookLastTriggeredAt,
  createTimelineEvent,
  createAuditLog,
  triggerResourceWorkflows,
  triggerAgents,
  handleFieldTriggerJob,
  handleEntityTriggers,
  handleRecordRules,
  publishThreadEventToRealtime,
}

export function startEventsWorker() {
  return createWorker(Queues.eventsQueue, eventsJobMappings)
}

export function startEventHandlersWorker() {
  return createWorker(Queues.eventHandlersQueue, eventHandlersJobMappings)
}
