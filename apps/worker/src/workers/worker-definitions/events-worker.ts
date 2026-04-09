import {
  createEventJob,
  createTimelineEvent,
  handleEntityTriggers,
  handleFieldTriggerJob,
  publishEventJob,
  publishToAnalyticsJob,
  sendInvitationUserJob,
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
  triggerResourceWorkflows,
  handleFieldTriggerJob,
  handleEntityTriggers,
}

export function startEventsWorker() {
  return createWorker(Queues.eventsQueue, eventsJobMappings)
}

export function startEventHandlersWorker() {
  return createWorker(Queues.eventHandlersQueue, eventHandlersJobMappings)
}
