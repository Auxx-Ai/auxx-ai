// apps/web/src/server/api/routers/participant.ts

import { getUserOrganizationId } from '@auxx/lib/email'
import { BadRequestError, NotFoundError } from '@auxx/lib/errors'
import { ensureContactForParticipant, ParticipantService } from '@auxx/lib/participants'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

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

  /**
   * Idempotently ensure a participant has a linked contact EntityInstance.
   * Force-creates the contact if missing, refusing spammers and own-domain
   * participants. Used by the "create ticket from thread" flow when the picked
   * participant has no contact yet.
   */
  ensureContact: protectedProcedure
    .input(z.object({ participantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found.',
        })
      }
      try {
        return await ensureContactForParticipant(organizationId, input.participantId, ctx.db)
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        if (error instanceof BadRequestError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        }
        logger.error('Failed to ensure contact for participant', {
          organizationId,
          participantId: input.participantId,
          error: error instanceof Error ? error.message : error,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to ensure contact for participant.',
        })
      }
    }),
})
