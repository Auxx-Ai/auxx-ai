// packages/lib/src/approval-requests/approval-request-mutations.ts
//
// Writes over the `ApprovalRequest` / `ApprovalResponse` pair, for BOTH kinds.
//
// **No permission checks live here** (module guide §6). The router asserts the
// caller is in the approval audience before calling `resolveApprovalRequest`; the
// `access` kind handler then revalidates real mail authority INSIDE the winning
// claim, which is an integrity requirement of the grant it is about to write, not
// a router-replaceable one (plan 42 §3 — the assignee snapshot must never become
// an authorization token).

import { type Database, schema } from '@auxx/database'
import { ApprovalStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { and, eq, inArray, lt } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { publisher } from '../events/publisher'
import { getQueue, Queues } from '../jobs/queues'
import { NotificationService } from '../notifications/notification-service'
import { getApprovalAssigneeUserIds } from './approval-recipients'
import { guard } from './guard'
import { allowsTokenResolution, getApprovalKindHandler } from './registry'
import type { ApprovalAudience, ApprovalRequestEntity, ApprovalResponseResult } from './types'

const logger = createScopedLogger('approval-requests')

/**
 * Record one approver's decision.
 *
 * **The decision is claimed ATOMICALLY (plan 42 §4.1).** The pre-flight read below
 * is advisory only. Before this, two approvers racing both observed
 * `status = 'pending'` and then BOTH ran an unconditional `UPDATE … SET status`, so
 * an Approve/Deny race could apply the grant and finish with `status = 'denied'` —
 * the grant and the terminal status disagreeing, permanently.
 *
 * `UPDATE … WHERE id = ? AND status = 'pending' RETURNING` makes the transition
 * itself the arbiter: exactly one transaction gets a row back. Only that winner
 * writes its `ApprovalResponse` row and invokes the kind handler; the loser returns
 * "already decided" and performs NO side effect.
 *
 * A handler that throws rolls the entire decision back, claim included — which is
 * how the access lane refuses a stale approver without stranding a terminal status
 * on a request nobody was allowed to decide.
 */
export async function resolveApprovalRequest(
  db: Database,
  params: {
    approvalRequestId: string
    userId: string
    action: 'approve' | 'deny'
    comment?: string
    ipAddress?: string
    /**
     * Set by the unauthenticated email-token lane. When true the kind must have
     * opted in via `allowsTokenResolution` (plan 28 H5) — a hard reject, not a
     * "we won't send those emails" convention.
     */
    viaToken?: boolean
  }
): Promise<Result<ApprovalResponseResult, Error>> {
  const { approvalRequestId, userId, action, comment, ipAddress, viaToken } = params
  let audience: ApprovalAudience | undefined
  let organizationId: string | undefined
  let afterCommit: ((db: Database) => Promise<void>) | undefined

  const outcome = await guard(
    async () => {
      const result = await db.transaction(async (tx) => {
        const approvalRequest = await tx.query.ApprovalRequest.findFirst({
          where: eq(schema.ApprovalRequest.id, approvalRequestId),
          with: { responses: true },
        })
        if (!approvalRequest) throw new NotFoundError('Approval request not found')

        organizationId = approvalRequest.organizationId
        audience = {
          assigneeUsers: approvalRequest.assigneeUsers ?? [],
          assigneeGroups: approvalRequest.assigneeGroups ?? [],
          organizationId: approvalRequest.organizationId,
        }

        // H5 — the token lane is gated by HANDLER CAPABILITY, not by a hand-written
        // `if` a future kind can forget. Checked before anything is claimed.
        if (viaToken && !allowsTokenResolution(approvalRequest.kind)) {
          throw new ForbiddenError(
            'This request cannot be decided from an email link. Sign in to respond.'
          )
        }

        if (approvalRequest.status !== ApprovalStatus.pending) {
          return { success: false, message: `Approval already ${approvalRequest.status}` }
        }
        if (approvalRequest.expiresAt && approvalRequest.expiresAt < new Date()) {
          return { success: false, message: 'Approval request has expired' }
        }
        if ((approvalRequest.responses ?? []).some((r) => r.userId === userId)) {
          return { success: false, message: 'You have already responded to this approval' }
        }

        // ── THE CLAIM ──
        const newStatus = action === 'approve' ? ApprovalStatus.approved : ApprovalStatus.denied
        const [claimed] = await tx
          .update(schema.ApprovalRequest)
          .set({ status: newStatus })
          .where(
            and(
              eq(schema.ApprovalRequest.id, approvalRequestId),
              eq(schema.ApprovalRequest.status, ApprovalStatus.pending)
            )
          )
          .returning()
        if (!claimed) {
          // The loser. No response row, no handler, no side effect.
          return { success: false, message: 'Approval already decided' }
        }

        await tx.insert(schema.ApprovalResponse).values({
          approvalRequestId,
          userId,
          action,
          comment,
          responseMethod: viaToken ? 'email' : 'web',
          ipAddress,
        })

        await cancelTimeoutJob(approvalRequestId)

        const handler = getApprovalKindHandler(claimed.kind)
        const handled = await handler.onResolved({
          tx,
          request: claimed as ApprovalRequestEntity,
          approverUserId: userId,
          action,
          comment,
        })
        afterCommit = handled.afterCommit

        await publisher.publishLater({
          type: 'approval:responded',
          data: {
            approvalRequestId,
            workflowRunId: claimed.workflowRunId,
            action,
            userId,
            organizationId: claimed.organizationId,
          },
        })

        return {
          success: true,
          message: handled.message,
          nextPath: action === 'approve' ? 'approved' : 'denied',
        }
      })
      return result
    },
    'Failed to process approval response',
    { approvalRequestId, userId, action }
  )

  if (outcome.isOk() && outcome.value.success) {
    // AFTER the commit, never inside it (module guide §8).
    if (afterCommit) {
      try {
        // The OUTER `db`, never `tx` — the transaction is committed and its
        // handle released by now.
        await afterCommit(db)
      } catch (error) {
        logger.warn('Approval kind handler post-commit step failed', {
          approvalRequestId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    await retractApprovalNotifications(db, approvalRequestId, organizationId)
    await publishResolved(db, approvalRequestId, audience)
  }
  return outcome
}

/**
 * Resolve via an email link. Token validation only proves WHICH user the link was
 * minted for; whether that user's request kind may be decided this way is
 * {@link allowsTokenResolution}'s call, enforced inside
 * {@link resolveApprovalRequest} so the bulk and web lanes cannot diverge from it.
 */
export async function resolveApprovalByToken(
  db: Database,
  params: {
    approvalRequestId: string
    action: 'approve' | 'deny'
    token: string
    ipAddress?: string
  }
): Promise<Result<ApprovalResponseResult, Error>> {
  const tokenData = await validateApprovalToken(db, params.approvalRequestId, params.token)
  if (!tokenData.valid || !tokenData.userId) {
    return guard(
      async () => {
        throw new ForbiddenError(tokenData.message || 'Invalid approval link')
      },
      'Invalid approval token',
      { approvalRequestId: params.approvalRequestId }
    )
  }
  return resolveApprovalRequest(db, {
    approvalRequestId: params.approvalRequestId,
    userId: tokenData.userId,
    action: params.action,
    ipAddress: params.ipAddress,
    viaToken: true,
  })
}

/** Decide several requests in sequence, collecting per-id outcomes. */
export async function resolveApprovalRequests(
  db: Database,
  params: {
    userId: string
    approvalRequestIds: string[]
    action: 'approve' | 'deny'
    comment?: string
  }
): Promise<{ successful: string[]; failed: Array<{ id: string; reason: string }> }> {
  const successful: string[] = []
  const failed: Array<{ id: string; reason: string }> = []
  for (const approvalRequestId of params.approvalRequestIds) {
    const result = await resolveApprovalRequest(db, {
      approvalRequestId,
      userId: params.userId,
      action: params.action,
      comment: params.comment,
    })
    if (result.isErr()) {
      failed.push({ id: approvalRequestId, reason: result.error.message })
    } else if (result.value.success) {
      successful.push(approvalRequestId)
    } else {
      failed.push({ id: approvalRequestId, reason: result.value.message })
    }
  }
  return { successful, failed }
}

/**
 * Cancel a pending request administratively (a workflow was stopped, an org
 * operator intervened).
 *
 * Kind-aware: only a `workflow` row resumes its run. An `access` row has no run to
 * resume — it simply goes terminal.
 */
export async function cancelApprovalRequest(
  db: Database,
  params: { approvalRequestId: string; cancelledBy: string; reason?: string }
): Promise<Result<void, Error>> {
  const { approvalRequestId, cancelledBy, reason } = params
  const outcome = await guard(
    async () => {
      const approvalRequest = await db.query.ApprovalRequest.findFirst({
        where: eq(schema.ApprovalRequest.id, approvalRequestId),
      })
      if (!approvalRequest) throw new NotFoundError('Approval request not found')
      if (approvalRequest.status !== ApprovalStatus.pending) {
        throw new BadRequestError(`Cannot cancel approval in status ${approvalRequest.status}`)
      }

      if (approvalRequest.kind === 'workflow' && approvalRequest.workflowRunId) {
        const { WorkflowExecutionService } = await import('../workflows/workflow-execution-service')
        const executionService = new WorkflowExecutionService(db as never)
        await executionService.resumeWorkflow(
          approvalRequest.workflowRunId,
          approvalRequest.nodeId as string,
          {
            outcome: 'denied',
            approvalRequestId,
            cancelledBy,
            cancelledAt: new Date().toISOString(),
            cancelReason: reason,
          }
        )
      }

      await db
        .update(schema.ApprovalRequest)
        .set({
          status: ApprovalStatus.timeout,
          metadata: {
            ...((approvalRequest.metadata as Record<string, unknown>) || {}),
            cancelled: true,
            cancelledBy,
            cancelledAt: new Date().toISOString(),
            cancelReason: reason,
          },
        })
        .where(eq(schema.ApprovalRequest.id, approvalRequestId))

      await cancelTimeoutJob(approvalRequestId)
      await cancelReminderJobs(approvalRequestId)

      await publisher.publishLater({
        type: 'approval:cancelled',
        data: {
          approvalRequestId,
          workflowRunId: approvalRequest.workflowRunId,
          cancelledBy,
          organizationId: approvalRequest.organizationId,
        },
      })

      return {
        organizationId: approvalRequest.organizationId,
        audience: {
          assigneeUsers: approvalRequest.assigneeUsers ?? [],
          assigneeGroups: approvalRequest.assigneeGroups ?? [],
          organizationId: approvalRequest.organizationId,
        } satisfies ApprovalAudience,
      }
    },
    'Failed to cancel approval request',
    { approvalRequestId }
  )

  if (outcome.isOk()) {
    await retractApprovalNotifications(db, approvalRequestId, outcome.value.organizationId)
    await publishResolved(db, approvalRequestId, outcome.value.audience)
    logger.info('Approval request cancelled', { approvalRequestId, cancelledBy, reason })
    return outcome.map(() => undefined)
  }
  return outcome.map(() => undefined)
}

/**
 * Sweep pending requests past their expiry to `timeout`.
 *
 * Deliberately KIND-AGNOSTIC (plan 28 H6) — it is the expiry sweep for both, and
 * it is how access requests time out. They get NO scheduled timeout job (H7):
 * that job's payload is `{approvalRequestId, workflowRunId, nodeId}` and it resumes
 * a workflow on fire.
 *
 * Null-safe by SQL semantics: `NULL < now()` is NULL, so a null-expiry request is
 * never swept — the same reading `notExpired()` and `canUserApprove` take.
 */
export async function cleanupExpiredApprovals(db: Database): Promise<number> {
  const updated = await db
    .update(schema.ApprovalRequest)
    .set({ status: ApprovalStatus.timeout })
    .where(
      and(
        eq(schema.ApprovalRequest.status, ApprovalStatus.pending),
        lt(schema.ApprovalRequest.expiresAt, new Date())
      )
    )
    .returning({ id: schema.ApprovalRequest.id })
  if (updated.length > 0) {
    logger.info(`Cleaned up ${updated.length} expired approval requests`)
  }
  return updated.length
}

/** Sweep pending WORKFLOW requests whose run has gone terminal. */
export async function cleanupOrphanedApprovals(
  db: Database,
  organizationId?: string
): Promise<number> {
  // Terminal runs stay a subquery rather than being selected into memory first:
  // this runs on a 15-minute schedule across every org, and materialising every
  // finished run id into an IN (...) list grows without bound.
  const terminalRunIds = db
    .select({ id: schema.WorkflowRun.id })
    .from(schema.WorkflowRun)
    .where(inArray(schema.WorkflowRun.status, ['STOPPED', 'FAILED', 'SUCCEEDED']))

  const updated = await db
    .update(schema.ApprovalRequest)
    .set({
      status: ApprovalStatus.timeout,
      metadata: { reason: 'workflow_terminated', cleanedUpAt: new Date().toISOString() },
    })
    .where(
      and(
        eq(schema.ApprovalRequest.status, ApprovalStatus.pending),
        // Explicit, not implicit (plan 28 H8). `inArray(workflowRunId, …)` never
        // matches NULL, so access requests were already safe from this sweep — by
        // accident, via SQL NULL semantics. Saying so makes it a decision rather
        // than a coincidence a future COALESCE or index could void.
        eq(schema.ApprovalRequest.kind, 'workflow'),
        inArray(schema.ApprovalRequest.workflowRunId, terminalRunIds),
        ...(organizationId ? [eq(schema.ApprovalRequest.organizationId, organizationId)] : [])
      )
    )
    .returning({ id: schema.ApprovalRequest.id })
  if (updated.length > 0) {
    logger.info(
      `Cleaned up ${updated.length} orphaned approval requests for terminated workflows`,
      {
        organizationId,
      }
    )
  }
  return updated.length
}

/**
 * Sweep and retract every pending request belonging to one workflow run.
 *
 * The `UPDATE` returns the audience columns rather than a `SELECT` fetching them
 * first under the identical predicate. That removes a query and, more importantly,
 * a race: the two statements were separate, so a request decided in between was
 * still in the selected set — and got its notifications retracted and an
 * `approval:resolved` published as a timeout, having just been approved.
 * `RETURNING` can only describe rows this statement actually claimed.
 */
export async function cleanupApprovalsForWorkflowRun(
  db: Database,
  workflowRunId: string
): Promise<number> {
  const updated = await db
    .update(schema.ApprovalRequest)
    .set({
      status: ApprovalStatus.timeout,
      metadata: { reason: 'workflow_terminated', cleanedUpAt: new Date().toISOString() },
    })
    .where(
      and(
        eq(schema.ApprovalRequest.workflowRunId, workflowRunId),
        eq(schema.ApprovalRequest.status, ApprovalStatus.pending)
      )
    )
    .returning({
      id: schema.ApprovalRequest.id,
      organizationId: schema.ApprovalRequest.organizationId,
      assigneeUsers: schema.ApprovalRequest.assigneeUsers,
      assigneeGroups: schema.ApprovalRequest.assigneeGroups,
    })

  for (const approval of updated) {
    await retractApprovalNotifications(db, approval.id, approval.organizationId)
    await publishResolved(db, approval.id, {
      assigneeUsers: approval.assigneeUsers ?? [],
      assigneeGroups: approval.assigneeGroups ?? [],
      organizationId: approval.organizationId,
    })
  }

  if (updated.length > 0) {
    logger.info(`Cleaned up ${updated.length} approval requests for workflow run ${workflowRunId}`)
  }
  return updated.length
}

/** Mint an email-link token for one approver. */
export async function generateApprovalToken(
  db: Database,
  approvalRequestId: string,
  userId: string
): Promise<string> {
  const tokens = await generateApprovalTokens(db, approvalRequestId, [userId])
  return tokens[userId]!
}

/**
 * Mint email-link tokens for a whole recipient list, in ONE read + ONE write.
 *
 * The email fan-out mints a token per recipient, and the single-user form is a
 * read-modify-write of the same `metadata` JSON — so N recipients meant N reads
 * and N rewrites of a document that grows with every one of them. Minting the
 * batch merges all N entries into a single update.
 *
 * Returns `{}` when the request no longer exists, so a caller that lost a race
 * against cancellation sends no tokenized links rather than links whose stored
 * counterpart was never written (`validateApprovalToken` would reject them).
 */
export async function generateApprovalTokens(
  db: Database,
  approvalRequestId: string,
  userIds: string[]
): Promise<Record<string, string>> {
  if (userIds.length === 0) return {}
  const timestamp = Date.now()
  const minted: Record<string, string> = {}
  for (const userId of userIds) {
    minted[userId] = Buffer.from(JSON.stringify({ approvalRequestId, userId, timestamp })).toString(
      'base64'
    )
  }

  const approvalRequest = await db.query.ApprovalRequest.findFirst({
    where: eq(schema.ApprovalRequest.id, approvalRequestId),
    columns: { metadata: true },
  })
  if (!approvalRequest) return {}

  const metadata = (approvalRequest.metadata as Record<string, unknown>) || {}
  await db
    .update(schema.ApprovalRequest)
    .set({
      metadata: {
        ...metadata,
        approvalTokens: {
          ...((metadata.approvalTokens as Record<string, string>) || {}),
          ...minted,
        },
      },
    })
    .where(eq(schema.ApprovalRequest.id, approvalRequestId))
  return minted
}

/** Validate an email-link token. Does NOT decide whether the kind may use it (H5). */
export async function validateApprovalToken(
  db: Database,
  approvalRequestId: string,
  token: string
): Promise<{ valid: boolean; userId?: string; message?: string }> {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString())
    if (decoded.approvalRequestId !== approvalRequestId) {
      return { valid: false, message: 'Invalid token' }
    }
    if (Date.now() - decoded.timestamp > 24 * 60 * 60 * 1000) {
      return { valid: false, message: 'Token expired' }
    }
    const approvalRequest = await db.query.ApprovalRequest.findFirst({
      where: eq(schema.ApprovalRequest.id, approvalRequestId),
      columns: { metadata: true },
    })
    const metadata = approvalRequest?.metadata as
      | { approvalTokens?: Record<string, string> }
      | undefined
    const storedToken = metadata?.approvalTokens?.[decoded.userId]
    if (
      !storedToken ||
      storedToken.length !== token.length ||
      !crypto.timingSafeEqual(Buffer.from(storedToken, 'utf8'), Buffer.from(token, 'utf8'))
    ) {
      return { valid: false, message: 'Invalid token' }
    }
    return { valid: true, userId: decoded.userId }
  } catch (error) {
    logger.error('Token validation failed', { error })
    return { valid: false, message: 'Invalid token format' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drop a no-longer-pending approval out of every assignee's bell count without
 * waiting for a refocus. Best-effort — a failed publish only costs the other
 * assignees a stale badge until their next refetch, never the decision itself.
 *
 * Called AFTER the transaction commits (module guide §8): a mid-transaction
 * publish would fan out a state the commit has not reached.
 */
async function publishResolved(
  db: Database,
  approvalRequestId: string,
  audience: ApprovalAudience | undefined
): Promise<void> {
  if (!audience) return
  try {
    const userIds = await getApprovalAssigneeUserIds(audience)
    // Lazy import — keeps the realtime barrel out of this module's static graph
    // (`project_realtime_barrel_import_cycle`).
    const { getRealtimeService, publishApprovalResolved } = await import('../realtime')
    await publishApprovalResolved(getRealtimeService(), userIds, {
      approvalRequestId,
      organizationId: audience.organizationId,
    })
  } catch (error) {
    logger.warn('Failed to publish approval:resolved', {
      approvalRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Retract the APPROVAL-target notifications for a request that is no longer
 * pending. Deliberately NOT widened to `WORKFLOW_APPROVAL_COMPLETED`, which is
 * supposed to persist (plans/today/05-bell-and-feed-dedupe.md §8.4).
 */
async function retractApprovalNotifications(
  db: Database,
  approvalRequestId: string,
  organizationId: string | undefined
): Promise<void> {
  try {
    await new NotificationService(db).deleteNotificationsByTarget(
      'APPROVAL',
      { approvalRequestId },
      organizationId
    )
  } catch (error) {
    logger.warn('Failed to clean up approval notifications', {
      approvalRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function cancelTimeoutJob(approvalRequestId: string): Promise<void> {
  const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
  const jobId = `approval-timeout-${approvalRequestId}`
  try {
    const job = await workflowDelayQueue.getJob(jobId)
    if (job) await job.remove()
  } catch (error) {
    // Job might already be processed.
    logger.warn('Failed to cancel timeout job', { jobId, error })
  }
}

async function cancelReminderJobs(approvalRequestId: string): Promise<void> {
  const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
  // No `ApprovalReminder` table yet, so reminder jobs are cancelled by id pattern
  // (max 10 reminders).
  for (let i = 1; i <= 10; i++) {
    const jobId = `approval-reminder-${approvalRequestId}-${i}`
    try {
      const job = await workflowDelayQueue.getJob(jobId)
      if (job) await job.remove()
    } catch (error) {
      logger.debug('Failed to cancel reminder job', { jobId, error })
    }
  }
}
