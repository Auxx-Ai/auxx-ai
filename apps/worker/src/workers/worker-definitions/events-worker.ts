import {
  createAuditLog,
  createEventJob,
  createTimelineEvent,
  handleFieldTriggerJob,
  handleRecordRules,
  handleSyncRecordRules,
  publishEventJob,
  publishThreadEventToRealtime,
  publishToAnalyticsJob,
  sendInvitationUserJob,
  triggerAgents,
  triggerResourceDispatch,
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
  // Combined CRUD dispatcher; the standalone pair stays registered for
  // direct-match-only events and jobs already queued at deploy time.
  triggerResourceDispatch,
  triggerResourceWorkflows,
  triggerAgents,
  handleFieldTriggerJob,
  handleRecordRules,
  handleSyncRecordRules,
  publishThreadEventToRealtime,
}

// IO-bound handlers; concurrency > 1 drops the queue-global FIFO ordering,
// which the handlers tolerate (idempotent upserts, out-of-order guards).
export function startEventsWorker() {
  return createWorker(Queues.eventsQueue, eventsJobMappings, { concurrency: 10 })
}

export function startEventHandlersWorker() {
  return createWorker(Queues.eventHandlersQueue, eventHandlersJobMappings, { concurrency: 20 })
}
