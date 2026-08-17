// apps/web/src/server/api/routers/participant.ts

import { schema } from '@auxx/database'
import { getCachedEntityDefId } from '@auxx/lib/cache'
import { getUserOrganizationId } from '@auxx/lib/email'
import { BadRequestError, NotFoundError } from '@auxx/lib/errors'
import {
  ensureContactForParticipant,
  listContactIdentifiers,
  ParticipantService,
} from '@auxx/lib/participants'
import { PermissionKey, resolveRecordVisibilityScope } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq, isNull } from 'drizzle-orm'
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
   * Every address one contact is reachable at on one channel — the composer's
   * recipient-chip "switch to another address" menu
   * (`plans/email-editor/recipient-address-switch.md`).
   *
   * **Why this router.** It is not a search and must not live beside
   * `search.recipients`: that endpoint ranks an org-wide corpus, this one probes
   * two btrees for one id, and filing them together is the invitation to
   * "just add a recordId filter to `searchRecipients`". It belongs here because
   * both of its arms are this router's own subject matter — `Participant` rows
   * plus the contact those rows are linked to — and because {@link mailProcedure}
   * is already the exact authority it needs: the coarse mail door,
   * `PermissionKey.inboxesView`, the SAME answer `search.recipients` asserts.
   * `recipient-address-switch.md` §4 requires that gate not be decided twice,
   * and reusing the procedure is how it stays undecided-twice.
   *
   * 🔴 **Record read is asserted per call, on this one id.** The search returned
   * ONE primary identifier under `resolveRecordVisibilityScope`; this returns
   * EVERY identifier on the record, `recordId` is caller-supplied, and the chip
   * may have arrived from a draft, a reply or a share rather than from a search
   * this caller ran. So the same instance-level predicate the record picker
   * applies (`record-picker-service.ts:1406-1414`) is applied here, narrowed to
   * one id.
   *
   * An unreadable record answers with an **empty array, not a 403**. The chip is
   * legitimately in the draft either way, and this fires from opening a menu — a
   * thrown error would toast at someone who did nothing wrong. Mail reach itself
   * still 403s, because a member with no mail reach is not composing.
   */
  listContactIdentifiers: mailProcedure
    .input(
      z.object({
        /** `EntityInstance.id` from `RecipientState.recordId`. */
        recordId: z.string(),
        /**
         * `PlatformCapabilities.recipientModel` of the SENDING channel. Part of
         * the query key on the client too: a list fetched under the email model
         * must never be read under the phone model.
         */
        model: z.enum(['email', 'phone', 'thread_only', 'platform_user']),
        limit: z.number().int().min(1).max(50).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const contactDefId = await getCachedEntityDefId(organizationId, 'contact')
      if (!contactDefId) return []

      const scope = await resolveRecordVisibilityScope({
        organizationId,
        userId: ctx.session.userId,
        entityDefinitionId: contactDefId,
        capabilities: ctx.capabilities,
      })
      // Arm 4 — this member reaches no contact at all, so there is nothing to
      // probe. `scope.where` is `undefined` on arm 'all' and `and()` drops it.
      if (scope.arm === 'none') return []

      const [readable] = await ctx.db
        .select({ id: schema.EntityInstance.id })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, input.recordId),
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, contactDefId),
            isNull(schema.EntityInstance.archivedAt),
            scope.where
          )
        )
        .limit(1)
      if (!readable) return []

      const result = await listContactIdentifiers(ctx.db, {
        organizationId,
        recordId: input.recordId,
        model: input.model,
        limit: input.limit,
      })
      if (result.isErr()) throw result.error
      return result.value
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
