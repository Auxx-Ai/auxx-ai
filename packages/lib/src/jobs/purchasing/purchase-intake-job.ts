// packages/lib/src/jobs/purchasing/purchase-intake-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCurrencyCode } from '../../field-values/org-currency'
import {
  checkIntakeModelCapability,
  failIntakeDraft,
  getIntakeDraft,
  markIntakeDraftReady,
  resolveQuoteLines,
  resolveQuoteVendor,
  setIntakeDraftExtractedText,
  setIntakeDraftPhase,
  transcribeQuote,
} from '../../purchasing'
import {
  type IntakeDraftPayload,
  type IntakeDraftPhase,
  parseIntakeMoney,
  type TranscribedQuote,
} from '../../purchasing/intake/client'
import { checkFixedWindowLimit } from '../../utils/rate-limiter/fixed-window'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:purchase-intake')

/** The BullMQ job name. Must match the key in the worker's `jobMappings`. */
export const PURCHASE_INTAKE_JOB_NAME = 'purchaseIntakeJob'

/**
 * Quote reads an org may spend per day.
 *
 * 🛑 This number is a documented guess, not a measurement.
 * `plans/money/tasks/38-purchase-order-from-a-document.md` §9 item 5 records
 * that the right value is unknown, and `LEARNED_EXTRACTION_DAILY_LIMIT = 100`
 * is the only precedent. Half of it, because the two jobs are not comparable:
 * a learned extraction reads a mail thread, while this uploads a whole PDF as
 * a multimodal part on every attempt, so one run here costs several of those.
 * The bound this guards is a runaway loop or a mis-scripted uploader, not
 * billing (credits are metered per call in the orchestrator) — and 50 vendor
 * quotes in one day is already far past the human pace the feature is for.
 * Raise it the moment a real org hits it; that log line is the signal.
 */
export const PURCHASE_INTAKE_DAILY_LIMIT = 50

const DAY_MS = 24 * 60 * 60 * 1000

export interface PurchaseIntakeJobData {
  organizationId: string
  /** The member who uploaded. The read runs as them and the draft is theirs. */
  userId: string
  /** The intake draft the router already created (a Redis key, §6.1). */
  draftId: string
}

/**
 * Enqueue the read of one uploaded quote.
 *
 * The stable `jobId` collapses a double-submit into one run: the draft row is
 * created before this is called, so the id is already unique per upload and
 * needs no timestamp.
 *
 * ⚠️ BullMQ rejects a custom `jobId` containing `':'` unless it splits into
 * exactly three segments (legacy repeatable-job compatibility), which is why
 * this is `prefix:org:draft` and not four parts.
 */
export async function enqueuePurchaseIntake(data: PurchaseIntakeJobData): Promise<void> {
  const queue = getQueue(Queues.purchaseIntakeQueue)
  await queue.add(PURCHASE_INTAKE_JOB_NAME, data, {
    jobId: `purchase-intake:${data.organizationId}:${data.draftId}`,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
  })
}

/**
 * Read a vendor's quote into a draft purchase order
 * (plans/money/tasks/38-purchase-order-from-a-document.md §3.3).
 *
 * A worker job rather than a mutation because a three-page quote is 10 to 40
 * seconds of model time, well past a comfortable tRPC round trip. Nothing here
 * writes a `purchase_order`: the whole run lands in the intake draft, and
 * `commitIntakeDraft` is the only thing that creates records (§6.1).
 *
 * The four phases are ticked onto the draft row as they start, because the
 * upload dialog renders `INTAKE_PHASES` as a checklist and marks each one done
 * — a 40-second wait has to read as progress rather than as a spinner.
 *
 * 🛑 Every failure lands as `failIntakeDraft` with a sentence a person can act
 * on BEFORE it rethrows. A draft left in `reading` is a dialog that spins
 * forever with nothing to say. The rethrow is what gets BullMQ's one retry, so
 * a draft can go `failed` and then recover to `ready` on the second attempt;
 * that flicker is the accepted cost of never stranding one.
 *
 * ⚠️ The capability refusal is the exception: a model that cannot take a file
 * part will not become one on a retry, so that exit fails the draft and
 * RETURNS. Retrying it would burn both attempts to reach the same sentence.
 *
 * Every exit funnels through `finish` so one structured line per invocation
 * lands in the log — a dead pipeline and an idle one look identical otherwise.
 */
