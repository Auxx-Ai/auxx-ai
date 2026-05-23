// apps/web/src/server/api/routers/chat-duty.ts

import { getCachedOrgHasActiveChat } from '@auxx/lib/cache'
import { listOnDutyUserIds, setMemberChatDuty } from '@auxx/lib/chat-duty'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/**
 * Phase 4c — Chat duty.
 *
 * Per-`OrganizationMember` boolean flagging whether the user wants chats
 * routed to them. Self-toggle for any member; admins can also override others.
 * See plans/chat/v3/phase-4c-chat-duty.md.
 */
export const chatDutyRouter = createTRPCRouter({
  /**
   * Cheap existence check that gates every chat-duty UI surface. Derived from
   * the existing `channels` cache — no extra round-trip.
   */
  orgHasActiveChat: protectedProcedure.query(async ({ ctx }) => {
    return getCachedOrgHasActiveChat(ctx.session.organizationId)
  }),

  /** Userids of every member currently on chat duty in the active org. */
  listOnDuty: protectedProcedure.query(async ({ ctx }) => {
    return listOnDutyUserIds(ctx.session.organizationId)
  }),

  /** Self-toggle. Any authenticated member can flip their own flag. */
  setSelf: protectedProcedure
    .input(z.object({ onDuty: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return setMemberChatDuty({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        actorUserId: ctx.session.userId,
        onDuty: input.onDuty,
        db: ctx.db,
      })
    }),

  /** Admin override — flip another member's flag. */
  setMember: adminProcedure
    .input(z.object({ userId: z.string(), onDuty: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return setMemberChatDuty({
        organizationId: ctx.session.organizationId,
        userId: input.userId,
        actorUserId: ctx.session.userId,
        onDuty: input.onDuty,
      })
    }),
})
