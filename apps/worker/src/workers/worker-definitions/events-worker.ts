import * as jobs from '@auxx/lib/jobs/definitions'
import { Queues } from '@auxx/lib/queues/types'
import { createWorker } from '../utils/createWorker'

// Events Queue job mappings
const eventsJobMappings = {
  publishEventJob: jobs.publishEventJob,
  createEventJob: jobs.createEventJob,
  publishToAnalyticsJob: jobs.publishToAnalyticsJob,
}

// Event Handlers Queue job mappings
const eventHandlersJobMappings = {
  sendInvitationUserJob: jobs.sendInvitationUserJob,
  updateWebhookLastTriggeredAt: jobs.updateWebhookLastTriggeredAt,
  createTimelineEvent: jobs.createTimelineEvent,
  triggerResourceWorkflows: jobs.triggerResourceWorkflows,
}

export function startEventsWorker() {
  return createWorker(Queues.eventsQueue, eventsJobMappings)
}

export function startEventHandlersWorker() {
  return createWorker(Queues.eventHandlersQueue, eventHandlersJobMappings)
}
