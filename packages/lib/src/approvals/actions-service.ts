// packages/lib/src/approvals/actions-service.ts

import { type Database, schema } from '@auxx/database'

type DraftRow = typeof schema.Draft.$inferSelect

import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { ToolContext } from '../ai/agent-framework/tool-context'
import type { AgentToolDefinition } from '../ai/agent-framework/types'
import {
  createActorCapabilities,
  createCapabilityRegistry,
  createEntityCapabilities,
  createKnowledgeCapabilities,
  createMailCapabilities,
  createTaskCapabilities,
  type GetToolDeps,
} from '../ai/kopilot/capabilities'
import { ConflictError, NotFoundError } from '../errors'
import {
  createScheduledMessage,
  enqueueScheduledMessageJob,
  updateScheduledMessageStatus,
} from '../mail-schedule'
import { Result, type TypedResult } from '../result'
import { assertNoUnresolvedTempIds, substituteTempIds, topoSortActions } from './temp-id'
import type { ActionOutcome, ProposedAction, StoredBundle } from './types'

const logger = createScopedLogger('approvals-actions')

/** Buffer between approval and actual send — gives the user a window to cancel. */
const SEND_BUFFER_MS = 5 * 60 * 1000

/**
 * Approve a bundle: topologically sort the actions, walk in order, branching
 * on `ranDuringCapture` (promote a Draft to a ScheduledMessage) vs captured
 * (substitute temp ids in args, invoke the tool now). Records per-action
 * outcomes and updates the bundle's terminal status.
 *
 * Atomicity: each action's tool call is its own transaction (tools own their
 * own writes). The final bundle row update is one tx that records outcomes
 * + terminal status. Recovery from partial failure is "the user waits for
 * the next scanner tick"; we don't support re-approving a partial.
 */
