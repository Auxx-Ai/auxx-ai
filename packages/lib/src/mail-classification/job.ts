// packages/lib/src/mail-classification/job.ts
// The `mailClassificationQueue` worker (§4).
//
// Why a dedicated queue: an LLM call cannot go in the gate
// (`GATE_TIMEOUT_MS = 2000` on `eventsQueue` at `concurrency: 10`, shared with
// every other event type — it would routinely time out and the fail-open path
// means the classification silently never happens, invariant 2), and it cannot
// go in `storeMessage` (invariant 1; 1–3s per message turns a 500-message
// backfill into 25 minutes). The follow-up pass is what is left, and C6 makes it
// sufficient rather than a compromise: the only category where beating the
// auto-answer agent mattered was `Spam`, and `Spam` is a status, not a category.
//
// ⚠️ THE JOB NEVER THROWS (invariant 6). Untagged is the safe state, and a
// throwing job would be retried by BullMQ — which is exactly the re-inference
// C9 forbids.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { JobContext } from '../jobs/types/job-context'
import { applyClassificationTag, markMessageClassified } from './apply'
import { classifyMessage } from './classify'
import type { MailClassificationSkipReason } from './client'
import { guardClassification } from './guard'
import { rerunMailFiltersAfterClassification } from './rerun-filters'

const logger = createScopedLogger('mail-classification')

export interface MailClassificationJobData {
  organizationId: string
  messageId: string
  threadId?: string
  /** `machineMail.tier` from the `message:received` payload. */
  machineMailTier?: 'hard' | 'soft'
  /** Sender identifier from the `message:received` payload. */
  from?: string
}

export interface MailClassificationJobResult {
  classified: boolean
  tagId?: string
  confidence?: number
  skipped?: MailClassificationSkipReason
  /** Filters that fired on the mandatory second pass (§4.1). */
  firedFilterIds?: string[]
}

/**
 * Classify one inbound message and let its tag reach the filter engine.
 *
 * Four steps, in this order and no other:
 *   1. the §3.1 guard (six exits, cheapest first)
 *   2. one model call (§3.2)
 *   3. the marker + the tag (§3.3, C9 before C5 so a crash between them costs an
 *      inference rather than repeating one)
 *   4. **the mandatory filter re-run** (§4.1) — without it the whole feature is
 *      silently dead
 */
export async function mailClassificationJob(
  ctx: JobContext<MailClassificationJobData>
): Promise<MailClassificationJobResult> {
  const { organizationId, messageId, threadId, machineMailTier, from } = ctx.data
  const db = database

  const gate = await guardClassification({
    db,
    organizationId,
    messageId,
    threadId,
    machineMailTier,
    from,
  }).catch((error) => {
    logger.error('Mail classification guard failed — skipping', {
      organizationId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { proceed: false as const, reason: 'error' as const }
  })

  if (!gate.proceed) {
    logger.debug('Mail classification skipped', {
      organizationId,
      messageId,
      reason: gate.reason,
    })
    return { classified: false, skipped: gate.reason }
  }

  const result = await classifyMessage(db, gate.context)

  // Stamp the marker for EVERY completed inference, including the ones that
  // apply nothing (C9): the spend has happened, and re-inferring the same
  // message would bill twice for the same answer. `'no-default-model'` is the
  // one exception — nothing was spent and nothing was decided, so the message
  // stays classifiable once a model is configured.
  if (result.reason !== 'no-default-model') {
    await markMessageClassified({
      db,
      organizationId,
      messageId,
      marker: {
        at: new Date().toISOString(),
        tagId: result.tagId,
        confidence: result.confidence,
        ...(result.model ? { model: result.model } : {}),
      },
    })
  }

  if (!result.tagId) {
    return { classified: false, confidence: result.confidence, skipped: result.reason }
  }

  const applied = await applyClassificationTag({
    db,
    organizationId,
    threadId: gate.context.threadId,
    tagId: result.tagId,
  })
  if (!applied) {
    return { classified: false, confidence: result.confidence, skipped: 'error' }
  }

  // ⚠️ §4.1 — MANDATORY. Applying a tag does not re-run filters; nothing else
  // calls the engine for this message ever again. Full set, `source: 'live'`.
  const firedFilterIds = await rerunMailFiltersAfterClassification({
    db,
    organizationId,
    threadId: gate.context.threadId,
    messageId,
  })

  return {
    classified: true,
    tagId: result.tagId,
    confidence: result.confidence,
    firedFilterIds,
  }
}
