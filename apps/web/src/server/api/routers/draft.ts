// apps/web/src/server/api/routers/draft.ts

import { IdentifierType } from '@auxx/database/enums'
import { getCachedUserInstanceGrants } from '@auxx/lib/cache'
import { DraftService } from '@auxx/lib/drafts'
import { PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import type { DraftAttachment, DraftContent, DraftParticipant } from '@auxx/types/draft'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, isAuxxError, permissionProcedure } from '~/server/api/trpc'
import { assertSignatureUsable } from '~/server/lib/signature-instance-access'

const logger = createScopedLogger('draft-router')

/**
 * The mail front door (plan 40 §5.3), the same one `thread.ts` builds on.
 *
 * §5.3's table lists "drafts" under the thread router, but drafts have lived in
 * their own router since well before that table was written — so phase 3 gated
 * `thread.*` and left this entire surface bare. A member at `inboxes: None`
 * could still compose, autosave, list and delete drafts, which is most of the
 * mail write experience: `inboxes: None` is supposed to mean **none** (§1.4).
 *
 * Coarse and wholesale, exactly like `thread.ts`:
 *
 *  - **No tiering.** There is no thread-authority axis (§1.1) — seeing a thread
 *    at `full` lens IS the permission to draft a reply on it — so the first
 *    draft's "drafts split" is cancelled along with the rest of it.
 *  - **Every procedure, not most of them.** `permissionProcedure` asserts in
 *    MIDDLEWARE, before the handler body, so one procedure left on
 *    `protectedProcedure` leaves the surface open; mixing builders inside one
 *    router is how this repo has lost gates before.
 *  - **No inbox-instance assert** (§1.4). A dispatch-org assignee holds no
 *    `ResourceAccess` row on the inbox by construction; assignment confers the
 *    `full` lens, and drafting a reply on an assigned thread is exactly what the
 *    dispatch model exists to allow.
 *
 * **No per-thread lens gate belongs here either — the service already runs it.**
 * `DraftService.assertCanDraftOnThread` requires `full` lens on `threadId`
 * before a draft is attached to a thread, and every read/update/delete path in
 * the service is additionally scoped to `createdById = <caller>`, so a draft is
 * only ever reachable by the person who made it. Re-asserting in the router
 * would be a second copy of the same predicate — precisely the drift §5.5 exists
 * to remove — for a gate that is already in the right place.
 *
 * `inboxes.view` carries no `featureKey` (`registry.ts`), so `permissionProcedure`'s
 * plan-AND is a no-op here.
 */
const mailProcedure = permissionProcedure(PermissionKey.inboxesView)

// ─────────────────────────────────────────────────────────────────────────────
// Input Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Participant input schema for draft recipients
 */
const ParticipantInputSchema = z.object({
  identifier: z.string(),
  identifierType: z.enum(IdentifierType),
  name: z.string().optional(),
})

/**
 * File attachment schema for draft attachments
 */
const FileAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  type: z.enum(['file', 'asset']),
})

/**
 * Upsert draft input schema
 * Maps frontend payload to DraftContent format
 */
/**
 * Quick action payload schema for draft-attached actions
 */
const DraftActionPayloadSchema = z.object({
  appId: z.string(),
  installationId: z.string(),
  actionId: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  display: z.object({
    label: z.string(),
    icon: z.string().optional(),
    color: z.string().optional(),
    summary: z.string(),
  }),
})

