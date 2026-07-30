// packages/lib/src/approval-requests/access-request-mutations.ts
//
// Writes for the THREAD access-request lane (plan 42).
//
// One guard in here IS an authorization assert, deliberately (module guide §6's
// identity/integrity carve-out): {@link applyAccessDecision} re-runs
// `assertCanManageMailSharing` for the acting approver INSIDE the winning decision
// claim. It cannot live in the router — the point is that it runs in the same
// transaction as the grant, so a Manager removed after the request was filed gets a
// 403 and writes nothing, instead of the 14-day-old `assigneeUsers` snapshot
// becoming lasting authorization (plan 42 §3/§4.2).

import { type Database, schema } from '@auxx/database'
import { ApprovalStatus, ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedUserMailVisibility } from '../cache'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { NotificationService } from '../notifications/notification-service'
import { assertCanManageMailSharing } from '../resource-access/mail-sharing-guard'
import { grantInstanceAccess } from '../resource-access/resource-access-service'
import {
  buildThreadSubjectLabel,
  findPendingThreadAccessRequest,
  findThreadDenyCooldown,
  loadThreadAuthorityContext,
  resolveThreadApprovers,
  resolveThreadFrontDoor,
  threadLensFromContext,
} from './access-request-queries'
import {
  ACCESS_REFUSAL_COPY,
  ACCESS_REQUEST_EXPIRY_DAYS,
  type AccessRequestMetadata,
} from './client'
import { guard } from './guard'
import type {
  ApprovalResolveContext,
  CreateAccessRequestResult,
  CreateThreadAccessRequestInput,
} from './types'

const logger = createScopedLogger('approval-requests')

/** `full` — thread requests have no lens picker (plan 42 §0.2). */
const THREAD_REQUESTED_LENS = 'full' as const

/**
 * File (or re-raise) a request for `full` access to one conversation.
 *
 * Shape notes that are decisions, not incidentals:
 *
 * - **Input is `{ threadId }`, never a caller-supplied `RecordId`** (plan 42 §2.3
 *   second revision). `entityDefinitionId` is PERSISTED, so a CUID-keyed RecordId
 *   would store a def id `composeUserMailVisibility` never reads. Minting
 *   `toRecordId('thread', id)` here makes the slug keyspace a type-level guarantee
 *   and avoids a third copy of `canonicalMailRecordId`.
 * - **The lens is hardcoded `full`.** That is not only a UI simplification: it
 *   removes the Enterprise refusal case entirely, because
 *   `assertMailSharingFeature` gates on a sub-`full` lens (or a new inbox Manager)
 *   and a `full`-lens thread grant trips neither. Thread requests are honourable on
 *   every plan.
 * - **`expiresAt` is always set** (14 days). Required by plan 28 H2, and swept by
 *   `cleanupExpiredApprovals` — access requests get no scheduled timeout job (H7),
 *   whose payload resumes a workflow.
 * - **Both assignee arrays are always written**, possibly empty, never NULL
 *   (plan 28 H3): NULL throws at the `canUserApprove` read site.
 * - **The insert is an atomic upsert.** The three partial unique indexes are the
 *   race arbiter; a bare `ON CONFLICT DO NOTHING` turns a losing concurrent create
 *   into an empty `returning()` rather than a leaked unique-violation, and the
 *   re-request path then updates that one row. Two simultaneous identical creates
 *   therefore yield ONE pending row and no error.
 */
