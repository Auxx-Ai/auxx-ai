// packages/lib/src/jobs/approvals/learned-extraction-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { createCallModel } from '../../ai/agent-framework/llm-adapter'
import { ModelType } from '../../ai/providers/types'
import { createBundleFromHeadlessRun } from '../../approvals/bundle-service'
import { runLearnedExtraction } from '../../approvals/learned-extraction-runner'
import { getCachedDefaultModel } from '../../cache/org-cache-helpers'
import { FeaturePermissionService } from '../../permissions/feature-permission-service'
import { FeatureKey } from '../../permissions/types'
import { checkFixedWindowLimit } from '../../utils/rate-limiter/fixed-window'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'
import type { JobContext } from '../types'
import { hasHumanOutbound, learnedExtractionSkipReason } from './learned-extraction-gates'
import { resolveLearnedRunPrincipal } from './learned-run-principal'

const logger = createScopedLogger('job:learned-extraction')

/**
 * Extraction runs an org may spend per day. A guardrail against an inbox that
 * archives hundreds of threads a day, not a billing control (credits are
 * metered per call in `llm-adapter.ts`). Forced runs count toward the window
 * but are never blocked by it — a human asking is worth a slot.
 */
export const LEARNED_EXTRACTION_DAILY_LIMIT = 100

const DAY_MS = 24 * 60 * 60 * 1000
/** Outbound messages sampled for the authorship gate. */
const OUTBOUND_SAMPLE = 20

export interface LearnedExtractionJobData {
  organizationId: string
  threadId: string
  /**
   * Human-triggered ("Remember this thread"): skips the noise gates and the
   * `learnedExtractedAt` dedupe — an explicit ask always runs.
   */
  force?: boolean
  /**
   * The member who asked. Forced runs carry it so the run binds to THEIR
   * capabilities and the proposal lands in THEIR Today feed, instead of being
   * re-derived from a thread they may not be assigned to.
   */
  requestedByUserId?: string
}

/**
 * Enqueue a learned-KB extraction for a thread that just resolved. The stable
 * jobId collapses a rapid archive→reopen→archive burst into one pending job;
 * once a run completes, the `learnedExtractedAt` gate (not the jobId) is what
 * prevents pointless re-extraction. Forced runs get a unique jobId (a stale
 * completed job under the stable id would otherwise swallow the re-enqueue)
 * and no delay.
 */
export async function enqueueLearnedExtraction(data: LearnedExtractionJobData): Promise<void> {
  const queue = getQueue(Queues.learnedExtractionQueue)
  // BullMQ rejects a custom jobId containing ':' unless it splits into exactly
  // 3 segments (legacy repeatable-job compat) — keep the forced variant to 3.
  const jobId = data.force
    ? `learned-extraction:${data.organizationId}:${data.threadId}-force-${Date.now()}`
    : `learned-extraction:${data.organizationId}:${data.threadId}`
  await queue.add('learnedExtractionJob', data, {
    jobId,
    delay: data.force ? 0 : 5_000,
    attempts: 2,
    backoff: { type: 'exponential', delay: 60_000 },
  })
}

/**
 * Learned-KB extraction — runs once per thread resolve (enqueued by
 * `ThreadMutationService`) or on demand from "Remember this thread". Cheap
 * row-local gates run before any LLM call; most threads are skipped. A
 * surviving thread gets one capture-mode kopilot run whose proposed
 * `upsert_learned_article` calls land as a `triggerSource: 'learned-extraction'`
 * AiSuggestion bundle in Today.
 *
 * `Thread.learnedExtractedAt` is stamped ONLY after the model actually looked
 * at the thread — including a `[noop]` verdict, since a thread that taught
 * nothing shouldn't be re-read. Every pre-LLM exit (no principal, no anchor,
 * daily cap) leaves the stamp alone: those are conditions that change, and a
 * stamp would exclude the thread forever. A failed run doesn't stamp either, so
 * BullMQ's retry gets a clean slate.
 *
 * Every exit funnels through `finish` so one structured line per invocation
 * lands in the log — a dead pipeline and an idle one look identical otherwise.
 */