const UpsertDraftInputSchema = z.object({
  draftId: z.string().nullish(),
  threadId: z.string().nullish(),
  integrationId: z.string(),
  inReplyToMessageId: z.string().nullish(),
  includePreviousMessage: z.boolean().optional(),
  subject: z.string().nullish(),
  /** Canonical Tiptap JSON body — replaces the legacy `textHtml` field. */
  bodyJson: z.record(z.string(), z.unknown()).nullish(),
  textPlain: z.string().nullish(),
  signatureId: z.string().nullish(),
  to: z.array(ParticipantInputSchema).optional(),
  cc: z.array(ParticipantInputSchema).optional(),
  bcc: z.array(ParticipantInputSchema).optional(),
  attachments: z.array(FileAttachmentSchema).optional(),
  actions: z.array(DraftActionPayloadSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps frontend participant input to DraftParticipant format
 */
function mapParticipant(p: z.infer<typeof ParticipantInputSchema>): DraftParticipant {
  return {
    identifier: p.identifier,
    identifierType: p.identifierType,
    name: p.name || null,
  }
}

/**
 * Maps frontend attachment input to DraftAttachment format.
 * Now a direct passthrough since types match.
 */
function mapAttachment(a: z.infer<typeof FileAttachmentSchema>): DraftAttachment {
  return {
    id: a.id,
    name: a.name,
    size: a.size || 0,
    mimeType: a.mimeType || 'application/octet-stream',
    type: a.type,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export const draftRouter = createTRPCRouter({
  /**
   * Creates or updates a draft.
   * Maps frontend payload format to new DraftContent structure.
   */
  upsert: mailProcedure.input(UpsertDraftInputSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    // Instance access (plan 36 §5) — a draft's `signatureId` is echoed back on
    // read and handed to `MessageSenderService` on send, so an unvalidated id
    // here is the same private-signature read as `thread.sendMessage`'s.
    await assertSignatureUsable({
      db: ctx.db,
      organizationId,
      userId,
      signatureId: input.signatureId,
    })
    const draftService = new DraftService(
      ctx.db,
      organizationId,
      userId,
      await getCachedUserInstanceGrants(userId, organizationId)
    )

    logger.info('Upserting draft', {
      userId,
      draftId: input.draftId,
      threadId: input.threadId,
      attachmentCount: input.attachments?.length ?? 0,
      attachments: input.attachments,
    })

    try {
      // Build DraftContent from frontend payload
      const content: Partial<DraftContent> = {
        subject: input.subject,
        bodyJson: input.bodyJson,
        bodyText: input.textPlain,
        signatureId: input.signatureId,
        recipients: {
          to: (input.to || []).map(mapParticipant),
          cc: (input.cc || []).map(mapParticipant),
          bcc: (input.bcc || []).map(mapParticipant),
        },
        attachments: (input.attachments || []).map(mapAttachment),
        actions: input.actions,
        includePreviousMessage: input.includePreviousMessage,
        metadata: input.metadata,
      }

      // Extract inReplyToMessageId from input or fallback to legacy metadata.sourceMessageId
      const inReplyToMessageId =
        input.inReplyToMessageId ?? (input.metadata?.sourceMessageId as string | undefined) ?? null

      const draft = await draftService.upsert({
        draftId: input.draftId,
        integrationId: input.integrationId,
        threadId: input.threadId,
        inReplyToMessageId,
        content,
      })

      // Return in format compatible with frontend expectations
      return transformDraftForFrontend(draft)
    } catch (error) {
      // The §7 draft-on-thread gate (`DraftService.assertCanDraftOnThread`)
      // throws a `ForbiddenError` from inside this try, so a blanket
      // `INTERNAL_SERVER_ERROR` turned every lens denial into a 500 with
      // "Failed to save draft." Guard on `isAuxxError`, never
      // `instanceof TRPCError` — service code throws `AuxxError`, and
      // `auxxErrorMiddleware` + `errorFormatter` map it to the right status.
      if (isAuxxError(error)) throw error
      logger.error('Failed to upsert draft', { error })
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save draft.' })
    }
  }),

  /**
   * Deletes a draft.
   */
  delete: mailProcedure
    .input(z.object({ draftId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(
        ctx.db,
        organizationId,
        userId,
        await getCachedUserInstanceGrants(userId, organizationId)
      )

      logger.info('Deleting draft', { userId, draftId: input.draftId })

      try {
        return await draftService.delete(input.draftId)
      } catch (error) {
        if (isAuxxError(error)) throw error
        logger.error('Failed to delete draft', { error })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete draft.' })
      }
    }),

  /**
   * Gets a draft by ID.
   */
  getById: mailProcedure.input(z.object({ draftId: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    const draftService = new DraftService(
      ctx.db,
      organizationId,
      userId,
      await getCachedUserInstanceGrants(userId, organizationId)
    )

    const draft = await draftService.getById(input.draftId)
    if (!draft) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found.' })
    }
    return transformDraftForFrontend(draft)
  }),

  /**
   * Gets the draft for a specific thread (current user).
   */
  getByThreadId: mailProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(
        ctx.db,
        organizationId,
        userId,
        await getCachedUserInstanceGrants(userId, organizationId)
      )
      const draft = await draftService.getByThreadId(input.threadId)
      return draft ? transformDraftForFrontend(draft) : null
    }),

  /**
   * Checks if a thread has a draft (current user).
   */
  hasDraft: mailProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(
        ctx.db,
        organizationId,
        userId,
        await getCachedUserInstanceGrants(userId, organizationId)
      )
      return await draftService.hasDraft(input.threadId)
    }),

  /**
   * Gets draft ID for a thread (current user).
   */
  getDraftId: mailProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(
        ctx.db,
        organizationId,
        userId,
        await getCachedUserInstanceGrants(userId, organizationId)
      )
      return await draftService.getDraftId(input.threadId)
    }),

  /**
   * Lists all drafts for the current user.
   */
  list: mailProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(
        ctx.db,
        organizationId,
        userId,
        await getCachedUserInstanceGrants(userId, organizationId)
      )
      const drafts = await draftService.listUserDrafts({ limit: input?.limit })
      return drafts.map(transformDraftForFrontend)
    }),

  /**
   * Batch fetch standalone draft metadata by IDs.
   * Used for displaying standalone drafts in the thread list.
   * Uses mutation to avoid caching issues with variable input.
   */
  getByIds: mailProcedure
    .input(z.object({ ids: z.array(z.string()).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(
        ctx.db,
        organizationId,
        userId,
        await getCachedUserInstanceGrants(userId, organizationId)
      )

      logger.debug('Fetching standalone draft metas', { count: input.ids.length })

      try {
        return await draftService.getStandaloneDraftMetas(input.ids)
      } catch (error) {
        if (isAuxxError(error)) throw error
        logger.error('Failed to fetch standalone draft metas', { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch draft metadata.',
        })
      }
    }),
})

