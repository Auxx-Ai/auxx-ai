// apps/web/src/server/api/routers/message.ts

import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { getUserOrganizationId } from '@auxx/lib/email'
import { createScopedLogger } from '@auxx/logger'
import { MessageQueryService } from '@auxx/lib/messages'

const logger = createScopedLogger('message-router')

/**
 * Router for message query operations.
 * Provides batch-fetch APIs for the ID-first architecture.
 */
export const messageRouter = createTRPCRouter({
  /**
   * Batch fetch messages by ID.
   * Uses mutation to avoid caching issues with variable input.
   */
  getByIds: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string()).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found.',
        })
      }

      const messageQuery = new MessageQueryService(organizationId, ctx.db)

      try {
        logger.debug('Fetching messages by IDs', { count: input.ids.length })
        return await messageQuery.getMessageMetaBatch(input.ids)
      } catch (error: unknown) {
        logger.error('Failed to fetch messages by IDs', {
          organizationId,
          count: input.ids.length,
          error: error instanceof Error ? error.message : error,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch messages.',
        })
      }
    }),

  /**
   * Get message IDs for a thread.
   */
  listByThread: protectedProcedure
    .input(
      z.object({
        threadId: z.string(),
        includeDrafts: z.boolean().optional().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found.',
        })
      }

      const messageQuery = new MessageQueryService(organizationId, ctx.db)

      try {
        logger.debug('Listing message IDs for thread', {
          threadId: input.threadId,
          includeDrafts: input.includeDrafts,
        })
        return await messageQuery.listMessageIds(input.threadId, {
          includeDrafts: input.includeDrafts,
        })
      } catch (error: unknown) {
        logger.error('Failed to list message IDs for thread', {
          organizationId,
          threadId: input.threadId,
          error: error instanceof Error ? error.message : error,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list messages for thread.',
        })
      }
    }),
})
