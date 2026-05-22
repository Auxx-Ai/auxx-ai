// ~/server/api/routers/realtime.ts

import { findRoom, getRealtimeService } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('realtime-router')

/**
 * Allow-list of event-name prefixes that may be published via the client-facing
 * `realtime.publish` tRPC mutation.
 *
 * Server-published events (`thread:*`, `message:*`, `record:*`,
 * `fieldValues:*`, `agent:*`, `mail:*`, `participant:*`) must NEVER be
 * publishable from the client — they're authoritative server-side state
 * changes and a spoofed copy from a logged-in org member would let a peer
 * forge deletions, updates, or agent activity into any room they pass ACL on.
 *
 * Client-publishable events are limited to ephemeral peer-to-peer signals
 * (typing indicators, presence meta) where forging only affects the spoofer's
 * own UX peers within the same room. Add new prefixes here only after
 * confirming the event is safe to spoof.
 */
const ALLOWED_EVENT_PREFIXES = ['typing:', 'presence:'] as const

function isAllowedEvent(event: string): boolean {
  return ALLOWED_EVENT_PREFIXES.some((prefix) => event.startsWith(prefix))
}

/**
 * Realtime tRPC router. Two procedures:
 *
 *   - `publish(roomKey, event, payload)` — server-side mediated publish for
 *     admin-only actions (e.g. an admin pushing into a typing room). Gated by
 *     the room registry's `authorize` fn.
 *
 *   - `updateSelf(roomKey, meta)` — the only path for presence meta updates.
 *     Posts a `member-update` event on the presence room via Pusher REST so
 *     every state change goes through one ACL surface (no Pusher client-events).
 *
 * Channel auth itself stays on the existing `/api/pusher/auth` REST endpoint —
 * Pusher's JS client needs an HTTP `authEndpoint`, and routing that through
 * tRPC is friction with no benefit.
 */
export const realtimeRouter = createTRPCRouter({
  publish: protectedProcedure
    .input(
      z.object({
        roomKey: z.string().min(1).max(256),
        event: z.string().min(1).max(128),
        payload: z.unknown(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isAllowedEvent(input.event)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Event name not permitted for client publish',
        })
      }

      const def = findRoom(input.roomKey)
      if (!def) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown room' })

      const allowed = await def.authorize(input.roomKey, {
        session: {
          userId: ctx.session.userId,
          organizationId: ctx.session.organizationId,
        },
      })
      if (!allowed) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to publish to this room' })
      }

      const ok = await getRealtimeService().publish(input.roomKey, input.event, input.payload)
      if (!ok) {
        logger.warn('Realtime publish failed', { roomKey: input.roomKey, event: input.event })
      }
      return { ok }
    }),

  updateSelf: protectedProcedure
    .input(
      z.object({
        roomKey: z.string().min(1).max(256),
        meta: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const def = findRoom(input.roomKey)
      if (!def) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown room' })
      if (def.kind !== 'presence') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'updateSelf requires a presence room' })
      }

      const allowed = await def.authorize(input.roomKey, {
        session: {
          userId: ctx.session.userId,
          organizationId: ctx.session.organizationId,
        },
      })
      if (!allowed) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to update this room' })
      }

      const ok = await getRealtimeService().publishMemberUpdate(input.roomKey, {
        id: ctx.session.userId,
        meta: input.meta,
      })
      return { ok }
    }),
})