// ─────────────────────────────────────────────────────────────────────────────
// Transform Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transforms a Draft entity to the format expected by the frontend.
 * Maps DraftContent fields to flat structure for backward compatibility.
 */
function transformDraftForFrontend(draft: import('@auxx/types/draft').Draft) {
  const content = draft.content
  // Support legacy drafts that stored these in metadata
  const legacyMetadata = (content.metadata ?? {}) as Record<string, unknown>

  return {
    id: draft.id,
    threadId: draft.threadId,
    integrationId: draft.integrationId,
    // Include inReplyToMessageId at top level for frontend
    inReplyToMessageId:
      draft.inReplyToMessageId ?? (legacyMetadata.sourceMessageId as string) ?? null,
    // Include includePreviousMessage at top level (fallback to legacy metadata)
    includePreviousMessage:
      content.includePreviousMessage ?? !!legacyMetadata.includePreviousMessage,
    subject: content.subject || '',
    bodyJson: content.bodyJson ?? null,
    textHtml: content.bodyHtml || '',
    textPlain: content.bodyText || '',
    signatureId: content.signatureId || null,
    // Map recipients back to flat arrays with participant-like structure
    participants: [
      ...content.recipients.to.map((p) => ({
        role: 'TO' as const,
        participant: {
          id: p.participantId || p.identifier,
          identifier: p.identifier,
          identifierType: p.identifierType,
          name: p.name || null,
        },
      })),
      ...content.recipients.cc.map((p) => ({
        role: 'CC' as const,
        participant: {
          id: p.participantId || p.identifier,
          identifier: p.identifier,
          identifierType: p.identifierType,
          name: p.name || null,
        },
      })),
      ...content.recipients.bcc.map((p) => ({
        role: 'BCC' as const,
        participant: {
          id: p.participantId || p.identifier,
          identifier: p.identifier,
          identifierType: p.identifierType,
          name: p.name || null,
        },
      })),
    ],
    // Attachments are now returned directly - types match
    attachments: content.attachments,
    actions: content.actions,
    metadata: content.metadata || {},
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }
}
