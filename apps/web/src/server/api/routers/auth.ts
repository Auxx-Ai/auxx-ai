// src/server/api/routers/auth.trpc.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { createScopedLogger } from '@auxx/logger'
import { DehydrationService } from '@auxx/lib/dehydration'
import { auth } from '~/auth/server'

const logger = createScopedLogger('api-auth')

export const authRouter = createTRPCRouter({
  addPassword: protectedProcedure
    .input(
      z.object({
        newPassword: z.string().min(8, { error: 'Password must be at least 8 characters' }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // console.log(ctx.headers)
      const _result = await auth.api.setPassword({
        body: { newPassword: input.newPassword },
        headers: ctx.headers,
      })

      // Invalidate dehydrated cache to update hasPassword flag
      const dehydrationService = new DehydrationService(ctx.db)
      await dehydrationService.invalidateUser(ctx.session.userId)

      return { success: true }
      // return result
    }),
})
