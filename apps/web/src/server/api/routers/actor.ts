// apps/web/src/server/api/routers/actor.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { ActorService, GroupMemberService } from '@auxx/lib/actors'
import type { ActorContext, ActorId } from '@auxx/types/actor'

/**
 * Helper to create ActorContext from tRPC context
 */
function toActorContext(ctx: { db: any; session: { organizationId: string; userId: string } }): ActorContext {
  return {
    db: ctx.db,
    organizationId: ctx.session.organizationId,
    userId: ctx.session.userId,
  }
}

/**
 * TRPC router for actor operations.
 *
 * Actors are unified references to users or groups.
 * ActorId format: "user:abc123" or "group:xyz789"
 */
export const actorRouter = createTRPCRouter({
  // ═══════════════════════════════════════════════════════════════════════════
  // LISTING & QUERYING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List all available actors for the organization.
   * Used for preloading on page load.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          target: z.enum(['user', 'group', 'both']).optional(),
          roles: z.array(z.enum(['OWNER', 'ADMIN', 'USER'])).optional(),
          groupIds: z.array(z.string()).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const service = new ActorService(toActorContext(ctx))
      return service.listActors(input ?? {})
    }),

  /**
   * Get multiple actors by ActorId.
   * Used for batch hydration of ACTOR field values.
   */
  getByIds: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string()),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new ActorService(toActorContext(ctx))
      const result = await service.getByIds(input.ids as ActorId[])

      // Convert Map to object for JSON serialization
      return Object.fromEntries(result)
    }),

  /**
   * Search actors by name/email.
   * Used for typeahead in ACTOR field selectors.
   */
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1),
        target: z.enum(['user', 'group', 'both']).optional(),
        roles: z.array(z.enum(['OWNER', 'ADMIN', 'USER'])).optional(),
        groupIds: z.array(z.string()).optional(),
        limit: z.number().min(1).max(50).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new ActorService(toActorContext(ctx))
      return service.searchActors(input)
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP MEMBER OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get members of a specific group.
   */
  getGroupMembers: protectedProcedure
    .input(
      z.object({
        groupId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new GroupMemberService(toActorContext(ctx))
      return service.getMembers(input.groupId)
    }),

  /**
   * Expand actors to user IDs (groups → their user members).
   * Useful for notifications, mentions, etc.
   */
  expandToUsers: protectedProcedure
    .input(
      z.object({
        actorIds: z.array(z.string()),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new GroupMemberService(toActorContext(ctx))
      return service.expandToUsers(input.actorIds as ActorId[])
    }),
})