export async function learnedExtractionJob(ctx: JobContext<LearnedExtractionJobData>) {
  const { organizationId, threadId, force, requestedByUserId } = ctx.job.data
  const startedAt = Date.now()

  const finish = <T extends Record<string, unknown>>(outcome: string, result: T): T => {
    logger.info('Learned extraction finished', {
      organizationId,
      threadId,
      force: force ?? false,
      outcome,
      durationMs: Date.now() - startedAt,
    })
    return result
  }
  const skip = (reason: string) => finish(reason, { skipped: reason })

  const features = new FeaturePermissionService()
  const enabled = await features.hasAccess(organizationId, FeatureKey.learnedMemory)
  if (!enabled) return skip('feature_disabled')

  const thread = await database.query.Thread.findFirst({
    where: and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)),
  })
  if (!thread) return skip('thread_not_found')

  // Noise gates — all row-local; no LLM call unless they pass. A forced run
  // (explicit "remember this thread") bypasses them: the human is the gate.
  if (!force) {
    const skipReason = learnedExtractionSkipReason(thread)
    if (skipReason) return skip(skipReason)

    // A thread nobody answered teaches nothing about how we answer — and one
    // only an AI answered would teach us our own words back.
    const outbound = await database
      .select({ authorUserType: schema.User.userType })
      .from(schema.Message)
      .leftJoin(schema.User, eq(schema.User.id, schema.Message.createdById))
      .where(
        and(
          eq(schema.Message.threadId, threadId),
          eq(schema.Message.organizationId, organizationId),
          eq(schema.Message.isInbound, false)
        )
      )
      .limit(OUTBOUND_SAMPLE)
    if (outbound.length === 0) return skip('no_outbound_reply')
    if (!hasHumanOutbound(outbound)) return skip('ai_only')
  }

  // Per-org daily ceiling. Forced runs consume a slot but are never refused.
  const window = await checkFixedWindowLimit({
    key: `learned-extraction:${organizationId}:${new Date().toISOString().slice(0, 10)}`,
    limit: LEARNED_EXTRACTION_DAILY_LIMIT,
    windowMs: DAY_MS,
  })
  if (!window.allowed && !force) {
    logger.warn('Learned extraction daily limit reached', {
      organizationId,
      threadId,
      count: window.count,
      limit: LEARNED_EXTRACTION_DAILY_LIMIT,
    })
    return skip('daily_limit_reached')
  }

  const modelDefault = await getCachedDefaultModel(organizationId, ModelType.LLM)
  if (!modelDefault) return skip('no_default_model')
  const modelId = `${modelDefault.provider}:${modelDefault.model}`

  // Capture runs bind to a human member and refuse to run for anyone else, so
  // the principal decides whether this thread can be learned from at all.
  const principal = await resolveLearnedRunPrincipal({
    db: database,
    organizationId,
    threadId,
    assigneeId: thread.assigneeId,
    requestedByUserId,
  })
  if (!principal) {
    logger.warn('Learned extraction has no human principal', { organizationId, threadId })
    return skip('no_human_principal')
  }

  const anchor = await resolveAnchor(thread, organizationId)
  if (!anchor) return skip('no_anchor_record')

  const callModel = createCallModel({
    organizationId,
    userId: principal.runAsUserId,
    source: 'learned_extraction',
    sourceId: threadId,
  })

  const result = await runLearnedExtraction(
    { db: database, callModel },
    {
      organizationId,
      ownerUserId: principal.runAsUserId,
      threadId,
      anchor,
      modelId,
    }
  )
  if (!result.ok) {
    logger.warn('Learned extraction run failed', {
      organizationId,
      threadId,
      error: result.error.message,
    })
    throw result.error // no stamp — let BullMQ retry once
  }

  await stampExtractedAt(threadId)

  if (result.value.actions.length === 0) {
    await notifyForcedNoop({ organizationId, threadId, requestedByUserId, force })
    return finish('noop', { extracted: false, noopReason: result.value.noopReason })
  }

  const insert = await createBundleFromHeadlessRun(database, {
    result: result.value,
    organizationId,
    ownerUserId: principal.ownerUserId,
    entityInstanceId: anchor.entityInstanceId,
    entityDefinitionId: anchor.entityDefinitionId,
    threadId,
    triggerSource: 'learned-extraction',
  })
  if (!insert.ok) {
    // ConflictError = a FRESH learned bundle already exists for this thread.
    logger.warn('Learned bundle insert failed', {
      organizationId,
      threadId,
      error: insert.error.message,
    })
    return finish('bundle_conflict', { extracted: true, inserted: false })
  }

  logger.info('Learned extraction bundle created', {
    organizationId,
    threadId,
    bundleId: insert.value?.id,
    actionCount: result.value.actions.length,
  })
  return finish('bundle_created', { extracted: true, inserted: insert.value !== undefined })
}