export async function createThreadAccessRequest(
  db: Database,
  organizationId: string,
  userId: string,
  input: CreateThreadAccessRequestInput
): Promise<Result<CreateAccessRequestResult, Error>> {
  return guard(
    async () => {
      const ctx = await loadThreadAuthorityContext(db, organizationId, input.threadId)
      if (!ctx) throw new NotFoundError(ACCESS_REFUSAL_COPY.target_unavailable)

      const vis = await getCachedUserMailVisibility(userId, organizationId)
      const currentLens = await threadLensFromContext(db, vis, ctx)
      if (currentLens === 'full') {
        throw new BadRequestError(ACCESS_REFUSAL_COPY.already_full)
      }

      // Front-door eligibility is enforced at CREATION as well as at Accept, so a
      // direct API caller cannot file a request that can never be honoured
      // (plan 42 §5.3).
      const frontDoor = await resolveThreadFrontDoor(organizationId, userId)
      if (!frontDoor.open) {
        throw new ForbiddenError(ACCESS_REFUSAL_COPY[frontDoor.reason])
      }

      const approvers = await resolveThreadApprovers(db, organizationId, ctx)
      // Plan 28 §4.4 — an unassigned request is a black hole, and H3 means a NULL
      // array throws at read time anyway. The null-inbox path resolves org admins
      // rather than returning empty, which is what makes this assertion survivable.
      if (approvers.userIds.length === 0) {
        throw new BadRequestError(
          'This conversation has no one who can approve access to it. Ask an administrator.'
        )
      }

      const existing = await findPendingThreadAccessRequest(
        db,
        organizationId,
        userId,
        input.threadId
      )
      if (!existing) {
        const cooldown = await findThreadDenyCooldown(db, organizationId, userId, input.threadId)
        if (cooldown) throw new ForbiddenError(ACCESS_REFUSAL_COPY.deny_cooldown)
      }

      const subjectLabel = await buildThreadSubjectLabel(organizationId, ctx, currentLens)
      const expiresAt = new Date(Date.now() + ACCESS_REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

      if (!existing) {
        const [inserted] = await db
          .insert(schema.ApprovalRequest)
          .values({
            organizationId,
            kind: 'access',
            status: ApprovalStatus.pending,
            subjectLabel,
            createdById: userId,
            requesterId: userId,
            targetKind: 'instance',
            entityDefinitionId: 'thread',
            entityInstanceId: input.threadId,
            requestedLevel: ResourcePermission.view,
            requestedLens: THREAD_REQUESTED_LENS,
            message: input.message ?? null,
            assigneeUsers: approvers.userIds,
            assigneeGroups: [],
            expiresAt,
            metadata: {} satisfies AccessRequestMetadata,
          })
          // Bare `DO NOTHING`: the winner of a concurrent identical create keeps its
          // row and the loser falls through to the re-request branch below.
          .onConflictDoNothing()
          .returning({ id: schema.ApprovalRequest.id })

        if (inserted) {
          await notifyApprovers(db, {
            organizationId,
            requesterId: userId,
            approvalRequestId: inserted.id,
            approverUserIds: approvers.primaryUserIds,
            subjectLabel,
            reRequest: false,
          })
          return {
            requestId: inserted.id,
            reRequested: false,
            approverUserIds: approvers.userIds,
          }
        }
      }

      // ── RE-REQUEST (plan 28 §4.5 / plan 42 §2.2) ──
      //
      // A second ask UPDATES the existing row upward and re-notifies rather than
      // inserting. `requestedLevel`/`requestedLens` are deliberately absent from the
      // dedup identity precisely so this is an upgrade, not a second row.
      const row =
        existing ??
        (await findPendingThreadAccessRequest(db, organizationId, userId, input.threadId))
      if (!row) {
        // The conflicting row went terminal between the insert and this read. Nothing
        // sensible to update; treat it as a transient conflict.
        throw new BadRequestError('Your request could not be filed just now. Please try again.')
      }

      const metadata = (row.metadata as AccessRequestMetadata | null) ?? {}
      await db
        .update(schema.ApprovalRequest)
        .set({
          // Upward only — `view` + `full` is already the ceiling for this lane, so
          // this is a no-op today and the honest place for a future picker to widen.
          requestedLevel: ResourcePermission.view,
          requestedLens: THREAD_REQUESTED_LENS,
          message: input.message ?? row.message,
          subjectLabel,
          assigneeUsers: approvers.userIds,
          assigneeGroups: [],
          expiresAt,
          metadata: {
            ...metadata,
            remindedAt: new Date().toISOString(),
            remindCount: (metadata.remindCount ?? 0) + 1,
          } satisfies AccessRequestMetadata,
        })
        .where(eq(schema.ApprovalRequest.id, row.id))

      await notifyApprovers(db, {
        organizationId,
        requesterId: userId,
        approvalRequestId: row.id,
        approverUserIds: approvers.primaryUserIds,
        subjectLabel,
        reRequest: true,
      })

      return { requestId: row.id, reRequested: true, approverUserIds: approvers.userIds }
    },
    'Failed to create thread access request',
    { organizationId, userId, threadId: input.threadId }
  )
}

/**
 * The requester withdraws their own pending request (plan 28 §4.5).
 *
 * Scoped to `requesterId === userId`: withdrawing is "cancel MY ask", not a
 * moderation action. An approver who wants it gone denies it, which is a recorded
 * decision with a cooldown; a withdraw is neither.
 */
export async function withdrawAccessRequest(
  db: Database,
  organizationId: string,
  userId: string,
  approvalRequestId: string
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      const [claimed] = await db
        .update(schema.ApprovalRequest)
        .set({ status: 'withdrawn' })
        .where(
          and(
            eq(schema.ApprovalRequest.id, approvalRequestId),
            eq(schema.ApprovalRequest.organizationId, organizationId),
            eq(schema.ApprovalRequest.kind, 'access'),
            eq(schema.ApprovalRequest.requesterId, userId),
            eq(schema.ApprovalRequest.status, ApprovalStatus.pending)
          )
        )
        .returning({ id: schema.ApprovalRequest.id })
      if (!claimed) {
        throw new NotFoundError('No pending request of yours to withdraw')
      }
      // Drop it out of every approver's bell without waiting for a refocus.
      try {
        await new NotificationService(db).deleteNotificationsByTarget(
          'APPROVAL',
          { approvalRequestId },
          organizationId
        )
      } catch (error) {
        logger.warn('Failed to retract notifications for withdrawn access request', {
          approvalRequestId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return undefined
    },
    'Failed to withdraw access request',
    { organizationId, userId, approvalRequestId }
  )
}

/**
 * The `access` kind handler (plan 42 §4.2) — invoked inside the winning decision
 * claim by `registry.ts`.
 *
 * Order is load-bearing, and it is the same for BOTH decisions:
 *
 * 1. **Reload the target org-scoped.** A deleted or cross-org thread refuses the
 *    decision — the refusal falls out of the same load step 3 needs, so there is no
 *    separate existence probe.
 * 2. **Revalidate the ACTING APPROVER's current mail authority.** `assigneeUsers` is
 *    an audience/history snapshot, never an authorization token: a Manager removed
 *    after the request was filed may neither grant NOR block it. Throwing here rolls
 *    the claim back, so Approve writes no grant and Deny does not stick.
 *
 * Then, for `approve` only:
 *
 * 3. **Supersede if access already arrived another way.** `effectiveLens` on the
 *    requester's CURRENT visibility — NOT a fold of the proposed grant, which would
 *    be a tautology: `DERIVATION_RULES`' `thread-grant` rule is
 *    `vis.threadGrants[threadId] ?? 'none'` and `effectiveLens` folds with
 *    `maxLens`, so folding a hardcoded-`full` grant in always yields `full`, for
 *    every requester, on every thread.
 * 4. **Dispatch to `grantInstanceAccess`** — byte-identical to what the share
 *    popover writes, plus `origin: 'approval'` to suppress the generic
 *    `MESSAGE_SHARED`. NEVER a direct `ResourceAccess` write: that skips
 *    `emitResourceAccessChanged` and leaves the requester staring at a stale blob
 *    after their request was approved.
 *
 * **Raise-only comes free, from `maxLens` — not from `stripInertNoneLevels`.**
 * `effectiveLens` folds `DERIVATION_RULES` with `maxLens` and
 * `composeUserMailVisibility` raises rather than replaces, so an accepted lens grant
 * can only widen. Nobody should re-implement the `Level.None` stripping the area
 * lane needs; this ladder does not need it.
 */
export async function applyAccessDecision(
  ctx: ApprovalResolveContext
): Promise<{ message: string; afterCommit?: () => Promise<void> }> {
  const { request, approverUserId, action } = ctx
  const tx = ctx.tx as Database
  const organizationId = request.organizationId

  if (request.targetKind !== 'instance' || request.entityDefinitionId !== 'thread') {
    // The def, area and generic instance lanes are plan 28's; this handler owns the
    // thread lane only. Refusing beats writing a grant through mail-shaped logic.
    throw new BadRequestError('This access request lane is not supported yet')
  }
  const threadId = request.entityInstanceId
  const requesterId = request.requesterId
  if (!threadId || !requesterId) {
    throw new BadRequestError('Access request is missing its target or requester')
  }

  // 1. Org-scoped reload — deleted or cross-org refuses.
  const threadCtx = await loadThreadAuthorityContext(tx, organizationId, threadId)
  if (!threadCtx) throw new NotFoundError(ACCESS_REFUSAL_COPY.target_unavailable)

  // 2. CURRENT authority of the acting approver, on both decisions.
  await assertCanManageMailSharing(
    { db: tx, organizationId, userId: approverUserId },
    toRecordId('thread', threadId)
  )

  const recordId = toRecordId('thread', threadId)

  if (action === 'deny') {
    const metadata = (request.metadata as AccessRequestMetadata | null) ?? {}
    await tx
      .update(schema.ApprovalRequest)
      .set({
        metadata: {
          ...metadata,
          // The cooldown window is measured from here (plan 28 §4.5).
          deniedAt: new Date().toISOString(),
          decidedById: approverUserId,
        } satisfies AccessRequestMetadata,
      })
      .where(eq(schema.ApprovalRequest.id, request.id))

    return {
      message: 'Access request denied',
      afterCommit: (outerDb) =>
        notifyRequesterDecided(outerDb, {
          organizationId,
          requesterId,
          approverUserId,
          approvalRequestId: request.id,
          subjectLabel: request.subjectLabel,
          decision: 'denied',
        }),
    }
  }

  // 3. Front door, re-checked at Accept: a grant the requester cannot use is worse
  //    than an honest refusal, because it looks like it worked.
  const frontDoor = await resolveThreadFrontDoor(organizationId, requesterId)
  if (!frontDoor.open) {
    throw new BadRequestError(ACCESS_REFUSAL_COPY[frontDoor.reason])
  }

  // 4. Supersede when access already arrived by another route.
  const requesterVis = await getCachedUserMailVisibility(requesterId, organizationId)
  const requesterLens = await threadLensFromContext(tx, requesterVis, threadCtx)
  if (requesterLens === 'full') {
    const metadata = (request.metadata as AccessRequestMetadata | null) ?? {}
    await tx
      .update(schema.ApprovalRequest)
      .set({
        status: 'superseded',
        metadata: {
          ...metadata,
          decidedById: approverUserId,
          supersededReason: 'already_full',
        } satisfies AccessRequestMetadata,
      })
      .where(eq(schema.ApprovalRequest.id, request.id))
    return {
      message: 'They already have full access to this conversation',
      afterCommit: (outerDb) =>
        notifyRequesterDecided(outerDb, {
          organizationId,
          requesterId,
          approverUserId,
          approvalRequestId: request.id,
          subjectLabel: request.subjectLabel,
          decision: 'superseded',
        }),
    }
  }

  // `deferEmits` because this runs INSIDE the decision transaction (module guide
  // §8). The grant row must land atomically with the decision, but its cache
  // invalidation and `capabilities:changed` publish must not: firing them here
  // drops the requester's cached blob while the grant is still invisible to
  // every other connection, so a reader racing the commit repopulates from
  // PRE-grant state and the requester stares at exactly the stale blob plan 42
  // §4.2 warns about. `flushEmits` runs in `afterCommit` below.
  const { flushEmits } = await grantInstanceAccess(
    { db: tx, organizationId, userId: approverUserId },
    {
      recordId,
      granteeType: ResourceGranteeType.user,
      granteeId: requesterId,
      permission: ResourcePermission.view,
      lens: THREAD_REQUESTED_LENS,
      origin: 'approval',
      deferEmits: true,
    }
  )

  await tx
    .update(schema.ApprovalRequest)
    .set({
      grantedLevel: ResourcePermission.view,
      grantedLens: THREAD_REQUESTED_LENS,
      metadata: {
        ...((request.metadata as AccessRequestMetadata | null) ?? {}),
        decidedById: approverUserId,
      } satisfies AccessRequestMetadata,
    })
    .where(eq(schema.ApprovalRequest.id, request.id))

  return {
    message: 'Access granted',
    // Emits BEFORE the notification: the requester should not be told their
    // access arrived until the cache that decides whether they actually have it
    // has been busted.
    afterCommit: async (outerDb) => {
      await flushEmits()
      await notifyRequesterDecided(outerDb, {
        organizationId,
        requesterId,
        approverUserId,
        approvalRequestId: request.id,
        subjectLabel: request.subjectLabel,
        decision: 'approved',
      })
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS (plan 42 §8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tell the primary approvers a request is waiting.
 *
 * `targetType: 'APPROVAL'` with `{ approvalRequestId }` — the existing shape, and
 * deliberately NOT a `THREAD` target: routing an approver to the conversation
 * instead of the decision is a worse action, and half of them may not be able to
 * read it. `ThreadNotification` already owns the thread-destination case for
 * `MESSAGE_SHARED`.
 */
async function notifyApprovers(
  db: Database,
  params: {
    organizationId: string
    requesterId: string
    approvalRequestId: string
    approverUserIds: string[]
    subjectLabel: string
    reRequest: boolean
  }
): Promise<void> {
  if (params.approverUserIds.length === 0) return
  try {
    const service = new NotificationService(db)
    await Promise.all(
      params.approverUserIds
        .filter((userId) => userId !== params.requesterId)
        .map((userId) =>
          service.sendNotification({
            type: 'ACCESS_REQUESTED',
            userId,
            organizationId: params.organizationId,
            actorId: params.requesterId,
            targetType: 'APPROVAL',
            targetIds: { approvalRequestId: params.approvalRequestId },
            message: params.reRequest
              ? `Reminder: access requested for ${params.subjectLabel}`
              : `Access requested for ${params.subjectLabel}`,
            metadata: {
              kind: 'ACCESS_REQUESTED',
              subjectLabel: params.subjectLabel,
              targetKind: 'instance',
              resourceKey: 'thread',
              requestedLevel: 'view',
              requestedLens: THREAD_REQUESTED_LENS,
              reRequest: params.reRequest,
            },
          })
        )
    )
  } catch (error) {
    // Best-effort: the pending row is already the source of truth for the badge.
    logger.warn('Failed to notify access-request approvers', {
      approvalRequestId: params.approvalRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Tell the requester what happened. Also the DENIED requester's only history row. */
async function notifyRequesterDecided(
  db: Database,
  params: {
    organizationId: string
    requesterId: string
    approverUserId: string
    approvalRequestId: string
    subjectLabel: string
    decision: 'approved' | 'denied' | 'superseded'
  }
): Promise<void> {
  const copy: Record<typeof params.decision, string> = {
    approved: `Your access request for ${params.subjectLabel} was approved`,
    denied: `Your access request for ${params.subjectLabel} was declined`,
    superseded: `You already have access to ${params.subjectLabel}`,
  }
  try {
    await new NotificationService(db).sendNotification({
      type: 'ACCESS_REQUEST_DECIDED',
      userId: params.requesterId,
      organizationId: params.organizationId,
      actorId: params.approverUserId,
      targetType: 'APPROVAL',
      targetIds: { approvalRequestId: params.approvalRequestId },
      message: copy[params.decision],
      metadata: {
        kind: 'ACCESS_REQUEST_DECIDED',
        subjectLabel: params.subjectLabel,
        targetKind: 'instance',
        resourceKey: 'thread',
        decision: params.decision,
        grantedLevel: params.decision === 'approved' ? 'view' : undefined,
        grantedLens: params.decision === 'approved' ? THREAD_REQUESTED_LENS : undefined,
      },
    })
  } catch (error) {
    logger.warn('Failed to notify access-request requester', {
      approvalRequestId: params.approvalRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
