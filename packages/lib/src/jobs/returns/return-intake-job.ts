// packages/lib/src/jobs/returns/return-intake-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getCachedOrgProfile } from '../../cache'
import type { TranscribedLabel } from '../../returns/intake/client'
import {
  failReturnIntakeDraft,
  markReturnIntakeDraftReady,
  recordReturnIntakeLabelCandidates,
  recordReturnIntakeLabelRead,
  setReturnIntakeDraftPhase,
} from '../../returns/intake/draft-mutations'
import { getReturnIntakeDraft } from '../../returns/intake/draft-queries'
import { looksLikeOutboundLabel, resolveLabelCandidates } from '../../returns/intake/resolve'
import { checkReturnIntakeModelCapability, transcribeLabel } from '../../returns/intake/transcribe'
import { checkFixedWindowLimit } from '../../utils/rate-limiter/fixed-window'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:return-intake')

/** The BullMQ job name. Must match the key in the worker's `jobMappings`. */
export const RETURN_INTAKE_JOB_NAME = 'returnIntakeJob'

/**
 * Label reads an org may spend per day.
 *
 * ⚠️ **The cap counts LABELS, not uploads**, and that is the whole point: one
 * drop of ten photographs is ten `LLMOrchestrator.invoke` calls (§3.1 — one call
 * per label, never one call for all of them), so a per-job ceiling would let a
 * mis-scripted uploader spend ten times what it appears to. The counter is
 * incremented once per label, immediately before that label's model call.
 *
 * 🛑 This number is a documented guess, not a measurement — inherited honestly
 * from `PURCHASE_INTAKE_DAILY_LIMIT`, whose own comment records that the right
 * value is unknown. 200 labels is ten full twenty-label pallets in one day,
 * already far past the human pace of a dock, while each call is a single phone
 * photograph rather than a whole multi-page PDF. The bound this guards is a
 * runaway loop, not billing — credits are metered per call in the orchestrator.
 * Raise it the moment a real org hits it; that log line is the signal.
 */
export const RETURN_INTAKE_DAILY_LIMIT = 200

const DAY_MS = 24 * 60 * 60 * 1000

export interface ReturnIntakeJobData {
  organizationId: string
  /** The member who uploaded. The reads run as them and the draft is theirs. */
  userId: string
  /** The intake draft the router already created (a Redis key, §6.1). */
  draftId: string
}

/**
 * Enqueue the read of one drop of photographed labels.
 *
 * The stable `jobId` collapses a double-submit into one run: the draft is
 * created before this is called, so the id is already unique per drop and needs
 * no timestamp.
 *
 * ⚠️ BullMQ rejects a custom `jobId` containing `':'` unless it splits into
 * exactly three segments (legacy repeatable-job compatibility), which is why
 * this is `prefix:org:draft` and not four parts.
 */
export async function enqueueReturnIntake(data: ReturnIntakeJobData): Promise<void> {
  const queue = getQueue(Queues.returnIntakeQueue)
  await queue.add(RETURN_INTAKE_JOB_NAME, data, {
    jobId: `returnIntake:${data.organizationId}:${data.draftId}`,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
  })
}

/**
 * Read a drop of photographed return labels into a draft
 * (plans/money/tasks/57-return-intake-wizard.md §3, §4, §6.2).
 *
 * A worker job rather than a mutation because twenty labels are twenty model
 * calls, minutes rather than a tRPC round trip. Nothing here writes a `return`:
 * the whole run lands in the intake draft, and `commitReturnIntakeDraft` is the
 * only thing that creates records (§6.1) — so a pallet that turns out to be a
 * duplicate never burns an RMA number.
 *
 * ⚠️ **Each label's transcription is written the moment its call returns**, not
 * batched at the end. 38 §11.2 found that writing per item early is what makes a
 * run that dies late still worth looking at; here it is also what drives the
 * dialog's `n of m`, which is the difference between a two-minute wait reading
 * as progress and reading as a hang.
 *
 * 🛑 **One label failing must not kill the other nine.** A crumpled label, a
 * HEIC the provider refuses, a timeout — each is recorded on its own label and
 * the loop continues. The review screen puts the photo beside empty fields and a
 * person types them in (§4.6), which is a worse outcome for one parcel and no
 * outcome at all for the rest if the run had aborted.
 *
 * ⚠️ The capability refusal is the exception: a model that cannot see will not
 * grow eyes on a retry, so that exit fails the draft and RETURNS rather than
 * rethrowing. Retrying would burn both attempts to reach the same sentence.
 */
