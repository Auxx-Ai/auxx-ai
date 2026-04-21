// ~/server/api/routers/thread.ts ---

import { schema } from '@auxx/database'
import { IdentifierType } from '@auxx/database/enums'
import { conditionGroupsSchema } from '@auxx/lib/conditions'
import { DraftService } from '@auxx/lib/drafts'
import { getUserOrganizationId } from '@auxx/lib/email' // Adjust import path if needed
import {
  cancelScheduledMessage,
  createScheduledMessage,
  enqueueScheduledMessageJob,
  findPendingByDraftId,
  findScheduledMessagesByThreadId,
  updateScheduledMessage,
  updateScheduledMessageStatus,
} from '@auxx/lib/mail-schedule'
import { MessageSenderService } from '@auxx/lib/messages'
import { buildPlaceholderContextForThread, resolvePlaceholdersInHtml } from '@auxx/lib/placeholders'
import { ProviderRegistryService, whereThreadMessageType } from '@auxx/lib/providers'
import {
  type ListThreadIdsInput,
  ThreadMutationService,
  ThreadQueryService,
  UnreadService,
} from '@auxx/lib/threads'
import { createScopedLogger } from '@auxx/logger'
import { recordIdSchema } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('thread-router')

// Participant Input Schema (reusable)
const ParticipantInputSchema = z.object({
  identifier: z.string(),
  identifierType: z.enum(IdentifierType),
  name: z.string().optional(), // Remove nullable to match SendMessageInput interface
})
// File Attachment Schema for structured attachments
const FileAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  type: z.enum(['file', 'asset']), // 'file' = FolderFile, 'asset' = MediaAsset
})
// Send Message Input Schema
const SendMessageInputSchema = z.object({
  threadId: z.string().optional(), // Allow creating new threads
  integrationId: z.string(), // Required: Which inbox is sending?
  subject: z.string().min(1, 'Subject is required'),
  textHtml: z.string().nullish(),
  textPlain: z.string().nullish(),
  signatureId: z.string().nullish(),
  to: z.array(ParticipantInputSchema).min(1, 'At least one TO recipient is required'),
  cc: z.array(ParticipantInputSchema).optional(),
  bcc: z.array(ParticipantInputSchema).optional(),
  attachments: z.array(FileAttachmentSchema).optional(), // File attachments to attach
  draftMessageId: z.string().nullish(), // Optional ID of draft being sent
  includePreviousMessage: z.boolean().optional(), // Include previous message content
  linkTicketId: z.string().nullish(), // Auto-link new thread to ticket after send
  scheduledAt: z.date().optional(), // Schedule send for a future time
})
// --- Helper Functions ---
/**
 * Gets userId, organizationId, and instantiates services scoped to the org.
 * Updated to use new modular service architecture.
 * Throws TRPCError if organizationId is not found.
 */
const getServiceDependencies = (
  ctx: any
): {
  threadQuery: ThreadQueryService
  threadMutation: ThreadMutationService
  messageSender: MessageSenderService
  organizationId: string
  userId: string
} => {
  const userId = ctx.session.user.id as string
  const organizationId = getUserOrganizationId(ctx.session)
  if (!organizationId) {
    logger.error('Organization ID not found for user', { userId })
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User organization context not found.' })
  }
  // Instantiate new modular services
  const providerRegistry = new ProviderRegistryService(organizationId)
  const messageSender = new MessageSenderService(organizationId, providerRegistry, ctx.db)
  // New specialized services
  const threadQuery = new ThreadQueryService(organizationId, ctx.db)
  const threadMutation = new ThreadMutationService(organizationId, ctx.db)
  return {
    threadQuery,
    threadMutation,
    messageSender,
    organizationId,
    userId,
  }
}
/**
 * Centralized error handler for service calls.
 * Logs the error and throws an appropriate TRPCError.
 */
