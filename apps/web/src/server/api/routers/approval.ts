// apps/web/src/server/api/routers/approval.ts

import {
  canUserApprove,
  canUserViewApproval,
  cleanupApprovalsForWorkflowRun,
  createThreadAccessRequest,
  getApprovalMetrics,
  getApprovalRequestWithContext,
  getPendingApprovalsForUser,
  getPendingCount,
  preflightThreadAccessRequest,
  resolveApprovalByToken,
  resolveApprovalRequest,
  validateApprovalToken,
  withdrawAccessRequest,
} from '@auxx/lib/approval-requests'
import { RedisRateLimiter } from '@auxx/lib/utils/rate-limiter'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  createTRPCRouter,
  isAuxxError,
  protectedProcedure,
  publicProcedure,
} from '~/server/api/trpc'

const approvalPublicRateLimiter = new RedisRateLimiter({
  name: 'approval-public',
  maxTokens: 10,
  refillRate: 10,
  perInterval: 60_000,
})

function getIpFromHeaders(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown'
  )
}

/**
 * tRPC router for the approval spine — BOTH kinds.
 *
 * The router is where authorization lives (module guide §6): every mutation below
 * asserts before it calls into `@auxx/lib/approval-requests`. Two seams are worth
 * naming because they look like exceptions and are not:
 *
 * - `canUserApprove` is the approval AUDIENCE check. For an `access` row it is not
 *   sufficient authorization to write a grant, so the access kind handler
 *   revalidates the acting approver's real mail authority inside the winning
 *   decision claim (plan 42 §3). Both run.
 * - `requestAccess` does not assert a permission key: the whole point is that the
 *   caller LACKS access. The eligibility rules (front door, current lens, deny
 *   cooldown, org-scoped target) are server-side inside the lib call, which is
 *   where a direct API caller meets them too.
 */
