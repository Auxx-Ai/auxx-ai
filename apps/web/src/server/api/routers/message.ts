// apps/web/src/server/api/routers/message.ts

import { getCachedUserInstanceGrants } from '@auxx/lib/cache'
import { getUserOrganizationId } from '@auxx/lib/email'
import { NotFoundError } from '@auxx/lib/errors'
import { MessageQueryService } from '@auxx/lib/messages'
import { PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, isAuxxError, permissionProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('message-router')

/**
 * The mail front door (plan 40 §5.3), the same one `thread.ts` and `draft.ts`
 * build on.
 *
 * §5.3's table names the thread router; messages live in their own router and
 * were never enumerated, so this file had **no coarse door at all** — both
 * procedures were bare `protectedProcedure`s. Content was never unguarded (both
 * go through `MessageQueryService` with the caller's `UserInstanceGrants`, and
 * `getMessagesByThread` throws `NotFoundError` at lens `none`), but the *area*
 * question was unanswerable: a member whose profile sets `inboxes: None` could
 * still read every message body their lens floor allowed, and `inboxes: None` is
 * supposed to mean **none** (§1.4).
 *
 * Coarse and wholesale:
 *
 *  - **Both procedures.** `permissionProcedure` asserts in MIDDLEWARE, before
 *    the handler body, so leaving one on `protectedProcedure` leaves the surface
 *    open.
 *  - **No inbox-instance assert** (§1.4). A dispatch-org assignee holds no
 *    `ResourceAccess` row on the inbox by construction, and `listByThread` is
 *    the surface they read their assigned thread through; an instance gate would
 *    deny exactly the people the model exists to serve. The per-thread lens
 *    stays the authority, unchanged.
 *
 * `inboxes.view` carries no `featureKey` (`registry.ts`), so
 * `permissionProcedure`'s plan-AND is a no-op here.
 */
const mailProcedure = permissionProcedure(PermissionKey.inboxesView)

/** Resolves the org + the caller's mail-visibility context (§5.4). */
const getMessageQueryService = async (ctx: any) => {
  const organizationId = getUserOrganizationId(ctx.session)
  if (!organizationId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'User organization context not found.',
    })
  }
  const viewer = await getCachedUserInstanceGrants(ctx.session.user.id as string, organizationId)
  return {
    organizationId,
    messageQuery: new MessageQueryService(organizationId, ctx.db, viewer),
  }
}

/**
 * Router for message query operations.
 * Provides batch-fetch APIs for the ID-first architecture.
 */
export const messageRouter = createTRPCRouter({
  /**
   * Batch fetch messages by ID.
   * Uses mutation to avoid caching issues with variable input.
   */
  getByIds: mailProcedure
    .input(
      z.object({
        ids: z.array(z.string()).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, messageQuery } = await getMessageQueryService(ctx)

      try {
        logger.debug('Fetching messages by IDs', { count: input.ids.length })
        return await messageQuery.getMessageMetaBatch(input.ids)
      } catch (error: unknown) {
        // An `AuxxError` from the query layer is an authorization or
        // not-found ANSWER, not a fault — flattening it into a 500 would make a
        // denial read as a bug (the drafts-router precedent). `auxxErrorMiddleware`
        // maps it to the right status.
        if (isAuxxError(error)) throw error
        logger.error('Failed to fetch messages by IDs', {
          organizationId,
          count: input.ids.length,
          error: error instanceof Error ? error.message : error,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch messages.',
        })
      }
    }),

  /**
   * Get messages for a thread with full metadata.
   * Returns messages with participants as ParticipantId[] array.
   */
  listByThread: mailProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, messageQuery } = await getMessageQueryService(ctx)

      try {
        logger.debug('Fetching messages for thread', { threadId: input.threadId })
        return await messageQuery.getMessagesByThread(input.threadId)
      } catch (error: unknown) {
        if (error instanceof NotFoundError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found.' })
        }
        // Same reasoning as `getByIds`: never flatten an `AuxxError` into a 500.
        if (isAuxxError(error)) throw error
        logger.error('Failed to fetch messages for thread', {
          organizationId,
          threadId: input.threadId,
          error: error instanceof Error ? error.message : error,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch messages for thread.',
        })
      }
    }),
})
