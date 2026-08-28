// packages/lib/src/events/handlers/publish-event-job.ts

import { createScopedLogger } from '@auxx/logger'
import { handleFieldTriggerJob } from '../../field-hooks/field-hook-job'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import { enqueueMailClassification } from '../../mail-classification/enqueue'
import type {
  AuxxEvent,
  EventHandler,
  GatedEventHandlers,
  GateHandler,
  IEventsHandlers,
} from '../types'
import { applyMailFilters } from './apply-mail-filters'
import { autoCompleteTasks } from './auto-complete-tasks'
import { createAuditLog } from './create-audit-log'
import { createTimelineEvent } from './create-timeline-event'
import { deriveMessageReplySignal, deriveThreadResolvedSignal } from './derive-message-signals'
import { flipDocumentStatusOnSend } from './flip-document-status-on-send'
import { handleRecordRules } from './handle-record-rules'
import { handleSignalRecordRules } from './handle-signal-record-rules'
import { handleSyncDuplicateScan } from './handle-sync-duplicate-scan'
import { handleSyncRecordRules } from './handle-sync-record-rules'
import { ingestBounceMessage } from './ingest-bounce-message'
import { projectSignalToTimeline } from './project-signal-to-timeline'
import { publishThreadEventToRealtime } from './publish-thread-event-to-realtime'
import { sendInvitationUserJob } from './send-invitation-user-job'
import { triggerAgents } from './trigger-agents'
import { triggerMessageWorkflows } from './trigger-message-workflows'
import { triggerResourceDispatch } from './trigger-resource-dispatch'
import { updateWebhookLastTriggeredAt } from './update-webhook-last-triggered'

const logger = createScopedLogger('publish-event-job')

/**
 * How long the whole gate phase may hold its `eventsQueue` slot before the
 * fan-out proceeds unsuppressed (plan §3).
 *
 * Fail-open needs a DEFINED trigger, not "eventually": without this a gate that
 * hangs on a slow query would stall the timeline, bounce ingestion and workflows
 * for that message indefinitely. On expiry we log, suppress nothing, and enqueue
 * the full `then` list.
 */
const GATE_TIMEOUT_MS = 2000

const GATE_TIMED_OUT = Symbol('gate-timed-out')

export const EventHandlers: IEventsHandlers = {
  // user events
  'user:created': [],
  'project:created': [],

  'membership:created': [sendInvitationUserJob, createAuditLog],

  // Ticket events → CREATE TIMELINE
  'ticket:created': [createTimelineEvent, triggerResourceDispatch, handleRecordRules],
  'ticket:updated': [createTimelineEvent, triggerResourceDispatch],
  'ticket:deleted': [triggerResourceDispatch, handleRecordRules],
  'ticket:status:changed': [createTimelineEvent, triggerAgents, deriveThreadResolvedSignal],
  'ticket:assignee:added': [triggerAgents],
  'ticket:assignee:removed': [triggerAgents],
  'ticket:reply:created': [triggerAgents],

  // message events → MAIL-FILTER GATE, then CREATE TIMELINE + TRIGGER WORKFLOWS
  //
  // The only gated entry in this map (plan §3). `applyMailFilters` runs INLINE
  // here — it is deliberately absent from the worker's `eventHandlersJobMappings`,
  // because a filter that marks a message spam has to settle BEFORE
  // `triggerMessageWorkflows` is enqueued, and `eventHandlersQueue` has no
  // ordering.
  //
  // ⚠️ Latency: gated types wait on `eventsQueue`, which `publishEventJob`
  // shares with every other event type at `concurrency: 10`
  // (`apps/worker/src/workers/worker-definitions/events-worker.ts`). A slow gate
  // is head-of-line blocking for UNRELATED events, not just for mail. If
  // measurement ever shows the gate holding slots, give it its own queue before
  // raising concurrency.
  'message:received': {
    gate: [applyMailFilters],
    // `gate`/`then` is the plan's vocabulary for this map (§3). The object is
    // never awaited — `publishEventJob` branches on `Array.isArray` first.
    // biome-ignore lint/suspicious/noThenProperty: not a thenable, see above.
    then: [
      createTimelineEvent,
      triggerMessageWorkflows,
      deriveMessageReplySignal,
      ingestBounceMessage,
      // AI categorisation (mail-classification plan §4). ON THE `then` SIDE, not
      // the gate: an LLM call would blow `GATE_TIMEOUT_MS` and head-of-line
      // block unrelated events, and the gate's fail-open would then make the
      // classification silently never happen (invariant 2).
      //
      // Enqueuing here is also what makes guard exit 6 correct — `applyMailFilters`
      // has already run inline by now, so every deterministic `add-tag` is on the
      // thread before the classifier decides whether a rule already answered.
      enqueueMailClassification,
    ],
  },
  // Published by `MessageSenderService` for every landed send, on every door
  // (dispatch/money plan 22). `createTimelineEvent` writes the outbound
  // `contact:email:sent` row — the twin of `message:received`'s — and only when the
  // payload carries the recipient's contact `recordId`; `flipDocumentStatusOnSend`
  // moves a sent quote/invoice/purchase order out of `draft`, and only for
  // `origin: 'compose'`.
  'message:sent': [createTimelineEvent, flipDocumentStatusOnSend],
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
  // Admin-surface-only thread events (thread-events §13.2) — the handler's
  // visitor fan-out is gated on the FROZEN visitor set, so these never reach
  // the public visitor channel.
  'thread:tagged': [publishThreadEventToRealtime],
  'thread:untagged': [publishThreadEventToRealtime],
  'thread:merged': [publishThreadEventToRealtime],

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
  'contact:created': [createTimelineEvent, triggerResourceDispatch, handleRecordRules],
  'contact:updated': [createTimelineEvent, triggerResourceDispatch],
  'contact:deleted': [createTimelineEvent, triggerResourceDispatch, handleRecordRules],
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
  'entity:created': [createTimelineEvent, triggerResourceDispatch, handleRecordRules],
  'entity:updated': [createTimelineEvent, triggerResourceDispatch],
  'entity:deleted': [createTimelineEvent, triggerResourceDispatch, handleRecordRules],
  'entity:field:updated': [createTimelineEvent],

  // Signal door (record rules) + auto-complete-on-reply, appended alongside the
  // timeline projection (plans/signals/06-follow-ups-build.md Steps 3 + 5).
  'signal:recorded': [projectSignalToTimeline, handleSignalRecordRules, autoCompleteTasks],

  // Stock movement events → ENTITY TRIGGERS (inventory QoH recalculation) + WORKFLOWS
  'stock_movement:created': [triggerResourceDispatch, handleRecordRules],
  'stock_movement:deleted': [triggerResourceDispatch, handleRecordRules],

  // Vendor part / subpart events → ENTITY TRIGGERS (BOM cost recalculation) + WORKFLOWS
  'vendor_part:created': [triggerResourceDispatch, handleRecordRules],
  'vendor_part:deleted': [triggerResourceDispatch, handleRecordRules],
  'subpart:created': [triggerResourceDispatch, handleRecordRules],
  'subpart:deleted': [triggerResourceDispatch, handleRecordRules],

  // Company events → TIMELINE + ENTITY TRIGGERS (website enrichment on create) + WORKFLOWS
  'company:created': [createTimelineEvent, triggerResourceDispatch, handleRecordRules],
  'company:deleted': [createTimelineEvent, triggerResourceDispatch, handleRecordRules],

  // Field trigger events → FIELD TRIGGER HANDLERS
  'field:trigger': [handleFieldTriggerJob],

  // B2 — bulk-writer sync-change manifest → record rules with `source: 'sync'`,
  // and the duplicate scan for the same run's records. The dedup consumer must
  // NEVER claim the manifest: the claim is the rules consumer's once-only latch,
  // and a second claimant would starve it.
  'sync:records:changed': [handleSyncRecordRules, handleSyncDuplicateScan],

  // Integration events → AUDIT LOG (+ analytics)
  'integration:connected': [createAuditLog],
  'integration:connection_failed': [createAuditLog],
  'shopify:connected': [createAuditLog],

  // Recording AI results — persisted + realtime-published by the recording
  // pipeline itself; nothing fans out from the bus yet.
  'recording:ai.summary_ready': [],
  'recording:ai.chapters_ready': [],
  'recording:ai.insights_ready': [],
  'recording:ai.failed': [],
}