const handleServiceError = (
  error: unknown,
  procedureName: string,
  context: Record<string, any>
) => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  const stack = error instanceof Error ? error.stack : undefined
  logger.error(`Error in ${procedureName}`, { ...context, error: message, stack })
  if (error instanceof Error) {
    if (message.includes('not found')) {
      throw new TRPCError({ code: 'NOT_FOUND', message, cause: error })
    }
    if (message.includes('Assignee user') && message.includes('not found')) {
      throw new TRPCError({ code: 'BAD_REQUEST', message, cause: error })
    }
    // Add more specific checks based on potential service errors
  }
  // Fallback for unknown or unhandled errors
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `An unexpected error occurred in ${procedureName}.`,
    cause: error instanceof Error ? error : undefined,
  })
}
// --- tRPC Router Definition ---
export const threadRouter = createTRPCRouter({
  /**
   * Returns only thread IDs with pagination info.
   * Frontend calls getByIds to batch-fetch metadata separately.
   *
   * Uses unified condition-based filtering - filter is a ConditionGroup[].
   */
  listIds: protectedProcedure
    .input(
      z.object({
        /** Condition-based filter (ConditionGroup[]) */
        filter: conditionGroupsSchema,
        /** Sort options */
        sort: z
          .object({
            field: z.enum(['lastMessageAt', 'subject', 'sender']),
            direction: z.enum(['asc', 'desc']),
          })
          .optional(),
        /** Pagination cursor */
        cursor: z.string().optional(),
        /** Page size (max 100) */
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const { threadQuery, organizationId, userId } = getServiceDependencies(ctx)

      const serviceInput: ListThreadIdsInput = {
        filter: input.filter,
        sort: input.sort,
        cursor: input.cursor,
        limit: input.limit,
        userId, // Required for DRAFTS context to fetch user's standalone drafts
      }

      try {
        logger.debug('Calling threadQuery.listThreadIds', { serviceInput })
        return await threadQuery.listThreadIds(serviceInput)
      } catch (error: unknown) {
        handleServiceError(error, 'threadQuery.listThreadIds', { organizationId, userId })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed fetching thread IDs.',
        })
      }
    }),

  /**
   * Batch fetch thread metadata by IDs.
   * Uses mutation to avoid caching issues with variable input.
   */
  getByIds: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string()).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { threadQuery, organizationId, userId } = getServiceDependencies(ctx)

      try {
        logger.debug('Calling threadQuery.getThreadMetaBatch', { count: input.ids.length })
        return await threadQuery.getThreadMetaBatch(input.ids, userId)
      } catch (error: unknown) {
        handleServiceError(error, 'threadQuery.getThreadMetaBatch', { organizationId, userId })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed fetching thread metadata.',
        })
      }
    }),

  getChatMessages: protectedProcedure
    .input(
      z.object({
        threadId: z.string(),
        limit: z.number().optional().default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Fetch 'ChatMessage' records for CHAT threads
      // Implement pagination
      const messages = await ctx.db
        .select({
          id: schema.ChatMessage.id,
          threadId: schema.ChatMessage.threadId,
          content: schema.ChatMessage.content,
          createdAt: schema.ChatMessage.createdAt,
          sender: schema.ChatMessage.sender,
          agent: {
            name: schema.User.name,
            image: schema.User.image,
          },
        })
        .from(schema.ChatMessage)
        .leftJoin(schema.User, eq(schema.ChatMessage.agentId, schema.User.id))
        .where(eq(schema.ChatMessage.threadId, input.threadId))
        .orderBy(schema.ChatMessage.createdAt)
        .limit(input.limit + 1)
      // ... handle nextCursor ...
      return { items: messages /* mapped if needed */, nextCursor: null /* calculated cursor */ }
    }),
  // Procedure to get ChatSession details (needed for ChatInterface)
  getChatSessionByThreadId: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      const [thread] = await ctx.db
        .select({ externalId: schema.Thread.externalId })
        .from(schema.Thread)
        .where(
          and(
            eq(schema.Thread.id, input.threadId),
            eq(schema.Thread.organizationId, organizationId),
            whereThreadMessageType('CHAT')
          )
        )
        .limit(1)
      if (!thread || !thread.externalId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Chat thread or session link not found.',
        })
      }
      const [session] = await ctx.db
        .select()
        .from(schema.ChatSession)
        .where(
          and(
            eq(schema.ChatSession.id, thread.externalId),
            eq(schema.ChatSession.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session details not found.' })
      }
      return session
    }),
  /**
   * Sends an email message, potentially from a draft.
   * Updated to use MessageSenderService directly.
   */
  sendMessage: protectedProcedure
    .input(SendMessageInputSchema)
    .use(notDemo('send emails'))
    .mutation(async ({ ctx, input }) => {
      try {
        const { messageSender, organizationId, userId } = getServiceDependencies(ctx)
        const {
          integrationId,
          threadId,
          subject,
          textHtml,
          textPlain,
          signatureId,
          to,
          cc,
          bcc,
          draftMessageId,
          attachments,
        } = input

        // Resolve `{{...}}` placeholders in the HTML body before handoff.
        // Hard-fails with BAD_REQUEST on unresolvable tokens so the composer
        // can surface a toast rather than silently sending an empty value.
        let resolvedHtml = textHtml || undefined
        if (resolvedHtml && resolvedHtml.includes('data-type="placeholder"')) {
          try {
            const placeholderCtx = await buildPlaceholderContextForThread({
              db: ctx.db,
              organizationId,
              senderUserId: userId,
              threadId,
              primaryRecipient: to[0]
                ? { identifier: to[0].identifier, identifierType: to[0].identifierType }
                : undefined,
            })
            resolvedHtml = await resolvePlaceholdersInHtml(resolvedHtml, placeholderCtx)
          } catch (err) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                err instanceof Error
                  ? `Could not resolve placeholders: ${err.message}`
                  : 'Could not resolve placeholders in message body.',
            })
          }
        }

        // Transform input to MessageSenderService format
        const senderInput = {
          userId,
          organizationId,
          integrationId,
          threadId,
          subject,
          textHtml: resolvedHtml,
          textPlain: textPlain || undefined,
          signatureId: signatureId || undefined,
          to: to.map((p) => ({
            identifier: p.identifier,
            name: p.name || undefined,
            identifierType: p.identifierType,
          })),
          cc: cc?.map((p) => ({
            identifier: p.identifier,
            name: p.name || undefined,
            identifierType: p.identifierType,
          })),
          bcc: bcc?.map((p) => ({
            identifier: p.identifier,
            name: p.name || undefined,
            identifierType: p.identifierType,
          })),
          attachmentIds: attachments?.map((att) => att.id) || undefined, // Map attachments to IDs
        }
        // --- Schedule send path ---
        if (input.scheduledAt) {
          const scheduledAt = input.scheduledAt
          if (scheduledAt <= new Date()) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Scheduled time must be in the future.',
            })
          }

          // If draft already has a pending schedule, cancel it first
          if (draftMessageId) {
            const existing = await findPendingByDraftId(ctx.db, draftMessageId, organizationId)
            if (existing) {
              await cancelScheduledMessage(ctx.db, existing.id, organizationId)
              if (existing.jobId) {
                try {
                  const { getQueue } = await import('@auxx/lib/jobs/queues')
                  const { Queues } = await import('@auxx/lib/jobs/queues/types')
                  const queue = getQueue(Queues.messageProcessingQueue)
                  await queue.remove(existing.jobId)
                } catch {
                  // Job may already be gone — non-fatal
                }
              }
            }
          }

          // Create the scheduled message record
          const scheduled = await createScheduledMessage(ctx.db, {
            organizationId,
            draftId: draftMessageId ?? undefined,
            integrationId,
            threadId: threadId ?? undefined,
            createdById: userId,
            scheduledAt,
            sendPayload: senderInput,
          })

          // Enqueue delayed BullMQ job
          const jobId = await enqueueScheduledMessageJob(
            { scheduledMessageId: scheduled.id, organizationId },
            scheduledAt
          )

          // Store the job ID on the record for cancellation
          await updateScheduledMessageStatus(ctx.db, scheduled.id, 'PENDING', { jobId })

          logger.info('Message scheduled', {
            scheduledMessageId: scheduled.id,
            scheduledAt,
            jobId,
            userId,
          })

          return { scheduled: true, scheduledMessageId: scheduled.id, scheduledAt } as any
        }

        // --- Immediate send path ---
        logger.info('API: Sending message via MessageSenderService', {
          userId,
          threadId: input.threadId,
          draftId: input.draftMessageId,
        })
        const sentMessage = await messageSender.sendMessage(senderInput)

        // Auto-link thread to ticket if linkTicketId is provided
        if (input.linkTicketId && sentMessage.threadId) {
          try {
            await ctx.db
              .update(schema.Thread)
              .set({ ticketId: input.linkTicketId })
              .where(eq(schema.Thread.id, sentMessage.threadId))
            logger.info('Auto-linked new thread to ticket', {
              threadId: sentMessage.threadId,
              ticketId: input.linkTicketId,
            })
          } catch (linkError) {
            // Non-fatal: message was sent, link failure is acceptable
            logger.warn('Failed to auto-link thread to ticket', {
              threadId: sentMessage.threadId,
              ticketId: input.linkTicketId,
              error: linkError instanceof Error ? linkError.message : String(linkError),
            })
          }
        }

        // Clean up draft after successful send
        if (draftMessageId) {
          try {
            const draftService = new DraftService(ctx.db, organizationId, userId)
            await draftService.markAsSent(draftMessageId)
          } catch (draftError) {
            // Non-fatal: message was sent, draft cleanup failure is acceptable
            logger.warn('Failed to clean up draft after send', {
              draftMessageId,
              error: draftError instanceof Error ? draftError.message : String(draftError),
            })
          }
        }

        return sentMessage
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'messageSender.sendMessage', {
          organizationId: (ctx.session as any).organizationId,
          userId: ctx.session.user.id,
          input: input,
        })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send message.' })
      }
    }),
  /**
   * Cancel a previously scheduled message.
   * Returns the associated draft so the editor can re-open it.
   */
  cancelScheduledMessage: protectedProcedure
    .input(z.object({ scheduledMessageId: z.string() }))
    .use(notDemo('cancel scheduled emails'))
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found.',
        })
      }

      const cancelled = await cancelScheduledMessage(
        ctx.db,
        input.scheduledMessageId,
        organizationId
      )
      if (!cancelled) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Scheduled message not found or already processed.',
        })
      }

      // Remove the BullMQ job
      if (cancelled.jobId) {
        try {
          const { getQueue } = await import('@auxx/lib/jobs/queues')
          const { Queues } = await import('@auxx/lib/jobs/queues/types')
          const queue = getQueue(Queues.messageProcessingQueue)
          await queue.remove(cancelled.jobId)
        } catch {
          // Job may already be gone — non-fatal
        }
      }

      logger.info('Cancelled scheduled message', {
        scheduledMessageId: input.scheduledMessageId,
        draftId: cancelled.draftId,
      })

      return { cancelled: true, draftId: cancelled.draftId }
    }),
  /**
   * Get pending/processing scheduled messages for a thread.
   * Used in the thread detail view to display scheduled message cards.
   */
  getScheduledMessages: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found.',
        })
      }
      return findScheduledMessagesByThreadId(ctx.db, input.threadId, organizationId)
    }),
  /**
   * Update a pending scheduled message (reschedule time or update payload).
   */
  updateScheduledMessage: protectedProcedure
    .input(
      z.object({
        scheduledMessageId: z.string(),
        scheduledAt: z.date().optional(),
      })
    )
    .use(notDemo('update scheduled emails'))
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User organization context not found.',
        })
      }

      const updated = await updateScheduledMessage(
        ctx.db,
        input.scheduledMessageId,
        organizationId,
        {
          scheduledAt: input.scheduledAt,
        }
      )
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Scheduled message not found or already processed.',
        })
      }

      // If scheduledAt changed, remove old BullMQ job and enqueue new one
      if (input.scheduledAt && updated.jobId) {
        try {
          const { getQueue } = await import('@auxx/lib/jobs/queues')
          const { Queues } = await import('@auxx/lib/jobs/queues/types')
          const queue = getQueue(Queues.messageProcessingQueue)
          await queue.remove(updated.jobId)
        } catch {
          // Job may already be gone — non-fatal
        }

        const jobId = await enqueueScheduledMessageJob(
          { scheduledMessageId: updated.id, organizationId },
          input.scheduledAt
        )
        await updateScheduledMessageStatus(ctx.db, updated.id, 'PENDING', { jobId })
      }

      return updated
    }),
  /**
   * Tag multiple threads in bulk
   * Updated to use ThreadMutationService.
   */
  tagBulk: protectedProcedure
    .input(
      z.object({
        recordIds: z.array(recordIdSchema),
        relatedRecordIds: z.array(recordIdSchema),
        operation: z.enum(['add', 'remove', 'set']).default('add'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = getServiceDependencies(ctx)
      try {
        logger.info('API: Bulk tagging threads', {
          threadCount: input.recordIds.length,
          tagCount: input.relatedRecordIds.length,
          operation: input.operation,
          userId,
          organizationId,
        })
        const result = await threadMutation.tagThreadsBulk(
          input.recordIds,
          input.relatedRecordIds,
          input.operation
        )
        return result
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'threadMutation.tagThreadsBulk', {
          organizationId,
          userId,
          recordIds: input.recordIds,
          relatedRecordIds: input.relatedRecordIds,
          operation: input.operation,
        })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed tagging threads.' })
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // UNIFIED ENDPOINTS (RecordId-based)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Unified update endpoint for a single thread.
   * Accepts RecordId and partial ThreadUpdates.
   */
  update: protectedProcedure
    .input(
      z.object({
        recordId: recordIdSchema,
        updates: z.object({
          status: z.enum(['OPEN', 'ARCHIVED', 'SPAM', 'TRASH', 'IGNORED']).optional(),
          subject: z.string().optional(),
          assigneeId: z.string().nullable().optional(),
          inboxId: recordIdSchema.nullable().optional(),
          ticketId: recordIdSchema.nullable().optional(),
          isUnread: z.boolean().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = getServiceDependencies(ctx)
      try {
        logger.info('API: Unified thread update', {
          recordId: input.recordId,
          updates: input.updates,
          userId,
          organizationId,
        })
        return await threadMutation.update(input.recordId, input.updates as any)
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'threadMutation.update', {
          organizationId,
          userId,
          recordId: input.recordId,
          updates: input.updates,
        })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed updating thread.' })
      }
    }),

  /**
   * Unified bulk update endpoint for multiple threads.
   * Accepts RecordIds and partial ThreadUpdates.
   */
  updateBulk: protectedProcedure
    .input(
      z.object({
        recordIds: z.array(recordIdSchema),
        updates: z.object({
          status: z.enum(['OPEN', 'ARCHIVED', 'SPAM', 'TRASH', 'IGNORED']).optional(),
          assigneeId: z.string().nullable().optional(),
          inboxId: recordIdSchema.nullable().optional(),
          ticketId: recordIdSchema.nullable().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = getServiceDependencies(ctx)
      try {
        logger.info('API: Unified bulk thread update', {
          count: input.recordIds.length,
          updates: input.updates,
          userId,
          organizationId,
        })
        return await threadMutation.updateBulk(input.recordIds, input.updates as any)
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'threadMutation.updateBulk', {
          organizationId,
          userId,
          recordIds: input.recordIds,
          updates: input.updates,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed bulk updating threads.',
        })
      }
    }),

  /**
   * Unified remove endpoint for permanent thread deletion.
   * Accepts RecordId.
   */
  remove: protectedProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = getServiceDependencies(ctx)
      try {
        logger.warn('API: Unified thread removal (permanent delete)', {
          recordId: input.recordId,
          userId,
          organizationId,
        })
        return await threadMutation.remove(input.recordId)
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'threadMutation.remove', {
          organizationId,
          userId,
          recordId: input.recordId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed removing thread.',
        })
      }
    }),

  /**
   * Unified bulk remove endpoint for permanent thread deletion.
   * Accepts RecordIds.
   */
  removeBulk: protectedProcedure
    .input(z.object({ recordIds: z.array(recordIdSchema) }))
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = getServiceDependencies(ctx)
      try {
        logger.warn('API: Unified bulk thread removal (permanent delete)', {
          count: input.recordIds.length,
          userId,
          organizationId,
        })
        return await threadMutation.removeBulk(input.recordIds)
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'threadMutation.removeBulk', {
          organizationId,
          userId,
          recordIds: input.recordIds,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed bulk removing threads.',
        })
      }
    }),

  // ═══════════════════════════════════════════════════════════════

  getCounts: protectedProcedure.query(async ({ ctx }) => {
    const { userId, organizationId } = ctx.session
    const unreadService = new UnreadService(organizationId, userId)
    return await unreadService.getFullCounts()
  }),
  readStatus: protectedProcedure
    .input(
      z.object({
        threadId: z.union([z.string(), z.array(z.string())]),
        isRead: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const unreadService = new UnreadService(organizationId, userId)
      await unreadService.setReadStatus(input.threadId, input.isRead)
    }),
  /**
   * Retry sending a failed message
   * Delegates to MessageSenderService for proper retry handling
   */
  retrySendMessage: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { messageSender, organizationId, userId } = getServiceDependencies(ctx)
      try {
        logger.info('API: Retrying message send', {
          messageId: input.messageId,
          userId,
          organizationId,
        })
        // Delegate to service layer
        const result = await messageSender.retryFailedMessage({
          messageId: input.messageId,
          userId,
          organizationId,
        })
        logger.info('API: Message retry completed', {
          messageId: input.messageId,
          success: result.success,
          attemptNumber: result.attemptNumber,
        })
        return result
      } catch (error: unknown) {
        logger.error('API: Failed to retry message send', {
          messageId: input.messageId,
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined,
        })
        // Map service errors to tRPC codes
        if (error instanceof Error) {
          const message = error.message.toLowerCase()
          if (message.includes('not found')) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: error.message,
            })
          }
          if (message.includes('unauthorized')) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: error.message,
            })
          }
          if (message.includes('cannot retry') || message.includes('maximum retry')) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: error.message,
            })
          }
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retry message send',
        })
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // TICKET LINKING
  // ═══════════════════════════════════════════════════════════════

  linkToTicket: protectedProcedure
    .input(z.object({ threadId: z.string(), ticketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = getServiceDependencies(ctx)

      // Verify thread belongs to org
      const [thread] = await ctx.db
        .select({ id: schema.Thread.id })
        .from(schema.Thread)
        .where(
          and(
            eq(schema.Thread.id, input.threadId),
            eq(schema.Thread.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!thread) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })
      }

      // Verify ticket entity instance belongs to org
      const [ticket] = await ctx.db
        .select({ id: schema.EntityInstance.id })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, input.ticketId),
            eq(schema.EntityInstance.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!ticket) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
      }

      await ctx.db
        .update(schema.Thread)
        .set({ ticketId: input.ticketId })
        .where(eq(schema.Thread.id, input.threadId))

      logger.info('Thread linked to ticket', {
        threadId: input.threadId,
        ticketId: input.ticketId,
        userId,
        organizationId,
      })

      return { success: true }
    }),

  unlinkFromTicket: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = getServiceDependencies(ctx)

      // Verify thread belongs to org
      const [thread] = await ctx.db
        .select({ id: schema.Thread.id })
        .from(schema.Thread)
        .where(
          and(
            eq(schema.Thread.id, input.threadId),
            eq(schema.Thread.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!thread) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })
      }

      await ctx.db
        .update(schema.Thread)
        .set({ ticketId: null })
        .where(eq(schema.Thread.id, input.threadId))

      logger.info('Thread unlinked from ticket', {
        threadId: input.threadId,
        userId,
        organizationId,
      })

      return { success: true }
    }),
})
