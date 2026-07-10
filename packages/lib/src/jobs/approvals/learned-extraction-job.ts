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
import { getQueue } from '../queues'
import { Queues } from '../queues/types'
import type { JobContext } from '../types'
import { learnedExtractionSkipReason } from './learned-extraction-gates'

const logger = createScopedLogger('job:learned-extraction')

export interface LearnedExtractionJobData {
  organizationId: string
  threadId: string
  /**
   * Human-triggered ("Remember this thread"): skips the noise gates and the
   * `learnedExtractedAt` dedupe — an explicit ask always runs.
   */
  force?: boolean
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
 * `ThreadMutationService` on transition to ARCHIVED). Cheap noise gates run
 * before any LLM call; most threads are skipped. A surviving thread gets one
 * capture-mode kopilot run whose proposed `upsert_learned_article` calls land
 * as a `triggerSource: 'learned-extraction'` AiSuggestion bundle in Today.
 *
 * `Thread.learnedExtractedAt` is stamped after every successful run —
 * including [noop] — so a reopen→re-close with no new messages is skipped,
 * while a thread that accrues new conversation becomes eligible again. A
 * failed run does NOT stamp, so BullMQ's retry gets a clean slate.
 */
export async function learnedExtractionJob(ctx: JobContext<LearnedExtractionJobData>) {
  const { organizationId, threadId, force } = ctx.job.data

  const features = new FeaturePermissionService()
  const enabled = await features.hasAccess(organizationId, FeatureKey.learnedMemory)
  if (!enabled) return { skipped: 'feature_disabled' }

  const thread = await database.query.Thread.findFirst({
    where: and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)),
  })
  if (!thread) return { skipped: 'thread_not_found' }

  // Noise gates — all row-local; no LLM call unless they pass. A forced run
  // (explicit "remember this thread") bypasses them: the human is the gate.
  if (!force) {
    const skipReason = learnedExtractionSkipReason(thread)
    if (skipReason) return { skipped: skipReason }

    // Require at least one outbound reply — a thread nobody answered teaches
    // nothing about how we answer. (Human vs AI authorship isn't recorded on
    // Message rows, so outbound presence is the v1 proxy.)
    const outbound = await database.query.Message.findFirst({
      where: and(
        eq(schema.Message.threadId, threadId),
        eq(schema.Message.organizationId, organizationId),
        eq(schema.Message.isInbound, false)
      ),
      columns: { id: true },
    })
    if (!outbound) return { skipped: 'no_outbound_reply' }
  }

  const modelDefault = await getCachedDefaultModel(organizationId, ModelType.LLM)
  if (!modelDefault) return { skipped: 'no_default_model' }
  const modelId = `${modelDefault.provider}:${modelDefault.model}`

  const org = await database.query.Organization.findFirst({
    where: eq(schema.Organization.id, organizationId),
    columns: { systemUserId: true, createdById: true },
  })
  // Bundle owner must be a HUMAN — threads are often assigned to AI agent
  // pseudo-users (userType 'AGENT'), and Today only lists a member's own +
  // unassigned bundles. Non-human assignee → unassigned (visible to all).
  const humanAssigneeId = await resolveHumanUserId(thread.assigneeId)
  const ownerUserId = humanAssigneeId ?? null
  // The engine/LLM attribution user just needs to exist; system user is fine.
  const runAsUserId = humanAssigneeId ?? org?.systemUserId ?? org?.createdById
  if (!runAsUserId) return { skipped: 'no_owner' }

  const anchor = await resolveAnchor(thread, organizationId)
  if (!anchor) {
    // No linked record to hang the bundle on — stamp so we don't re-evaluate
    // this thread every reopen, and move on.
    await stampExtractedAt(threadId)
    return { skipped: 'no_anchor_record' }
  }

  const callModel = createCallModel({
    organizationId,
    userId: runAsUserId,
    source: 'kopilot',
    sourceId: 'headless-learned-extraction',
  })

  const result = await runLearnedExtraction(
    { db: database, callModel },
    { organizationId, ownerUserId: runAsUserId, threadId, anchor, modelId }
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
    logger.info('Learned extraction noop', {
      organizationId,
      threadId,
      noopReason: result.value.noopReason,
    })
    return { extracted: false, noopReason: result.value.noopReason }
  }

  const insert = await createBundleFromHeadlessRun(database, {
    result: result.value,
    organizationId,
    ownerUserId,
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
    return { extracted: true, inserted: false }
  }

  logger.info('Learned extraction bundle created', {
    organizationId,
    threadId,
    bundleId: insert.value?.id,
    actionCount: result.value.actions.length,
  })
  return { extracted: true, inserted: insert.value !== undefined }
}

// ===== HELPERS =====

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

/** Resolve a user id to itself only when it belongs to a real human (userType 'USER'). */
async function resolveHumanUserId(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const user = await database.query.User.findFirst({
    where: eq(schema.User.id, userId),
    columns: { userType: true },
  })
  return user?.userType === 'USER' ? userId : null
}

async function stampExtractedAt(threadId: string): Promise<void> {
  await database
    .update(schema.Thread)
    .set({ learnedExtractedAt: new Date() })
    .where(eq(schema.Thread.id, threadId))
}