/**
 * Run every gate handler for one event and union what they asked to suppress.
 *
 * **Fail-open is the whole contract** (invariant 3). A gate that throws, or the
 * gate phase as a whole exceeding {@link GATE_TIMEOUT_MS}, contributes NO
 * suppression — a broken filter must never be able to stop the timeline, bounce
 * ingestion or workflows. Never throws.
 */
async function runGate(gate: GateHandler<AuxxEvent>[], event: AuxxEvent): Promise<Set<string>> {
  const suppressed = new Set<string>()
  if (gate.length === 0) return suppressed

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const settled = await Promise.race([
      Promise.all(
        gate.map(async (handler) => {
          try {
            return await handler({ data: event })
          } catch (error) {
            logger.error('Event gate handler failed — suppressing nothing (fail-open)', {
              eventType: event.type,
              handler: handler.name,
              error: error instanceof Error ? error.message : String(error),
            })
            return undefined
          }
        })
      ),
      new Promise<typeof GATE_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(GATE_TIMED_OUT), GATE_TIMEOUT_MS)
        // Don't hold the process open on a short-lived script.
        timer.unref?.()
      }),
    ])

    if (settled === GATE_TIMED_OUT) {
      logger.error('Event gate timed out — enqueuing the full handler list (fail-open)', {
        eventType: event.type,
        timeoutMs: GATE_TIMEOUT_MS,
      })
      return suppressed
    }

    for (const result of settled) {
      for (const name of result?.suppress ?? []) suppressed.add(name)
    }
  } catch (error) {
    // Defensive: `Promise.all` above already swallows per-handler throws.
    logger.error('Event gate phase failed — suppressing nothing (fail-open)', {
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    if (timer) clearTimeout(timer)
  }

  return suppressed
}

export const publishEventJob = async ({ data: event }: { data: AuxxEvent }) => {
  // The map is keyed per event type, so indexing it with a union `event.type`
  // yields a union of unrelated handler-array types. Widen once, here.
  const entry = EventHandlers[event.type] as
    | EventHandler<AuxxEvent>[]
    | GatedEventHandlers<AuxxEvent>
    | undefined
  if (!entry) return

  // One awaited round-trip; an enqueue failure fails the job (BullMQ retries)
  // instead of being silently dropped.
  const queue = getQueue(Queues.eventHandlersQueue)

  // Ungated entries — byte-identical to the pre-gate behaviour.
  if (Array.isArray(entry)) {
    if (entry.length === 0) return
    await queue.addBulk(entry.map((handler) => ({ name: handler.name, data: event })))
    return
  }

  if (entry.then.length === 0) return
  const suppressed = await runGate(entry.gate, event)
  const survivors = entry.then.filter((handler) => !suppressed.has(handler.name))
  if (survivors.length === 0) return
  await queue.addBulk(survivors.map((handler) => ({ name: handler.name, data: event })))
}