export const approvalRouter = createTRPCRouter({
  /** Every pending approval waiting on the caller — both kinds (plan 28 H1). */
  getPendingRequests: protectedProcedure.query(async ({ ctx }) => {
    return await getPendingApprovalsForUser(ctx.db, ctx.session.organizationId, ctx.session.userId)
  }),

  /** One request with full context. */
  getApprovalDetails: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // View, not approve: an approver may read a request they already decided or
      // one that expired. Gating reads on `canUserApprove` 403s the moment the
      // request goes terminal, which is exactly when you want to look at it.
      const canView = await canUserViewApproval(ctx.db, ctx.session.userId, input.id)
      if (!canView) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not authorized to view this approval request',
        })
      }
      return await getApprovalRequestWithContext(ctx.db, input.id)
    }),

  /** Badge count. Same predicate as the list, deliberately (plan 42 §11 item 8). */
  getPendingCount: protectedProcedure.query(async ({ ctx }) => {
    return await getPendingCount(ctx.db, ctx.session.organizationId, ctx.session.userId)
  }),

  approve: protectedProcedure
    .input(z.object({ id: z.string(), comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await canUserApprove(ctx.db, ctx.session.userId, input.id))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not authorized to approve this request',
        })
      }
      const result = await resolveApprovalRequest(ctx.db, {
        approvalRequestId: input.id,
        userId: ctx.session.userId,
        action: 'approve',
        comment: input.comment,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  deny: protectedProcedure
    .input(z.object({ id: z.string(), comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await canUserApprove(ctx.db, ctx.session.userId, input.id))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not authorized to deny this request',
        })
      }
      const result = await resolveApprovalRequest(ctx.db, {
        approvalRequestId: input.id,
        userId: ctx.session.userId,
        action: 'deny',
        comment: input.comment,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  canApprove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return await canUserApprove(ctx.db, ctx.session.userId, input.id)
    }),

  getMetrics: protectedProcedure
    .input(z.object({ startDate: z.date().optional(), endDate: z.date().optional() }))
    .query(async ({ ctx, input }) => {
      return await getApprovalMetrics(ctx.db, ctx.session.organizationId, {
        startDate: input.startDate,
        endDate: input.endDate,
      })
    }),

  cleanupForWorkflowRun: protectedProcedure
    .input(z.object({ workflowRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // TODO: Add permission check to ensure user can access this workflow run
      const count = await cleanupApprovalsForWorkflowRun(ctx.db, input.workflowRunId)
      return {
        success: true,
        message: `Cleaned up ${count} approval requests for workflow run`,
        count,
      }
    }),

  // ───────────────────────────────────────────────────────────────────────────
  // ACCESS LANE — thread requests (plan 42)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Server-authoritative eligibility + approver display for the request trigger
   * (plan 42 §6.2). The client's `myLens !== 'full' && !canShare` check is
   * presentation only; this is the answer that decides whether Send does anything.
   *
   * Approver display names come from the org member CACHE, never a `User` join.
   */
  accessRequestPreflight: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await preflightThreadAccessRequest(
        ctx.db,
        ctx.session.organizationId,
        ctx.session.userId,
        input.threadId
      )
    }),

  /**
   * Ask for `full` access to one conversation.
   *
   * Input is `{ threadId }`, not a `RecordId` (plan 42 §2.3): the persisted
   * `entityDefinitionId` is then the literal `thread` slug by construction, so a
   * CUID-keyed mail key has no way in.
   */
  requestAccess: protectedProcedure
    .input(z.object({ threadId: z.string(), message: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await createThreadAccessRequest(
          ctx.db,
          ctx.session.organizationId,
          ctx.session.userId,
          { threadId: input.threadId, message: input.message }
        )
        if (result.isErr()) throw result.error
        return result.value
      } catch (error) {
        // `isAuxxError`, never `error instanceof TRPCError`: the latter misses an
        // AuxxError and flattens a 403/404 into a generic 500.
        if (isAuxxError(error)) throw error
        throw error
      }
    }),

  /** The requester withdraws their own pending request. */
  withdrawAccessRequest: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await withdrawAccessRequest(
        ctx.db,
        ctx.session.organizationId,
        ctx.session.userId,
        input.id
      )
      if (result.isErr()) throw result.error
      return { success: true }
    }),

  // ───────────────────────────────────────────────────────────────────────────
  // UNAUTHENTICATED EMAIL-LINK LANE
  //
  // `kind: 'access'` is rejected inside `resolveApprovalRequest` by the handler's
  // `allowsTokenResolution: false` (plan 28 H5) — a property of the kind, not an
  // `if` in this file that a future kind could forget.
  // ───────────────────────────────────────────────────────────────────────────

  getByToken: publicProcedure
    .input(z.object({ approvalId: z.string(), token: z.string() }))
    .query(async ({ ctx, input }) => {
      const ip = getIpFromHeaders(ctx.headers)
      if (!(await approvalPublicRateLimiter.acquire(`approval:public:${ip}`, 1))) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests.' })
      }
      const tokenResult = await validateApprovalToken(ctx.db, input.approvalId, input.token)
      if (!tokenResult.valid) {
        await approvalPublicRateLimiter.acquire(`approval:public:${ip}`, 3)
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: tokenResult.message || 'Invalid token',
        })
      }
      return await getApprovalRequestWithContext(ctx.db, input.approvalId)
    }),

  approveByToken: publicProcedure
    .input(z.object({ approvalId: z.string(), token: z.string(), comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const ip = getIpFromHeaders(ctx.headers)
      if (!(await approvalPublicRateLimiter.acquire(`approval:public:${ip}`, 1))) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests.' })
      }
      const result = await resolveApprovalByToken(ctx.db, {
        approvalRequestId: input.approvalId,
        action: 'approve',
        token: input.token,
        ipAddress: ip,
      })
      if (result.isErr()) throw result.error
      if (!result.value.success) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.value.message })
      }
      return result.value
    }),

  denyByToken: publicProcedure
    .input(z.object({ approvalId: z.string(), token: z.string(), comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const ip = getIpFromHeaders(ctx.headers)
      if (!(await approvalPublicRateLimiter.acquire(`approval:public:${ip}`, 1))) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests.' })
      }
      const result = await resolveApprovalByToken(ctx.db, {
        approvalRequestId: input.approvalId,
        action: 'deny',
        token: input.token,
        ipAddress: ip,
      })
      if (result.isErr()) throw result.error
      if (!result.value.success) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.value.message })
      }
      return result.value
    }),
})
