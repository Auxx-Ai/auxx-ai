// apps/web/src/server/api/routers/admin-health.ts

import { getIndicatorHealth, getSystemHealth } from '@auxx/lib/health/health-service'
import { clearQueueFailedJobs, getQueueMetrics, getQueueRuns } from '@auxx/lib/health/queue-metrics'
import { z } from 'zod'
import { createTRPCRouter, superAdminProcedure } from '~/server/api/trpc'

/** Valid indicator IDs */
const indicatorIdSchema = z.enum(['database', 'redis', 'worker', 'jobs', 'app'])

/** Valid time ranges for queue metrics */
const timeRangeSchema = z.enum(['1H', '4H', '12H', '1D', '7D'])

/**
 * Admin health monitoring router — system health overview, indicator details, queue metrics.
 */
export const adminHealthRouter = createTRPCRouter({
  /** Get overview status of all services */
  getOverview: superAdminProcedure.query(async ({ ctx }) => {
    return getSystemHealth(ctx.db)
  }),

  /** Get detailed health for a single indicator */
  getIndicator: superAdminProcedure
    .input(z.object({ id: indicatorIdSchema }))
    .query(async ({ ctx, input }) => {
      return getIndicatorHealth(ctx.db, input.id)
    }),

  /** Get time-series metrics for a specific queue */
  getQueueMetrics: superAdminProcedure
    .input(
      z.object({
        queueName: z.string(),
        timeRange: timeRangeSchema.default('1H'),
      })
    )
    .query(async ({ input }) => {
      return getQueueMetrics(input.queueName, input.timeRange)
    }),

  /** Get recent job runs (completed or failed) for a queue */
  getQueueRuns: superAdminProcedure
    .input(
      z.object({
        queueName: z.string(),
        status: z.enum(['completed', 'failed']),
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      return getQueueRuns(input.queueName, input.status, input.cursor, input.limit)
    }),

  /** Clear all failed jobs for a queue */
  clearFailedJobs: superAdminProcedure
    .input(z.object({ queueName: z.string() }))
    .mutation(async ({ input }) => {
      return clearQueueFailedJobs(input.queueName)
    }),
})
