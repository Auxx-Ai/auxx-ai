// apps/web/src/server/api/routers/extension.ts

import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api-extension')

/**
 * Endpoints for the Auxx Chrome extension.
 *
 * Currently only provides a parser-health ping that fires once per
 * content-script load. We aggregate the data downstream (PostHog) so
 * we get an alert when DOM selectors break across many users at once.
 */
export const extensionRouter = createTRPCRouter({
  parserHealth: protectedProcedure
    .input(
      z.object({
        host: z.string().max(255),
        url: z.string().max(2048),
        parsed: z.boolean(),
        extensionVersion: z.string().max(32),
      })
    )
    .mutation(async ({ ctx, input }) => {
      logger.info('extension parser health', {
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
        host: input.host,
        parsed: input.parsed,
        extensionVersion: input.extensionVersion,
      })
      return { ok: true as const }
    }),
})
