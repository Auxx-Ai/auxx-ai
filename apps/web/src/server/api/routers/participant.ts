// apps/web/src/server/api/routers/participant.ts

import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { getUserOrganizationId } from '@auxx/lib/email'
import { createScopedLogger } from '@auxx/logger'
import { ParticipantService } from '@auxx/lib/participants'

const logger = createScopedLogger('participant-router')

/**
 * Router for participant query operations.
 * Provides batch-fetch API for the ID-first architecture.
 */
export const participantRouter = createTRPCRouter({
  /**
   * Batch fetch participants by ID.
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

      const participantService = new ParticipantService(organizationId, ctx.db)

      try {
        logger.debug('Fetching participants by IDs', { count: input.ids.length })
        return await participantService.getParticipantMetaBatch(input.ids)
      } catch (error: unknown) {
        logger.error('Failed to fetch participants by IDs', {
          organizationId,
          count: input.ids.length,
          error: error instanceof Error ? error.message : error,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch participants.',
        })
      }
    }),
})
