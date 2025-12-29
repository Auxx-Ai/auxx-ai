// apps/build/src/server/api/routers/members.ts
// Members tRPC router

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * Members router
 */
export const membersRouter = createTRPCRouter({
  /**
   * List members of a developer account
   */
  list: protectedProcedure
    .input(z.object({ developerSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      // TODO: Implement
      return []
    }),

  /**
   * Invite members to developer account
   */
  invite: protectedProcedure
    .input(
      z.object({
        developerSlug: z.string(),
        invites: z.array(
          z.object({
            emailAddress: z.string().email(),
            accessLevel: z.enum(['admin', 'member']),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement
      return []
    }),

  /**
   * Remove member from developer account
   */
  remove: protectedProcedure
    .input(
      z.object({
        developerSlug: z.string(),
        memberId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement
      return null
    }),
})
