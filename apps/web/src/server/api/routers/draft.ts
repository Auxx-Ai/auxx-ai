// apps/web/src/server/api/routers/draft.ts

import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { createScopedLogger } from '@auxx/logger'
import { DraftService } from '@auxx/lib/drafts'
import { IdentifierType } from '@auxx/database/enums'
import type { DraftParticipant, DraftAttachment, DraftContent } from '@auxx/types/draft'

const logger = createScopedLogger('draft-router')

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
const UpsertDraftInputSchema = z.object({
  draftId: z.string().nullish(),
  threadId: z.string().nullish(),
  integrationId: z.string(),
  inReplyToMessageId: z.string().nullish(),
  includePreviousMessage: z.boolean().optional(),
  subject: z.string().nullish(),
  textHtml: z.string().nullish(),
  textPlain: z.string().nullish(),
  signatureId: z.string().nullish(),
  to: z.array(ParticipantInputSchema).optional(),
  cc: z.array(ParticipantInputSchema).optional(),
  bcc: z.array(ParticipantInputSchema).optional(),
  attachments: z.array(FileAttachmentSchema).optional(),
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
 * Maps frontend attachment input to DraftAttachment format
 */
function mapAttachment(a: z.infer<typeof FileAttachmentSchema>): DraftAttachment {
  return {
    fileId: a.id,
    filename: a.name,
    contentType: a.mimeType || 'application/octet-stream',
    size: a.size || 0,
    isInline: false,
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
  upsert: protectedProcedure.input(UpsertDraftInputSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    const draftService = new DraftService(ctx.db, organizationId, userId)

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
        bodyHtml: input.textHtml,
        bodyText: input.textPlain,
        signatureId: input.signatureId,
        recipients: {
          to: (input.to || []).map(mapParticipant),
          cc: (input.cc || []).map(mapParticipant),
          bcc: (input.bcc || []).map(mapParticipant),
        },
        attachments: (input.attachments || []).map(mapAttachment),
        includePreviousMessage: input.includePreviousMessage,
        metadata: input.metadata,
      }

      // Extract inReplyToMessageId from input or fallback to legacy metadata.sourceMessageId
      const inReplyToMessageId =
        input.inReplyToMessageId ??
        (input.metadata?.sourceMessageId as string | undefined) ??
        null

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
      logger.error('Failed to upsert draft', { error })
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save draft.' })
    }
  }),

  /**
   * Deletes a draft.
   */
  delete: protectedProcedure
    .input(z.object({ draftId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(ctx.db, organizationId, userId)

      logger.info('Deleting draft', { userId, draftId: input.draftId })

      try {
        return await draftService.delete(input.draftId)
      } catch (error) {
        logger.error('Failed to delete draft', { error })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete draft.' })
      }
    }),

  /**
   * Gets a draft by ID.
   */
  getById: protectedProcedure
    .input(z.object({ draftId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(ctx.db, organizationId, userId)

      const draft = await draftService.getById(input.draftId)
      if (!draft) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found.' })
      }
      return transformDraftForFrontend(draft)
    }),

  /**
   * Gets the draft for a specific thread (current user).
   */
  getByThreadId: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(ctx.db, organizationId, userId)
      const draft = await draftService.getByThreadId(input.threadId)
      return draft ? transformDraftForFrontend(draft) : null
    }),

  /**
   * Checks if a thread has a draft (current user).
   */
  hasDraft: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(ctx.db, organizationId, userId)
      return await draftService.hasDraft(input.threadId)
    }),

  /**
   * Gets draft ID for a thread (current user).
   */
  getDraftId: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(ctx.db, organizationId, userId)
      return await draftService.getDraftId(input.threadId)
    }),

  /**
   * Lists all drafts for the current user.
   */
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(ctx.db, organizationId, userId)
      const drafts = await draftService.listUserDrafts({ limit: input?.limit })
      return drafts.map(transformDraftForFrontend)
    }),

  /**
   * Batch fetch standalone draft metadata by IDs.
   * Used for displaying standalone drafts in the thread list.
   * Uses mutation to avoid caching issues with variable input.
   */
  getByIds: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const draftService = new DraftService(ctx.db, organizationId, userId)

      logger.debug('Fetching standalone draft metas', { count: input.ids.length })

      try {
        return await draftService.getStandaloneDraftMetas(input.ids)
      } catch (error) {
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
    inReplyToMessageId: draft.inReplyToMessageId ?? (legacyMetadata.sourceMessageId as string) ?? null,
    // Include includePreviousMessage at top level (fallback to legacy metadata)
    includePreviousMessage: content.includePreviousMessage ?? !!legacyMetadata.includePreviousMessage,
    subject: content.subject || '',
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
    // Map attachments to expected format
    attachments: content.attachments.map((a) => ({
      id: a.fileId,
      name: a.filename,
      size: a.size,
      mimeType: a.contentType,
      type: 'file' as const,
    })),
    metadata: content.metadata || {},
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  }
}
