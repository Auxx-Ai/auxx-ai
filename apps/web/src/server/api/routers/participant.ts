// apps/web/src/server/api/routers/participant.ts

import { getUserOrganizationId } from '@auxx/lib/email'
import { BadRequestError, NotFoundError } from '@auxx/lib/errors'
import { ensureContactForParticipant, ParticipantService } from '@auxx/lib/participants'
import { PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, isAuxxError, permissionProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('participant-router')

/**
 * The mail front door (plan 40 §5.3), the same one `thread.ts` and `draft.ts`
 * build on.
 *
 * A `Participant` is a mail-domain object — the resolved sender/recipient
 * identity on a `Message` — and both procedures here are reachable **only** from
 * mail surfaces: `thread-data-provider.tsx` (the thread reader's batch fetch),
 * `mail-box.tsx`'s `ParticipantDrawer`, and `thread-provider.tsx`'s
 * `createAndLinkTicket`. Neither was gated, so a member at `inboxes: None` could
 * still enumerate participant identities by id and promote them.
 *
 * **Why `ensureContact` takes the mail key and not a records key.** It writes a
 * contact `EntityInstance`, so a records gate is the obvious guess — and it is
 * the wrong one:
 *
 *  - It is not the generic record-create path. It runs the **ingest** path
 *    (`createIngestContext` → `findOrCreateContactForParticipant`, `force: true`)
 *    — the same code inbound email runs headlessly, with no member capability
 *    consulted, for every message that arrives. The human affordance is a
 *    manual trigger of an automatic behaviour, not a new power.
 *  - It discloses nothing. The name and address it writes onto the contact are
 *    already on the participant row the caller is reading; the mail lens is what
 *    decides whether they may see it.
 *  - Requiring `records.create` on the contact def would break the dispatch
 *    shape §1.4 exists to protect — a mail-only profile (`records: None`) works
 *    threads and creates tickets from them by design.
 *
 * So the coarse mail door is the right authority, and it strictly narrows
 * today's state. Whether contact creation should ALSO answer to the records
 * layer is a real question, but it is a records-layer decision about the ingest
 * path as a whole, not something to settle inside plan 40's front-door slice.
 *
 * `inboxes.view` carries no `featureKey` (`registry.ts`), so
 * `permissionProcedure`'s plan-AND is a no-op here.
 */
const mailProcedure = permissionProcedure(PermissionKey.inboxesView)

/**
 * Router for participant query operations.
 * Provides batch-fetch API for the ID-first architecture.
 */
export const participantRouter = createTRPCRouter({
  /**
   * Batch fetch participants by ID.
   * Uses mutation to avoid caching issues with variable input.
   */
  getByIds: mailProcedure
    .input(
      z.object({
        ids: z.array(z.string()).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found.',
        })
      }

      const participantService = new ParticipantService(organizationId, ctx.db)

      try {
        logger.debug('Fetching participants by IDs', { count: input.ids.length })
        return await participantService.getParticipantMetaBatch(input.ids)
      } catch (error: unknown) {
        // An `AuxxError` is an authorization / not-found ANSWER, not a fault —
        // flattening it into a 500 makes a denial read as a bug.
        if (isAuxxError(error)) throw error
        logger.error('Failed to fetch participants by IDs', {
          organizationId,
          count: input.ids.length,
          error: error instanceof Error ? error.message : error,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch participants.',
        })
      }
    }),

  /**
   * Idempotently ensure a participant has a linked contact EntityInstance.
   * Force-creates the contact if missing, refusing spammers and own-domain
   * participants. Used by the "create ticket from thread" flow when the picked
   * participant has no contact yet.
   */
  ensureContact: mailProcedure
    .input(
      z.object({
        participantId: z.string(),
        /** When promoting from a chat thread, copy the visitor's claimed
         *  name/email + last-known geo from this thread onto the new contact. */
        sourceThreadId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found.',
        })
      }
      try {
        return await ensureContactForParticipant(organizationId, input.participantId, ctx.db, {
          sourceThreadId: input.sourceThreadId,
        })
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message })
        }
        if (error instanceof BadRequestError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        }
        // Anything else that is still an `AuxxError` (e.g. a `ForbiddenError`
        // raised deeper in the ingest path) keeps its status instead of
        // becoming a 500.
        if (isAuxxError(error)) throw error
        logger.error('Failed to ensure contact for participant', {
          organizationId,
          participantId: input.participantId,
          error: error instanceof Error ? error.message : error,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to ensure contact for participant.',
        })
      }
    }),
})
