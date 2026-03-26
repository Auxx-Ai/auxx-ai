// apps/web/src/server/api/routers/approval.ts

import { RedisRateLimiter } from '@auxx/lib/utils/rate-limiter'
import { ApprovalQueryService, ApprovalResponseService } from '@auxx/lib/workflow-engine'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure, publicProcedure } from '~/server/api/trpc'

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
 * tRPC router for manual confirmation approval management
 */
export const approvalRouter = createTRPCRouter({
  /**
   * Get all pending approval requests for the current user
   */
  getPendingRequests: protectedProcedure.query(async ({ ctx }) => {
    const queryService = new ApprovalQueryService(ctx.db)
    return await queryService.getPendingApprovalsForUser(
      ctx.session.user.id,
      ctx.session.user.organizationId
    )
  }),

  /**
   * Get detailed approval request with full context
   */
  getApprovalDetails: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const queryService = new ApprovalQueryService(ctx.db)
      const canApprove = await queryService.canUserApprove(ctx.session.user.id, input.id)

      if (!canApprove) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not authorized to view this approval request',
        })
      }

      return await queryService.getApprovalRequestWithContext(input.id)
    }),

  /**
   * Get count of pending approval requests for current user
   */
  getPendingCount: protectedProcedure.query(async ({ ctx }) => {
    const queryService = new ApprovalQueryService(ctx.db)
    return await queryService.getPendingCount(ctx.session.user.id, ctx.session.user.organizationId)
  }),

  /**
   * Approve a manual confirmation request
   */
  approve: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const responseService = new ApprovalResponseService(ctx.db)
      const queryService = new ApprovalQueryService(ctx.db)

      // Verify user can approve this request
      const canApprove = await queryService.canUserApprove(ctx.session.user.id, input.id)

      if (!canApprove) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not authorized to approve this request',
        })
      }

      return await responseService.processApprovalResponse(
        input.id,
        ctx.session.user.id,
        'approve',
        input.comment
      )
    }),

  /**
   * Deny a manual confirmation request
   */
  deny: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const responseService = new ApprovalResponseService(ctx.db)
      const queryService = new ApprovalQueryService(ctx.db)

      // Verify user can deny this request
      const canApprove = await queryService.canUserApprove(ctx.session.user.id, input.id)

      if (!canApprove) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not authorized to deny this request',
        })
      }

      return await responseService.processApprovalResponse(
        input.id,
        ctx.session.user.id,
        'deny',
        input.comment
      )
    }),

  /**
   * Check if current user can approve a specific request
   */
  canApprove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const queryService = new ApprovalQueryService(ctx.db)
      return await queryService.canUserApprove(ctx.session.user.id, input.id)
    }),

  /**
   * Get approval metrics for organization
   */
  getMetrics: protectedProcedure
    .input(
      z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const queryService = new ApprovalQueryService(ctx.db)
      return await queryService.getApprovalMetrics(
        ctx.session.user.organizationId,
        input.startDate,
        input.endDate
      )
    }),

  /**
   * Clean up orphaned approval requests for the organization
   * Requires admin permissions
   */
  cleanupOrphaned: protectedProcedure.mutation(async ({ ctx }) => {
    // TODO: Add admin permission check here if needed
    // if (ctx.session.user.role !== 'ADMIN') {
    //   throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' })
    // }

    const queryService = new ApprovalQueryService(ctx.db)
    const count = await queryService.cleanupOrphanedApprovals(ctx.session.user.organizationId)

    return {
      success: true,
      message: `Cleaned up ${count} orphaned approval requests`,
      count,
    }
  }),

  /**
   * Clean up orphaned approval requests for a specific workflow run
   * Requires admin permissions
   */
  cleanupForWorkflowRun: protectedProcedure
    .input(z.object({ workflowRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // TODO: Add permission check to ensure user can access this workflow run

      const queryService = new ApprovalQueryService(ctx.db)
      const count = await queryService.cleanupApprovalsForWorkflowRun(input.workflowRunId)

      return {
        success: true,
        message: `Cleaned up ${count} approval requests for workflow run`,
        count,
      }
    }),

  /**
   * Get approval details by token (no auth required)
   */
  getByToken: publicProcedure
    .input(z.object({ approvalId: z.string(), token: z.string() }))
    .query(async ({ ctx, input }) => {
      const ip = getIpFromHeaders(ctx.headers)
      const allowed = await approvalPublicRateLimiter.acquire(`approval:public:${ip}`, 1)
      if (!allowed) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests.' })
      }

      const responseService = new ApprovalResponseService(ctx.db)
      const tokenResult = await responseService.validateToken(input.approvalId, input.token)
      if (!tokenResult.valid) {
        await approvalPublicRateLimiter.acquire(`approval:public:${ip}`, 3)
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: tokenResult.message || 'Invalid token',
        })
      }

      const queryService = new ApprovalQueryService(ctx.db)
      return await queryService.getApprovalRequestWithContext(input.approvalId)
    }),

  /**
   * Approve via token (no auth required)
   */
  approveByToken: publicProcedure
    .input(z.object({ approvalId: z.string(), token: z.string(), comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const ip = getIpFromHeaders(ctx.headers)
      const allowed = await approvalPublicRateLimiter.acquire(`approval:public:${ip}`, 1)
      if (!allowed) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests.' })
      }

      const responseService = new ApprovalResponseService(ctx.db)
      const result = await responseService.processEmailApproval(
        input.approvalId,
        'approve',
        input.token,
        ip
      )

      if (!result.success) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.message })
      }

      return result
    }),

  /**
   * Deny via token (no auth required)
   */
  denyByToken: publicProcedure
    .input(z.object({ approvalId: z.string(), token: z.string(), comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const ip = getIpFromHeaders(ctx.headers)
      const allowed = await approvalPublicRateLimiter.acquire(`approval:public:${ip}`, 1)
      if (!allowed) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests.' })
      }

      const responseService = new ApprovalResponseService(ctx.db)
      const result = await responseService.processEmailApproval(
        input.approvalId,
        'deny',
        input.token,
        ip
      )

      if (!result.success) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.message })
      }

      return result
    }),
})
