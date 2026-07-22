import {
  autoCompleteTasks,
  createAuditLog,
  createEventJob,
  createTimelineEvent,
  deriveMessageReplySignal,
  deriveThreadResolvedSignal,
  handleFieldTriggerJob,
  handleRecordRules,
  handleSignalRecordRules,
  handleSyncRecordRules,
  ingestBounceMessage,
  projectSignalToTimeline,
  publishEventJob,
  publishThreadEventToRealtime,
  publishToAnalyticsJob,
  sendInvitationUserJob,
  triggerAgents,
  triggerMessageWorkflows,
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
  triggerMessageWorkflows,
  handleFieldTriggerJob,
  handleRecordRules,
  handleSyncRecordRules,
  publishThreadEventToRealtime,
  // Message-signal + bounce + signal-projection handlers, fanned out from
  // publishEventJob (message:received, ticket:status:changed, signal:recorded).
  deriveMessageReplySignal,
  deriveThreadResolvedSignal,
  ingestBounceMessage,
  projectSignalToTimeline,
  // Signal door (record rules) + auto-complete-on-reply — also fanned out from
  // signal:recorded (plans/signals/06-follow-ups-build.md Steps 3 + 5).
  handleSignalRecordRules,
  autoCompleteTasks,
}

// IO-bound handlers; concurrency > 1 drops the queue-global FIFO ordering,
// which the handlers tolerate (idempotent upserts, out-of-order guards).
export function startEventsWorker() {
  return createWorker(Queues.eventsQueue, eventsJobMappings, { concurrency: 10 })
}

export function startEventHandlersWorker() {
  return createWorker(Queues.eventHandlersQueue, eventHandlersJobMappings, { concurrency: 20 })
}
