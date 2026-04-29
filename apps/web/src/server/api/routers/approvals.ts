// apps/web/src/server/api/routers/approvals.ts

import { schema } from '@auxx/database'
import {
  approveBundle,
  cancelPendingSend,
  getBundle,
  listBundles,
  rejectBundle,
  snoozeBundle,
} from '@auxx/lib/approvals'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/**
 * tRPC surface for the Today UI's AI suggestion bundles. Distinct from the
 * existing `approvalRouter` (workflow approvals) — keeping the names
 * separate avoids collision pain when one of these grows independently.
 *
 * v1 is intentionally narrow: atomic Yes/No, no per-action edit, no
 * realtime. See plans/follow-up/phases/phase-3e-today-ui.md for what was
 * deferred (Choose mode, partial-approval UI, realtime channels).
 */
export const approvalsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          filters: z
            .object({
              ownerScope: z
                .enum(['mine', 'mine_and_unassigned', 'all'])
                .default('mine_and_unassigned'),
              entityDefinitionId: z.string().optional(),
              status: z.array(z.string()).optional(),
            })
            .optional(),
          cursor: z.string().optional(),
          limit: z.number().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const ownerScope = input?.filters?.ownerScope ?? 'mine_and_unassigned'
      const ownerId =
        ownerScope === 'mine' || ownerScope === 'mine_and_unassigned'
          ? ctx.session.userId
          : undefined

      const result = await listBundles(ctx.db, {
        organizationId: ctx.session.organizationId,
        ownerId,
        filters: {
          status: input?.filters?.status ?? ['FRESH'],
          entityDefinitionId: input?.filters?.entityDefinitionId,
        },
        cursor: input?.cursor,
        limit: input?.limit,
      })
      if (!result.ok) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
      }
      return result.value
    }),

  get: protectedProcedure
    .input(z.object({ bundleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getBundle(ctx.db, {
        id: input.bundleId,
        organizationId: ctx.session.organizationId,
      })
      if (!result.ok) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      return result.value
    }),

  approve: protectedProcedure
    .input(z.object({ bundleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await approveBundle(ctx.db, {
        bundleId: input.bundleId,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
      })
      if (!result.ok) {
        const code = result.error.name === 'ConflictError' ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR'
        throw new TRPCError({ code, message: result.error.message })
      }
      return result.value
    }),

  reject: protectedProcedure
    .input(z.object({ bundleId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await rejectBundle(ctx.db, {
        bundleId: input.bundleId,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        reason: input.reason,
      })
      if (!result.ok) {
        const code = result.error.name === 'ConflictError' ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR'
        throw new TRPCError({ code, message: result.error.message })
      }
      return { ok: true as const }
    }),

  snooze: protectedProcedure
    .input(
      z.object({
        bundleId: z.string(),
        snoozeUntil: z.date(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await snoozeBundle(ctx.db, {
        bundleId: input.bundleId,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        snoozeUntil: input.snoozeUntil,
        reason: input.reason,
      })
      if (!result.ok) {
        const code = result.error.name === 'ConflictError' ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR'
        throw new TRPCError({ code, message: result.error.message })
      }
      return { ok: true as const }
    }),

  cancelPendingSend: protectedProcedure
    .input(z.object({ scheduledMessageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await cancelPendingSend(ctx.db, {
        scheduledMessageId: input.scheduledMessageId,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
      })
      if (!result.ok) {
        const code = result.error.name === 'ConflictError' ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR'
        throw new TRPCError({ code, message: result.error.message })
      }
      return { ok: true as const }
    }),

  /**
   * Pending AI-originated sends for the bottom-of-Today pill. Restricts to
   * `source = 'AI_SUGGESTED'` and `status = 'PENDING'` so we don't mix in
   * normal user-scheduled sends.
   */
  listPending: protectedProcedure
    .input(
      z
        .object({
          /** Default true: only show the current user's approved sends. */
          mineOnly: z.boolean().default(true),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(schema.ScheduledMessage.organizationId, ctx.session.organizationId),
        eq(schema.ScheduledMessage.source, 'AI_SUGGESTED'),
        inArray(schema.ScheduledMessage.status, ['PENDING']),
      ]
      if (input?.mineOnly !== false) {
        conditions.push(eq(schema.ScheduledMessage.approvedById, ctx.session.userId))
      }
      const rows = await ctx.db
        .select()
        .from(schema.ScheduledMessage)
        .where(and(...conditions))
        .orderBy(desc(schema.ScheduledMessage.scheduledAt))
        .limit(50)
      return { items: rows }
    }),
})
