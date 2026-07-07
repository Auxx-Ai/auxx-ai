// apps/web/src/server/api/routers/message.ts

import { getCachedUserMailVisibility } from '@auxx/lib/cache'
import { getUserOrganizationId } from '@auxx/lib/email'
import { NotFoundError } from '@auxx/lib/errors'
import { MessageQueryService } from '@auxx/lib/messages'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('message-router')

/** Resolves the org + the caller's mail-visibility context (§5.4). */
const getMessageQueryService = async (ctx: any) => {
  const organizationId = getUserOrganizationId(ctx.session)
  if (!organizationId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'User organization context not found.',
    })
  }
  const viewer = await getCachedUserMailVisibility(ctx.session.user.id as string, organizationId)
  return {
    organizationId,
    messageQuery: new MessageQueryService(organizationId, ctx.db, viewer),
  }
}

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
      const { organizationId, messageQuery } = await getMessageQueryService(ctx)

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
   * Get messages for a thread with full metadata.
   * Returns messages with participants as ParticipantId[] array.
   */
  listByThread: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, messageQuery } = await getMessageQueryService(ctx)

      try {
        logger.debug('Fetching messages for thread', { threadId: input.threadId })
        return await messageQuery.getMessagesByThread(input.threadId)
      } catch (error: unknown) {
        if (error instanceof NotFoundError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found.' })
        }
        logger.error('Failed to fetch messages for thread', {
          organizationId,
          threadId: input.threadId,
          error: error instanceof Error ? error.message : error,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch messages for thread.',
        })
      }
    }),
})