// ===== HELPERS =====

/**
 * Tell the requester when their explicit "Remember this thread" found nothing.
 * A forced run feels like a foreground action but resolves in the background;
 * without this it is indistinguishable from a broken pipeline — which is
 * exactly how the dead-principal bug stayed invisible.
 */
async function notifyForcedNoop(params: {
  organizationId: string
  threadId: string
  requestedByUserId?: string
  force?: boolean
}): Promise<void> {
  const { organizationId, threadId, requestedByUserId, force } = params
  if (!force || !requestedByUserId) return
  try {
    // Lazy: the notification service pulls the realtime barrel, which breaks
    // module mocking for anything that imports this job statically.
    const { NotificationService } = await import('../../notifications')
    await new NotificationService(database).sendNotification({
      type: 'SYSTEM_MESSAGE',
      userId: requestedByUserId,
      organizationId,
      targetType: 'THREAD',
      targetIds: { threadId },
      message: 'Nothing new to remember from this conversation.',
    })
  } catch (error) {
    logger.warn('Failed to notify forced-extraction noop', {
      organizationId,
      threadId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Pick the record the bundle anchors to: the thread's primary entity when
 * linked, else the contact record of the first matched inbound sender.
 */
async function resolveAnchor(
  thread: typeof schema.Thread.$inferSelect,
  organizationId: string
): Promise<{ entityInstanceId: string; entityDefinitionId: string } | undefined> {
  if (thread.primaryEntityInstanceId && thread.primaryEntityDefinitionId) {
    return {
      entityInstanceId: thread.primaryEntityInstanceId,
      entityDefinitionId: thread.primaryEntityDefinitionId,
    }
  }

  const sender = await database
    .select({ entityInstanceId: schema.Participant.entityInstanceId })
    .from(schema.Message)
    .innerJoin(schema.Participant, eq(schema.Participant.id, schema.Message.fromId))
    .where(
      and(
        eq(schema.Message.threadId, thread.id),
        eq(schema.Message.organizationId, organizationId),
        eq(schema.Message.isInbound, true)
      )
    )
    .limit(5)
  const contactId = sender.find((s) => s.entityInstanceId)?.entityInstanceId
  if (!contactId) return undefined

  const instance = await database.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.id, contactId),
      eq(schema.EntityInstance.organizationId, organizationId)
    ),
    columns: { id: true, entityDefinitionId: true, archivedAt: true },
  })
  if (!instance || instance.archivedAt) return undefined
  return { entityInstanceId: instance.id, entityDefinitionId: instance.entityDefinitionId }
}

async function stampExtractedAt(threadId: string): Promise<void> {
  await database
    .update(schema.Thread)
    .set({ learnedExtractedAt: new Date() })
    .where(eq(schema.Thread.id, threadId))
}
