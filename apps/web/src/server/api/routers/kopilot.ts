// apps/web/src/server/api/routers/kopilot.ts

import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import {
  deleteSession,
  findSessionsByType,
  getSessionById,
  updateSessionTitle,
} from '@auxx/services'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/** Throws FORBIDDEN if the org doesn't have Kopilot access. */
async function requireKopilotAccess(organizationId: string) {
  await new FeaturePermissionService().requireAccess(organizationId, FeatureKey.kopilot)
}

export const kopilotRouter = createTRPCRouter({
  /**
   * List Kopilot sessions for the current user (cursor-based pagination)
   */
  listSessions: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireKopilotAccess(ctx.session.organizationId)

      const result = await findSessionsByType({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        type: 'kopilot',
        limit: input.limit,
        cursor: input.cursor,
      })

      if (result.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
      }

      return result.value
    }),

  /**
   * Get a single Kopilot session with messages
   */
  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireKopilotAccess(ctx.session.organizationId)

      const result = await getSessionById({
        sessionId: input.sessionId,
        organizationId: ctx.session.organizationId,
      })

      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }

      return result.value
    }),

  /**
   * Delete a Kopilot session
   */
  deleteSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireKopilotAccess(ctx.session.organizationId)

      const result = await deleteSession({
        sessionId: input.sessionId,
        organizationId: ctx.session.organizationId,
      })

      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }

      return { success: true }
    }),

  /**
   * Update session title
   */
  updateTitle: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        title: z.string().min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireKopilotAccess(ctx.session.organizationId)

      const result = await updateSessionTitle({
        sessionId: input.sessionId,
        organizationId: ctx.session.organizationId,
        title: input.title,
      })

      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }

      return result.value
    }),
})