export async function returnIntakeJob(ctx: JobContext<ReturnIntakeJobData>) {
  const { organizationId, userId, draftId } = ctx.job.data
  const startedAt = Date.now()

  const finish = <T extends Record<string, unknown>>(outcome: string, result: T): T => {
    logger.info('Return intake finished', {
      organizationId,
      draftId,
      outcome,
      attempt: ctx.job.attemptsMade + 1,
      durationMs: Date.now() - startedAt,
    })
    return result
  }
  const skip = (reason: string) => finish(reason, { skipped: reason })

  const draft = await getReturnIntakeDraft(organizationId, draftId)
  if (draft.isErr()) {
    // Nothing to fail: the key the message points at is gone (expired,
    // discarded, or already committed). Retrying cannot bring it back.
    logger.warn('Return intake draft not readable', {
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
  // confirmations a person has already made, and a late retry must not erase
  // them by re-reading every label from scratch.
  if (draft.value.status === 'ready' || draft.value.status === 'committed') {
    return skip(`draft_${draft.value.status}`)
  }

  const labels = draft.value.payload.labels
  if (labels.length === 0) {
    await fail(organizationId, draftId, 'No label photos arrived with this drop.')
    return skip('no_labels')
  }

  // ⚠️ Checked once before any model call so the refusal is a failed draft
  // rather than twenty empty transcriptions. Somebody is standing in front of
  // the dialog waiting for this.
  const capability = await checkReturnIntakeModelCapability(database, organizationId)
  if (capability.isErr()) {
    await fail(organizationId, draftId, describe(capability.error))
    throw capability.error
  }
  if (!capability.value.ok) {
    // 🛑 Not a retry. The org's default model cannot look at a photograph, and a
    // second attempt reaches the same model and the same answer.
    const reason =
      capability.value.reason ??
      `${capability.value.modelId} cannot read a photo of a label. Pick another default model.`
    logger.warn('Return intake refused by capability gate', {
      organizationId,
      draftId,
      modelId: capability.value.modelId,
      reason,
    })
    await fail(organizationId, draftId, reason)
    return skip('model_cannot_read_photos')
  }

  // ── Phase: reading (n of m) ───────────────────────────────────────────────
  await phase(organizationId, draftId, 'reading')

  /** Transcriptions in label order, `null` where the label could not be read. */
  const transcriptions = new Map<string, TranscribedLabel>()
  let rateLimited = 0

  for (const label of labels) {
    // ⚠️ Counted PER LABEL. See `RETURN_INTAKE_DAILY_LIMIT`: ten labels in one
    // drop is ten model calls, and a per-job counter would undercount by an
    // order of magnitude. A blocked label is recorded as a failed label rather
    // than abandoning the run, so the ones already read stay usable.
    const window = await checkFixedWindowLimit({
      key: `return-intake:${organizationId}:${new Date().toISOString().slice(0, 10)}`,
      limit: RETURN_INTAKE_DAILY_LIMIT,
      windowMs: DAY_MS,
    })
    if (!window.allowed) {
      rateLimited += 1
      await read(organizationId, draftId, label.id, {
        error: `This organization has read ${RETURN_INTAKE_DAILY_LIMIT} labels today, which is the daily limit. Type this one in, or try again tomorrow.`,
      })
      continue
    }

    try {
      const result = await transcribeLabel(database, organizationId, userId, label.fileRef)
      if (result.isErr()) throw result.error
      transcriptions.set(label.id, result.value)
      await read(organizationId, draftId, label.id, { transcription: result.value })
    } catch (error) {
      // 🛑 Per label, never fatal. Nine good transcriptions beside one the model
      // refused is the outcome the review screen is built for.
      logger.warn('Failed to read one return label', {
        organizationId,
        draftId,
        labelId: label.id,
        error,
      })
      await read(organizationId, draftId, label.id, {
        error: error instanceof Error ? describe(error) : 'We could not read this photo.',
      })
    }
  }

  if (rateLimited > 0) {
    logger.warn('Return intake daily limit reached', {
      organizationId,
      draftId,
      limit: RETURN_INTAKE_DAILY_LIMIT,
      rateLimited,
    })
  }

  // ── Phase: matching ───────────────────────────────────────────────────────
  await phase(organizationId, draftId, 'matching')

  // 🔑 One resolve call over every transcription rather than one per label: the
  // ladder is deterministic SQL over the same definitions each time, so batching
  // it is free and the per-label loop above already bought the early-write
  // property that mattered.
  const readable = [...transcriptions.entries()]
  if (readable.length > 0) {
    const resolved = await resolveLabelCandidates(
      database,
      organizationId,
      readable.map(([, transcription]) => transcription)
    )
    if (resolved.isErr()) {
      // 🛑 The transcriptions are already on the draft and are the expensive
      // half. Failing the draft here would throw away the model spend; the
      // review screen can still show every label with an empty picker and a
      // person can search for the customer by hand (§4.6).
      logger.error('Read the labels but could not look up customers', {
        organizationId,
        draftId,
        error: resolved.error,
      })
    } else {
      // ⚠️ Read once for the whole run, not per label: it is the same answer
      // every time, and a missing profile simply turns the check off (§4.7's
      // detector needs our own business name to have anything to compare).
      const businessName = (await getCachedOrgProfile(organizationId))?.name ?? null

      for (const [index, [labelId, transcription]] of readable.entries()) {
        const candidates = resolved.value[index] ?? []
        const recorded = await recordReturnIntakeLabelCandidates(organizationId, draftId, labelId, {
          candidates,
          // 🛑 A WARNING on the review screen, never a refusal — a worker may
          // legitimately be returning something to a vendor on our paperwork.
          looksOutbound: looksLikeOutboundLabel(transcription, businessName),
        })
        if (recorded.isErr()) {
          logger.warn('Failed to record candidates for a label', {
            organizationId,
            draftId,
            labelId,
            error: recorded.error.message,
          })
        }
      }
    }
  }

  // ── Phase: ready ──────────────────────────────────────────────────────────
  const ready = await markReturnIntakeDraftReady(organizationId, draftId)
  if (ready.isErr()) {
    await fail(organizationId, draftId, describe(ready.error))
    throw ready.error
  }

  return finish('ready', {
    ready: true,
    labelsTotal: labels.length,
    labelsRead: transcriptions.size,
    rateLimited,
  })
}

// ===== HELPERS =====

/**
 * Tick the draft's phase. A failed phase write is logged and swallowed: it costs
 * the dialog one checklist tick, and throwing would abandon a run that is
 * otherwise going fine.
 */
async function phase(
  organizationId: string,
  draftId: string,
  next: 'reading' | 'matching' | 'ready'
): Promise<void> {
  const result = await setReturnIntakeDraftPhase(organizationId, draftId, next)
  if (result.isErr()) {
    logger.warn('Failed to record return intake phase', {
      organizationId,
      draftId,
      phase: next,
      error: result.error.message,
    })
  }
}

/**
 * Land one label's outcome on the draft.
 *
 * Swallows its own error: a Redis hiccup on label three must not cost labels
 * four through twenty, and the run's real failure — if there is one — is the one
 * worth reporting.
 */
async function read(
  organizationId: string,
  draftId: string,
  labelId: string,
  outcome: Parameters<typeof recordReturnIntakeLabelRead>[3]
): Promise<void> {
  const result = await recordReturnIntakeLabelRead(organizationId, draftId, labelId, outcome)
  if (result.isErr()) {
    logger.warn('Failed to record a read label', {
      organizationId,
      draftId,
      labelId,
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
  const result = await failReturnIntakeDraft(organizationId, draftId, message)
  if (result.isErr()) {
    logger.error('Failed to mark return intake draft failed', {
      organizationId,
      draftId,
      message,
      error: result.error.message,
    })
  }
}

/** A message safe to put in front of a person. */
function describe(error: Error): string {
  return error.message || 'Something went wrong reading this photo.'
}
