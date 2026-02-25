import { schema } from '@auxx/database'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

export const syncHistoryRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        provider: z.enum(['google', 'shopify']).default('shopify'),
        topic: z.string().optional(),
      })
    )
    .query(async ({ ctx }) => {
      const { organizationId } = ctx.session

      const rows = await ctx.db
        .select({
          id: schema.SyncJob.id,
          type: schema.SyncJob.type,
          status: schema.SyncJob.status,
          startTime: schema.SyncJob.startTime,
          endTime: schema.SyncJob.endTime,
          processedRecords: schema.SyncJob.processedRecords,
          failedRecords: schema.SyncJob.failedRecords,
          integrationCategory: schema.SyncJob.integrationCategory,
          integrationId: schema.SyncJob.integrationId,
        })
        .from(schema.SyncJob)
        .where(eq(schema.SyncJob.organizationId, organizationId))
        .orderBy(desc(schema.SyncJob.startTime))
        .limit(50)

      return { data: rows }
    }),
})
