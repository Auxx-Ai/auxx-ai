// apps/web/src/server/api/routers/usage.ts

import { getUserOrganizationId } from '@auxx/lib/email'
import type { UsageMetric } from '@auxx/lib/usage'
import { createUsageGuard } from '@auxx/lib/usage'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const VALID_METRICS: UsageMetric[] = ['outboundEmails', 'workflowRuns', 'aiCompletions', 'apiCalls']

const metricSchema = z.enum(['outboundEmails', 'workflowRuns', 'aiCompletions', 'apiCalls'])

export const usageRouter = createTRPCRouter({
  /**
   * Get usage status for a single metric.
   * Returns current usage, limits, and percentage used.
   */
  getStatus: protectedProcedure
    .input(z.object({ metric: metricSchema }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
      }

      const guard = await createUsageGuard(ctx.db)
      if (!guard) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Redis unavailable for usage tracking',
        })
      }
      return guard.check(organizationId, input.metric)
    }),

  /**
   * Get usage status for all metered metrics at once.
   */
  getAllStatus: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = getUserOrganizationId(ctx.session)
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
    }

    const guard = await createUsageGuard(ctx.db)
    if (!guard) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Redis unavailable for usage tracking',
      })
    }
    const results = await Promise.all(
      VALID_METRICS.map((metric) => guard.check(organizationId, metric))
    )

    return results
  }),
})