export async function purchaseIntakeJob(ctx: JobContext<PurchaseIntakeJobData>) {
  const { organizationId, userId, draftId } = ctx.job.data
  const startedAt = Date.now()

  const finish = <T extends Record<string, unknown>>(outcome: string, result: T): T => {
    logger.info('Purchase intake finished', {
      organizationId,
      draftId,
      outcome,
      attempt: ctx.job.attemptsMade + 1,
      durationMs: Date.now() - startedAt,
    })
    return result
  }
  const skip = (reason: string) => finish(reason, { skipped: reason })

  const draft = await getIntakeDraft(organizationId, draftId)
  if (draft.isErr()) {
    // Nothing to fail: the row the message points at is gone (swept, discarded,
    // or already committed). Retrying cannot bring it back.
    logger.warn('Purchase intake draft not readable', {
      organizationId,
      draftId,
      error: draft.error.message,
    })
    return skip('draft_not_found')
  }
  // 🛑 `failed` is a re-entry state, not a terminal one. Every failure below
  // marks the draft failed BEFORE it rethrows, so refusing anything that is not
  // `reading` here would turn BullMQ's second attempt into a silent no-op and
  // `attempts: 2` into a lie. `ready` is the terminal that matters: it holds
  // edits a person has already made, and a late retry must not overwrite them.
  // `committed` is belt-and-braces — the draft lives in Redis and its key is
  // DELETED on commit, so a retry that late reads nothing and exits above.
  if (draft.value.status === 'ready' || draft.value.status === 'committed') {
    return skip(`draft_${draft.value.status}`)
  }

  const { assetRef, fileName, mimeType } = draft.value

  // Per-org daily ceiling. Counted before any model call, and a refusal is a
  // failed draft rather than a silent no-op: somebody is standing in front of
  // the dialog waiting for this one.
  const window = await checkFixedWindowLimit({
    key: `purchase-intake:${organizationId}:${new Date().toISOString().slice(0, 10)}`,
    limit: PURCHASE_INTAKE_DAILY_LIMIT,
    windowMs: DAY_MS,
  })
  if (!window.allowed) {
    logger.warn('Purchase intake daily limit reached', {
      organizationId,
      draftId,
      count: window.count,
      limit: PURCHASE_INTAKE_DAILY_LIMIT,
    })
    await fail(
      organizationId,
      draftId,
      `This organization has read ${PURCHASE_INTAKE_DAILY_LIMIT} quotes today, which is the daily limit. Try again tomorrow.`
    )
    return skip('daily_limit_reached')
  }

  // ── Phase 1: the document ────────────────────────────────────────────────
  await phase(organizationId, draftId, 'document')

  const capability = await checkIntakeModelCapability(organizationId)
  if (capability.isErr()) {
    await fail(organizationId, draftId, describe(capability.error))
    throw capability.error
  }
  if (!capability.value.ok) {
    // 🛑 Not a retry. The org's default model cannot take a file part, and a
    // second attempt reaches the same model and the same answer.
    const reason =
      capability.value.reason ??
      `${capability.value.modelId} cannot read an uploaded document. Pick a model with file input in AI settings.`
    logger.warn('Purchase intake refused by capability gate', {
      organizationId,
      draftId,
      modelId: capability.value.modelId,
      reason,
    })
    await fail(organizationId, draftId, reason)
    return skip('model_cannot_read_files')
  }

  const read = await transcribeQuote(database, organizationId, userId, {
    assetRef,
    fileName,
    mimeType,
  })
  if (read.isErr()) {
    await fail(organizationId, draftId, `We could not read this document. ${describe(read.error)}`)
    throw read.error
  }
  const transcription = read.value.quote

  // A converted document (xlsx, docx) has no renderer on the review screen, so
  // the text the model read is the only thing the preview pane can show. Kept
  // before the vendor and line phases so a failure there still leaves it.
  if (read.value.extractedText) {
    const stored = await setIntakeDraftExtractedText(
      organizationId,
      draftId,
      read.value.extractedText
    )
    if (stored.isErr()) {
      // Costs the review screen its preview, nothing else. A read that is
      // otherwise going fine should not be abandoned over it.
      logger.warn('Failed to store the converted quote text', {
        organizationId,
        draftId,
        error: stored.error.message,
      })
    }
  }

  // ── Phase 2: the vendor ──────────────────────────────────────────────────
  await phase(organizationId, draftId, 'vendor')

  const vendors = await resolveQuoteVendor(database, organizationId, transcription)
  if (vendors.isErr()) {
    await fail(
      organizationId,
      draftId,
      `We read the quote but could not look up the vendor. ${describe(vendors.error)}`
    )
    throw vendors.error
  }
  // The resolver returns its candidates best-first, so the head is the pick and
  // the rest populate the review screen's picker. A wrong vendor is visible at a
  // glance and a human confirms it before anything is written (§5.1) — but the
  // pick is not cosmetic: it scopes the tier-1 `vendor_part` lookup below, so
  // leaving it null until the review screen would disable tier 1 outright.
  const vendorRecordId = vendors.value[0]?.recordId ?? null

  // ── Phase 3: the lines ───────────────────────────────────────────────────
  await phase(organizationId, draftId, 'lines')

  const currency = transcription.currency ?? (await getOrgCurrencyCode(organizationId, database))

  const lines = await resolveQuoteLines(database, organizationId, {
    vendorRecordId,
    currency,
    lines: transcription.lines,
  })
  if (lines.isErr()) {
    await fail(
      organizationId,
      draftId,
      `We read the quote but could not match its lines to parts. ${describe(lines.error)}`
    )
    throw lines.error
  }

  // ── Phase 4: the draft ───────────────────────────────────────────────────
  await phase(organizationId, draftId, 'draft')

  const payload = buildPayload({
    transcription,
    currency,
    vendorRecordId,
    vendorCandidates: vendors.value,
    lines: lines.value,
  })

  const ready = await markIntakeDraftReady(organizationId, draftId, payload)
  if (ready.isErr()) {
    await fail(organizationId, draftId, describe(ready.error))
    throw ready.error
  }

  return finish('ready', {
    ready: true,
    lineCount: payload.lines.length,
    vendorMatched: vendorRecordId !== null,
  })
}

