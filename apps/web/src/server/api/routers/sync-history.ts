import { SyncJobModel } from '@auxx/database/models'
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

      // Use Drizzle model for scoped listing
      const model = new SyncJobModel(organizationId)
      const result = await model.listRecent()
      if (!result.ok) throw result.error

      return { data: result.value }
    }),
})
