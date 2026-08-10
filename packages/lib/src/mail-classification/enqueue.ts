// packages/lib/src/mail-classification/enqueue.ts
// The `then`-side door (§4): `message:received` → `mailClassificationQueue`.
//
// Deliberately NOT a gate. An LLM call in the gate would routinely exceed
// `GATE_TIMEOUT_MS` and head-of-line block unrelated events on `eventsQueue`
// (invariant 2), and the gate's fail-open path means the classification would
// then silently never happen.
//
// Enqueuing from `then` also buys guard exit 6 for free: `applyMailFilters` runs
// INLINE in the gate, so every deterministic `add-tag` has already landed on the
// thread by the time the classification job dequeues (§3.1.1).
//
// This handler does the cheapest payload-only checks and nothing else — the real
// ladder lives in `guard.ts`, on the classification worker, where a cache miss
// or a query costs an `eventHandlersQueue` slot rather than an `eventsQueue` one.

import { createScopedLogger } from '@auxx/logger'
import type { AuxxEvent, MessageReceivedEvent } from '../events/types'
import { getQueue } from '../jobs/queues'
import { Queues } from '../jobs/queues/types'
import { MAIL_CLASSIFICATION_JOB_NAME } from './client'
import type { MailClassificationJobData } from './job'

const logger = createScopedLogger('mail-classification')

/**
 * Fan `message:received` out to the classification queue.
 *
 * The BullMQ `jobId` is derived from the message id, so a duplicated event
 * delivery collapses into one queued job. That is a cheap first line of defence
 * only — the durable "classify once per message, ever" guarantee (C9) is the
 * `Message.metadata` marker guard exit 5 reads, because BullMQ forgets a jobId
 * once the job completes and is removed.
 */
export const enqueueMailClassification = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'message:received') return

  const { organizationId, messageId, threadId, machineMail, from } = (event as MessageReceivedEvent)
    .data

  // Payload-only exits 1 and 2 (§3.1). Everything past here costs a queue write,
  // so the two free checks happen on this side of it.
  if (machineMail?.tier === 'hard') return
  if (!threadId) return

  const data: MailClassificationJobData = {
    organizationId,
    messageId,
    threadId,
    ...(machineMail?.tier ? { machineMailTier: machineMail.tier } : {}),
    ...(from ? { from } : {}),
  }

  try {
    await getQueue(Queues.mailClassificationQueue).add(MAIL_CLASSIFICATION_JOB_NAME, data, {
      jobId: `mail-classify:${messageId}`,
    })
  } catch (error) {
    // Never throw: a classification that did not get queued must not fail the
    // event handler and take the rest of the fan-out's retry budget with it.
    logger.error('Failed to enqueue mail classification', {
      organizationId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
