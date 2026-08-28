import {
  autoCompleteTasks,
  createAuditLog,
  createEventJob,
  createTimelineEvent,
  deriveMessageReplySignal,
  deriveThreadResolvedSignal,
  flipDocumentStatusOnSend,
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
import { enqueueMailClassification } from '@auxx/lib/jobs'
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
  // `message:sent` → the confirmed-send lifecycle flip for quote/invoice/purchase order
  // (dispatch/money plan 22). Registered here or the job name never resolves and the
  // status silently never moves — which is the exact failure the plan retired.
  flipDocumentStatusOnSend,
  // Signal door (record rules) + auto-complete-on-reply — also fanned out from
  // signal:recorded (plans/signals/06-follow-ups-build.md Steps 3 + 5).
  handleSignalRecordRules,
  autoCompleteTasks,
  // `message:received` → `mailClassificationQueue` (mail-classification plan §4).
  // The name key must match `Function.prototype.name`, which is how
  // `publishEventJob` names the job it enqueues.
  enqueueMailClassification,
}

// IO-bound handlers; concurrency > 1 drops the queue-global FIFO ordering,
// which the handlers tolerate (idempotent upserts, out-of-order guards).
export function startEventsWorker() {
  return createWorker(Queues.eventsQueue, eventsJobMappings, { concurrency: 10 })
}

export function startEventHandlersWorker() {
  return createWorker(Queues.eventHandlersQueue, eventHandlersJobMappings, { concurrency: 20 })
}
