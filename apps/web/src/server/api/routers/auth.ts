// src/server/api/routers/auth.trpc.ts

import { schema } from '@auxx/database'
import { DehydrationService } from '@auxx/lib/dehydration'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api-auth')

export const authRouter = createTRPCRouter({
  addPassword: protectedProcedure
    .input(
      z.object({
        newPassword: z.string().min(8, { error: 'Password must be at least 8 characters' }),
      })
    )
    .use(notDemo('change password'))
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

  /**
   * Clear the forcePasswordChange flag for the current user.
   * Called after the user successfully changes their password.
   */
  clearForcePasswordChange: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(schema.User)
      .set({ forcePasswordChange: false, updatedAt: new Date() })
      .where(eq(schema.User.id, ctx.session.userId))

    return { success: true }
  }),
})