export async function approveBundle(
  db: Database,
  args: {
    bundleId: string
    organizationId: string
    userId: string
  }
): Promise<TypedResult<{ status: BundleTerminalStatus; outcomes: ActionOutcome[] }, Error>> {
  // 1. Lock + validate.
  const bundle = await db.query.AiSuggestion.findFirst({
    where: and(
      eq(schema.AiSuggestion.id, args.bundleId),
      eq(schema.AiSuggestion.organizationId, args.organizationId)
    ),
  })
  if (!bundle) return Result.error(new NotFoundError(`Bundle ${args.bundleId} not found`))
  if (bundle.status !== 'FRESH') {
    return Result.error(new ConflictError(`Bundle status is ${bundle.status}, not FRESH`))
  }

  // 2. Stale check: did the entity move on between compute time and now?
  const entity = await db.query.EntityInstance.findFirst({
    where: eq(schema.EntityInstance.id, bundle.entityInstanceId),
  })
  if (entity?.lastActivityAt && entity.lastActivityAt > bundle.computedForActivityAt) {
    await db
      .update(schema.AiSuggestion)
      .set({ status: 'STALE', updatedAt: new Date() })
      .where(eq(schema.AiSuggestion.id, bundle.id))
    return Result.error(new ConflictError('Bundle is stale; entity activity advanced'))
  }

  const stored = bundle.bundle as StoredBundle
  const actions = stored.actions ?? []

  // 3. Topo-sort.
  let ordered: ProposedAction[]
  try {
    ordered = topoSortActions(actions)
  } catch (err) {
    return Result.error(err instanceof Error ? err : new Error(String(err)))
  }

  // 4. Build a tool context + tool registry once for the whole bundle. The
  // registry mirrors the headless runner's setup so tools see identical
  // shapes regardless of caller.
  const ctx = buildApprovalToolContext({
    db,
    organizationId: args.organizationId,
    userId: args.userId,
    traceId: bundle.id,
  })
  const tools = buildKopilotToolMap(ctx)

  // 5. Walk actions in topological order.
  const substitutions = new Map<string, string>()
  const outcomes: ActionOutcome[] = []
  const failedIndices = new Set<number>()

  for (const action of ordered) {
    // Dependency-rejection: if this action references a temp id whose
    // producer failed, skip without invoking.
    const depsFailed = actionDependsOnFailed(action, failedIndices)
    if (depsFailed) {
      outcomes.push({
        localIndex: action.localIndex,
        status: 'skipped_dep_rejected',
        error: 'parent_failed',
      })
      failedIndices.add(action.localIndex)
      continue
    }

    if (action.ranDuringCapture) {
      const out = await applySoftAction({
        db,
        ctx,
        action,
        bundle,
      })
      outcomes.push(out.outcome)
      if (out.outcome.status === 'success' && out.realId) {
        substitutions.set(`temp_${action.localIndex}`, out.realId)
      } else if (out.outcome.status !== 'success') {
        failedIndices.add(action.localIndex)
      }
      continue
    }

    // Captured (queued) action: substitute temp ids, then invoke for real.
    const tool = tools.get(action.toolName)
    if (!tool) {
      outcomes.push({
        localIndex: action.localIndex,
        status: 'failed',
        error: `Unknown tool ${action.toolName}`,
      })
      failedIndices.add(action.localIndex)
      continue
    }

    let resolvedArgs: Record<string, unknown>
    try {
      resolvedArgs = substituteTempIds(action.args, substitutions)
      assertNoUnresolvedTempIds(resolvedArgs)
    } catch (err) {
      outcomes.push({
        localIndex: action.localIndex,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
      failedIndices.add(action.localIndex)
      continue
    }

    try {
      const result = await tool.execute(resolvedArgs, ctx)
      if (result.success) {
        outcomes.push({
          localIndex: action.localIndex,
          status: 'success',
          toolOutput: (result.output as Record<string, unknown>) ?? undefined,
        })
        const realId = extractRealId(result.output)
        if (realId) substitutions.set(`temp_${action.localIndex}`, realId)
      } else {
        outcomes.push({
          localIndex: action.localIndex,
          status: 'failed',
          error: result.error ?? 'Tool returned success=false',
        })
        failedIndices.add(action.localIndex)
      }
    } catch (err) {
      logger.error('Approval tool execution threw', {
        bundleId: bundle.id,
        toolName: action.toolName,
        localIndex: action.localIndex,
        error: err instanceof Error ? err.message : String(err),
      })
      outcomes.push({
        localIndex: action.localIndex,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
      failedIndices.add(action.localIndex)
    }
  }

  // 6. Resolve terminal status.
  const successCount = outcomes.filter((o) => o.status === 'success').length
  const terminal: BundleTerminalStatus =
    successCount === outcomes.length
      ? 'APPROVED'
      : successCount === 0
        ? 'REJECTED'
        : 'PARTIALLY_APPROVED'

  await db
    .update(schema.AiSuggestion)
    .set({
      status: terminal,
      outcomes,
      decidedById: args.userId,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.AiSuggestion.id, bundle.id))

  return Result.ok({ status: terminal, outcomes })
}

/**
 * Mark a bundle REJECTED. No actions are executed and any soft-tool side
 * effects (currently: Drafts created during the headless run) remain in the
 * org's drafts tab — Open Q13 (auto-soft-delete on reject) is deferred.
 */
export async function rejectBundle(
  db: Database,
  args: { bundleId: string; organizationId: string; userId: string; reason?: string }
): Promise<TypedResult<void, Error>> {
  const bundle = await db.query.AiSuggestion.findFirst({
    where: and(
      eq(schema.AiSuggestion.id, args.bundleId),
      eq(schema.AiSuggestion.organizationId, args.organizationId)
    ),
  })
  if (!bundle) return Result.error(new NotFoundError(`Bundle ${args.bundleId} not found`))
  if (bundle.status !== 'FRESH') {
    return Result.error(new ConflictError(`Bundle status is ${bundle.status}, not FRESH`))
  }

  await db
    .update(schema.AiSuggestion)
    .set({
      status: 'REJECTED',
      decidedById: args.userId,
      decidedAt: new Date(),
      updatedAt: new Date(),
      // Stash the reason in outcomes so the bundle's audit trail has it
      // without us needing a dedicated column.
      outcomes: args.reason ? [{ rejectReason: args.reason }] : null,
    })
    .where(eq(schema.AiSuggestion.id, bundle.id))

  return Result.nil()
}

/**
 * Reject a bundle AND insert a `SuggestionDismissal` so the scanner skips
 * the entity until either activity advances OR the snooze window expires —
 * whichever is later. The activity-based predicate is what naturally
 * un-mutes a snooze that expired without new activity (correct behavior).
 */
export async function snoozeBundle(
  db: Database,
  args: {
    bundleId: string
    organizationId: string
    userId: string
    snoozeUntil: Date
    reason?: string
  }
): Promise<TypedResult<void, Error>> {
  const bundle = await db.query.AiSuggestion.findFirst({
    where: and(
      eq(schema.AiSuggestion.id, args.bundleId),
      eq(schema.AiSuggestion.organizationId, args.organizationId)
    ),
  })
  if (!bundle) return Result.error(new NotFoundError(`Bundle ${args.bundleId} not found`))
  if (bundle.status !== 'FRESH') {
    return Result.error(new ConflictError(`Bundle status is ${bundle.status}, not FRESH`))
  }

  const entity = await db.query.EntityInstance.findFirst({
    where: eq(schema.EntityInstance.id, bundle.entityInstanceId),
  })
  const dismissedAtActivity = entity?.lastActivityAt ?? new Date()

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.SuggestionDismissal)
      .values({
        organizationId: args.organizationId,
        userId: args.userId,
        entityInstanceId: bundle.entityInstanceId,
        dismissedAtActivity,
        snoozeUntil: args.snoozeUntil,
        reason: args.reason ?? null,
      })
      .onConflictDoUpdate({
        target: [
          schema.SuggestionDismissal.organizationId,
          schema.SuggestionDismissal.userId,
          schema.SuggestionDismissal.entityInstanceId,
        ],
        set: {
          dismissedAtActivity,
          snoozeUntil: args.snoozeUntil,
          reason: args.reason ?? null,
          updatedAt: new Date(),
        },
      })

    await tx
      .update(schema.AiSuggestion)
      .set({
        status: 'REJECTED',
        decidedById: args.userId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.AiSuggestion.id, bundle.id))
  })

  return Result.nil()
}

/**
 * Cancel a pending AI-originated send. Three states matter:
 * - `PENDING`     → cancel cleanly (write CANCELLED + remove BullMQ job)
 * - `PROCESSING`  → return ConflictError('send_in_flight'); UI surfaces toast
 * - `SENT|FAILED|CANCELLED` → return ConflictError('already_resolved')
 *
 * Even if BullMQ.remove fails, the existing send-job re-checks
 * `status === 'PENDING'` at fire time (mail-schedule/send-scheduled-message-job.ts),
 * so the worst case is a no-op when the timer fires.
 */
export async function cancelPendingSend(
  db: Database,
  args: { scheduledMessageId: string; userId: string; organizationId: string }
): Promise<TypedResult<void, Error>> {
  const row = await db.query.ScheduledMessage.findFirst({
    where: and(
      eq(schema.ScheduledMessage.id, args.scheduledMessageId),
      eq(schema.ScheduledMessage.organizationId, args.organizationId)
    ),
  })
  if (!row) {
    return Result.error(new NotFoundError(`ScheduledMessage ${args.scheduledMessageId} not found`))
  }
  if (row.status === 'PROCESSING') {
    return Result.error(new ConflictError('send_in_flight'))
  }
  if (row.status !== 'PENDING') {
    return Result.error(new ConflictError(`already_resolved:${row.status}`))
  }

  await db
    .update(schema.ScheduledMessage)
    .set({
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledById: args.userId,
      updatedAt: new Date(),
    })
    .where(eq(schema.ScheduledMessage.id, row.id))

  if (row.jobId) {
    try {
      const { getQueue } = await import('../jobs/queues')
      const { Queues } = await import('../jobs/queues/types')
      const queue = getQueue(Queues.messageProcessingQueue)
      await queue.remove(row.jobId)
    } catch (err) {
      // Non-fatal: the send-job re-checks status at fire time.
      logger.warn('Failed to remove BullMQ job; relying on send-job re-check', {
        scheduledMessageId: row.id,
        jobId: row.jobId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return Result.nil()
}

// ===== HELPERS =====

export type BundleTerminalStatus = 'APPROVED' | 'REJECTED' | 'PARTIALLY_APPROVED'

/**
 * Build the caller-agnostic ToolContext that approval-time tool execution
 * receives. Trivial because Phase 3b unified every tool's `execute()`
 * signature around `ToolContext`.
 */
export function buildApprovalToolContext(args: {
  db: Database
  organizationId: string
  userId: string
  traceId?: string
  signal?: AbortSignal
}): ToolContext {
  return {
    db: args.db,
    organizationId: args.organizationId,
    userId: args.userId,
    sessionId: args.traceId ?? 'approval',
    traceId: args.traceId,
    turnId: args.traceId,
    signal: args.signal,
  }
}

function buildKopilotToolMap(ctx: ToolContext): Map<string, AgentToolDefinition> {
  const getDeps: GetToolDeps = () => ({
    db: ctx.db,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    sessionId: ctx.sessionId ?? ctx.traceId ?? 'approval',
    signal: ctx.signal,
    turnId: ctx.turnId ?? ctx.traceId,
  })
  const registry = createCapabilityRegistry()
  registry.register(createEntityCapabilities(getDeps))
  registry.register(createKnowledgeCapabilities(getDeps))
  registry.register(createMailCapabilities(getDeps))
  registry.register(createActorCapabilities(getDeps))
  registry.register(createTaskCapabilities(getDeps))
  return new Map(registry.getTools('mail').map((t) => [t.name, t]))
}

function actionDependsOnFailed(action: ProposedAction, failed: Set<number>): boolean {
  if (failed.size === 0) return false
  const deps = walkForTempDeps(action.args)
  for (const d of deps) {
    if (failed.has(d)) return true
  }
  return false
}

function walkForTempDeps(value: unknown): number[] {
  const out: number[] = []
  function visit(v: unknown) {
    if (v === null || v === undefined) return
    if (Array.isArray(v)) {
      for (const x of v) visit(x)
      return
    }
    if (typeof v === 'object') {
      for (const x of Object.values(v as Record<string, unknown>)) visit(x)
      return
    }
    if (typeof v === 'string') {
      const m = /^temp_(\d+)$/.exec(v)
      if (m?.[1]) out.push(Number(m[1]))
    }
  }
  visit(value)
  return out
}

function extractRealId(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined
  const o = output as Record<string, unknown>
  for (const key of ['recordId', 'taskId', 'entityInstanceId', 'id', 'draftId']) {
    if (typeof o[key] === 'string') return o[key] as string
  }
  return undefined
}

interface SoftActionContext {
  db: Database
  ctx: ToolContext
  action: ProposedAction
  bundle: typeof schema.AiSuggestion.$inferSelect
}

/**
 * Promote a draft-mode write tool capture (`reply_to_thread` /
 * `start_new_conversation` with `mode: 'draft'`) to a real `ScheduledMessage`.
 * The Draft was already created during the headless run; we read it back,
 * extract the minimum send payload, and enqueue a delayed BullMQ job. Returns
 * the promoted ScheduledMessage id as the action's "real id" so chained
 * actions (none today, but future) can reference it.
 */
async function applySoftAction(args: SoftActionContext): Promise<{
  outcome: ActionOutcome
  realId?: string
}> {
  const { db, ctx, action, bundle } = args
  const captured = action.ranDuringCapture?.output ?? {}
  const draftId = typeof captured.draftId === 'string' ? captured.draftId : undefined
  if (!draftId) {
    return {
      outcome: {
        localIndex: action.localIndex,
        status: 'failed',
        error: 'Soft action missing draftId in ranDuringCapture.output',
      },
    }
  }

  const draft = (await db.query.Draft.findFirst({
    where: and(eq(schema.Draft.id, draftId), eq(schema.Draft.organizationId, ctx.organizationId)),
  })) as DraftRow | undefined

  if (!draft) {
    return {
      outcome: {
        localIndex: action.localIndex,
        status: 'failed',
        error: `Draft ${draftId} not found (was the draft deleted before approval?)`,
      },
    }
  }

  try {
    const sendPayload = buildSendPayloadFromDraft(draft, ctx.userId)
    const scheduledAt = new Date(Date.now() + SEND_BUFFER_MS)
    const scheduled = await createScheduledMessage(db, {
      organizationId: ctx.organizationId,
      draftId: draft.id,
      integrationId: draft.integrationId,
      threadId: draft.threadId ?? undefined,
      createdById: ctx.userId,
      scheduledAt,
      sendPayload,
      source: 'AI_SUGGESTED',
      approvedById: ctx.userId,
      aiSuggestionId: bundle.id,
    })
    const jobId = await enqueueScheduledMessageJob(
      { scheduledMessageId: scheduled.id, organizationId: ctx.organizationId },
      scheduledAt
    )
    await updateScheduledMessageStatus(db, scheduled.id, 'PENDING', { jobId })
    return {
      outcome: {
        localIndex: action.localIndex,
        status: 'success',
        toolOutput: { scheduledMessageId: scheduled.id, scheduledAt: scheduledAt.toISOString() },
      },
      realId: scheduled.id,
    }
  } catch (err) {
    logger.error('Failed to promote draft to scheduled message', {
      bundleId: bundle.id,
      draftId,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      outcome: {
        localIndex: action.localIndex,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * Translate Draft.content (jsonb produced by the draft-mode write tools) into
 * the `sendPayload` shape the message-processing worker consumes. Mirrors the
 * structure used by the user-facing thread-router schedule path.
 */
function buildSendPayloadFromDraft(draft: DraftRow, userId: string): Record<string, unknown> {
  const content = (draft.content ?? {}) as {
    bodyHtml?: string
    bodyText?: string
    recipients?: {
      to?: Array<{ identifier: string; identifierType: string; name?: string }>
      cc?: Array<{ identifier: string; identifierType: string; name?: string }>
      bcc?: Array<{ identifier: string; identifierType: string; name?: string }>
    }
    subject?: string
    attachments?: Array<{ id: string }>
  }
  return {
    userId,
    organizationId: draft.organizationId,
    integrationId: draft.integrationId,
    threadId: draft.threadId ?? undefined,
    subject: content.subject,
    textHtml: content.bodyHtml ?? '',
    textPlain: content.bodyText ?? undefined,
    to: content.recipients?.to ?? [],
    cc: content.recipients?.cc ?? [],
    bcc: content.recipients?.bcc ?? [],
    attachmentIds: content.attachments?.map((a) => a.id) ?? [],
  }
}