// ===== HELPERS =====

/**
 * Assemble the stored draft from the three steps' outputs.
 *
 * 🛑 Nothing is computed. The header amounts are the vendor's own printed
 * strings parsed once by `parseIntakeMoney`, never a sum of the lines — §3.1's
 * totals confrontation only works if both numbers survive to the review screen.
 * A quote that prints no shipping or tax seeds zero, which is the header's
 * starting point for §5.4's folds, not an assertion that the vendor charged
 * nothing.
 */
function buildPayload(input: {
  transcription: TranscribedQuote
  currency: string
  vendorRecordId: IntakeDraftPayload['vendorRecordId']
  vendorCandidates: IntakeDraftPayload['vendorCandidates']
  lines: IntakeDraftPayload['lines']
}): IntakeDraftPayload {
  const { transcription, currency } = input
  return {
    transcription,
    vendorRecordId: input.vendorRecordId,
    vendorCandidates: input.vendorCandidates,
    lines: input.lines,
    currency,
    quoteNumber: transcription.quoteNumber,
    quoteDate: transcription.quoteDate,
    // Nothing on a quote states when we want the goods. The review screen asks.
    expectedDeliveryDate: null,
    shippingCents: parseIntakeMoney(transcription.shippingText, currency) ?? 0,
    taxCents: parseIntakeMoney(transcription.taxText, currency) ?? 0,
  }
}

/**
 * Tick the draft's phase. A failed phase write is logged and swallowed: it
 * costs the dialog one checklist tick, and throwing would abandon a read that
 * is otherwise going fine.
 */
async function phase(
  organizationId: string,
  draftId: string,
  next: IntakeDraftPhase
): Promise<void> {
  const result = await setIntakeDraftPhase(organizationId, draftId, next)
  if (result.isErr()) {
    logger.warn('Failed to record intake phase', {
      organizationId,
      draftId,
      phase: next,
      error: result.error.message,
    })
  }
}

/**
 * Land the failure on the draft so the dialog has something to say.
 *
 * Swallows its own error on purpose: the caller is about to rethrow the real
 * one, and losing that to a secondary write failure would report the wrong
 * cause.
 */
async function fail(organizationId: string, draftId: string, message: string): Promise<void> {
  const result = await failIntakeDraft(organizationId, draftId, message)
  if (result.isErr()) {
    logger.error('Failed to mark intake draft failed', {
      organizationId,
      draftId,
      message,
      error: result.error.message,
    })
  }
}

/** A message safe to put in front of a person. */
function describe(error: Error): string {
  return error.message || 'Something went wrong reading this document.'
}
