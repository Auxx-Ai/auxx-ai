// apps/build/src/server/api/routers/logs.ts
// Logs tRPC router

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { createScopedLogger } from '@auxx/logger'
import { listAppEventLogs } from '@auxx/services/apps'

const logger = createScopedLogger('trpc-build-logs')

/**
 * Logs router
 */
export const logsRouter = createTRPCRouter({
  /**
   * Search app event logs
   */
  search: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        organizationSlug: z.string(),
        appVersionId: z.string().optional(),
        startTimestamp: z.number().optional(),
        endTimestamp: z.number().optional(),
        query: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(300).default(100),
      })
    )
    .query(async ({ input }) => {
      // Convert timestamps from milliseconds to Date objects
      const startTimestamp = input.startTimestamp ? new Date(input.startTimestamp) : undefined
      const endTimestamp = input.endTimestamp ? new Date(input.endTimestamp) : undefined

      const result = await listAppEventLogs({
        appId: input.appId,
        organizationSlug: input.organizationSlug,
        appVersionId: input.appVersionId,
        startTimestamp,
        endTimestamp,
        query: input.query,
        cursor: input.cursor,
        limit: input.limit,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to list app event logs', {
          error,
          appId: input.appId,
          organizationSlug: input.organizationSlug,
        })

        throw new TRPCError({
          code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      return result.value
    }),
})
