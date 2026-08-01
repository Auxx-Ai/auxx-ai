// ~/server/api/routers/thread.ts ---

import { schema } from '@auxx/database'
import { IdentifierType } from '@auxx/database/enums'
import { getCachedEntityDefId, getCachedUserInstanceGrants } from '@auxx/lib/cache'
import { conditionGroupsSchema } from '@auxx/lib/conditions'
import { DraftService } from '@auxx/lib/drafts'
import { getUserOrganizationId } from '@auxx/lib/email' // Adjust import path if needed
import { BadRequestError } from '@auxx/lib/errors'
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
import { markInvoiceSent, markQuoteSent, recordDocumentSendSignal } from '@auxx/lib/money'
import { PermissionKey } from '@auxx/lib/permissions'
import type { UserInstanceGrants } from '@auxx/lib/permissions/visibility'
import { buildPlaceholderContextForThread, resolvePlaceholdersInHtml } from '@auxx/lib/placeholders'
import { ProviderRegistryService } from '@auxx/lib/providers'
import {
  canLinkThread,
  getMailCounts,
  type ListThreadIdsInput,
  linkEntityToThread,
  returnThreadToAi,
  ThreadMergeService,
  ThreadMutationService,
  ThreadQueryService,
  takeOverThread,
  UnreadService,
} from '@auxx/lib/threads'
import { createScopedLogger } from '@auxx/logger'
import { getInstanceId, recordIdSchema } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, isAuxxError, notDemo, permissionProcedure } from '~/server/api/trpc'
import { assertSignatureUsable } from '~/server/lib/signature-instance-access'

const logger = createScopedLogger('thread-router')

/**
 * The mail front door (plan 40 §5.3): **every** `thread.*` procedure — list,
 * read, mutate, send, merge, link, handoff — gates on the same coarse
 * `inboxes.view` rung and nothing finer. Before this slice every one of them was
 * a bare `protectedProcedure` with no `PermissionKey` anywhere in the file, so
 * "may this profile use mail at all" was inexpressible (§0.1) and a worker seat
 * read and replied to every org inbox.
 *
 * Deliberately coarse, and deliberately **not** per-inbox:
 *
 *  - There is **no thread-authority axis** (§1.1, user decision). If you can see
 *    a thread at `full` lens you may do everything to it. The first draft's
 *    per-procedure tier table (triage at Read, send at Edit, drafts split) is
 *    cancelled — everything finer than this door is question 4's job, and
 *    `ThreadMutationService.assertCanActOnThreads` already does it.
 *  - **No inbox-instance filter or assert belongs on any thread procedure**
 *    (§1.4). In a dispatch org the assignee holds no `ResourceAccess` row on the
 *    inbox by construction, so an instance gate would deny exactly the people
 *    the model exists to serve. The lens predicate seeds
 *    `Thread.assigneeId === userId` (`visibility-scope.ts`), so assigned threads
 *    survive any inbox exclusion.
 *  - A member at area `None` holding ONE explicit inbox `view` row still gets
 *    in: `composeUserCapabilities` synthesizes `inboxes.view` from their instance
 *    grants (plan 25 §2 / `INSTANCE_ACCESS_READ_KEYS`), and they then see exactly
 *    that inbox. The derived key is a front door, never an instance answer.
 *
 * `inboxes.view` carries no `featureKey`, so `permissionProcedure`'s plan-AND is
 * a no-op here; the `granularPermissions` plan gate lives on the SHARING path
 * (`mail-sharing-guard.ts`), not on using mail.
 */
const mailProcedure = permissionProcedure(PermissionKey.inboxesView)

/**
 * Route an `isUnread` field peeled off a unified thread update to the
 * UnreadService, which owns read-state storage, sidebar count deltas, and
 * realtime fan-out (with socket-id echo-suppression). `isUnread` is the inverse
 * of the service's `isRead`. This keeps read/unread on the single
 * `update`/`updateBulk` write path while the actual work stays in one service.
 */
async function setThreadsReadFromUpdates(
  ctx: {
    session: { userId: string; organizationId: string }
    headers?: { get?: (key: string) => string | null }
  },
  threadIds: string[],
  isUnread: boolean
): Promise<void> {
  const { userId, organizationId } = ctx.session
  const socketId = ctx.headers?.get?.('x-realtime-socket-id') ?? undefined
  const viewer = await getCachedUserInstanceGrants(userId, organizationId)
  const unreadService = new UnreadService(organizationId, userId, viewer, socketId)
  await unreadService.setReadStatus(threadIds, !isUnread)
}

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
//
// `subject` and `to` are nullable/empty here — the capability-driven
// `MessageSenderService.validateInput` enforces them per provider so chat
// (no subject, no recipients) passes through cleanly.
const SendMessageInputSchema = z.object({
  threadId: z.string().optional(), // Allow creating new threads
  integrationId: z.string(), // Required: Which inbox is sending?
  subject: z.string().nullish(),
  textHtml: z.string().nullish(),
  textPlain: z.string().nullish(),
  signatureId: z.string().nullish(),
  to: z.array(ParticipantInputSchema).default([]),
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
 * Loads the caller's cached mail-visibility context once per request — every
 * service reads through that viewer (mail-permissions §5.4).
 * Throws TRPCError if organizationId is not found.
 */
const getServiceDependencies = async (
  ctx: any
): Promise<{
  threadQuery: ThreadQueryService
  threadMutation: ThreadMutationService
  messageSender: MessageSenderService
  viewer: UserInstanceGrants
  organizationId: string
  userId: string
  socketId: string | undefined
}> => {
  const userId = ctx.session.user.id as string
  const organizationId = getUserOrganizationId(ctx.session)
  if (!organizationId) {
    logger.error('Organization ID not found for user', { userId })
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User organization context not found.' })
  }
  // Realtime self-echo suppression — see plans/realtime/mail/plan.md §2.4.
  const socketId = ctx.headers?.get?.('x-realtime-socket-id') ?? undefined
  const viewer = await getCachedUserInstanceGrants(userId, organizationId)
  // Instantiate new modular services
  const providerRegistry = new ProviderRegistryService(organizationId)
  const messageSender = new MessageSenderService(
    organizationId,
    providerRegistry,
    ctx.db,
    socketId,
    viewer
  )
  // New specialized services
  const threadQuery = new ThreadQueryService(organizationId, ctx.db, viewer)
  const threadMutation = new ThreadMutationService(organizationId, ctx.db, socketId, userId, viewer)
  return {
    threadQuery,
    threadMutation,
    messageSender,
    viewer,
    organizationId,
    userId,
    socketId,
  }
}
/**
 * Centralized error handler for service calls.
 * Logs the error and throws an appropriate TRPCError.
 *
 * Every `thread.*` catch funnels through here, so the `AuxxError` passthrough
 * below is the whole file's fix (plan 44 §1.3 / §1.4): a service refusal —
 * `UnreadService.setReadStatus`'s `ForbiddenError` on a sub-`full` thread, and
 * every other authorization throw in the thread services — used to be flattened
 * into `INTERNAL_SERVER_ERROR` right here, so a 403 reached the client as
 * "An unexpected error occurred in <procedure>". Rethrown untouched, it reaches
 * `auxxErrorMiddleware`, which maps `statusCode` to the real tRPC code.
 */
const handleServiceError = (
  error: unknown,
  procedureName: string,
  context: Record<string, any>
) => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  const stack = error instanceof Error ? error.stack : undefined
  logger.error(`Error in ${procedureName}`, { ...context, error: message, stack })
  if (isAuxxError(error)) throw error
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
  listIds: mailProcedure
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
      const { threadQuery, organizationId, userId } = await getServiceDependencies(ctx)

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
  getByIds: mailProcedure
    .input(
      z.object({
        ids: z.array(z.string()).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { threadQuery, organizationId, userId } = await getServiceDependencies(ctx)

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

  /**
   * Sends an email message, potentially from a draft.
   * Updated to use MessageSenderService directly.
   */
  sendMessage: mailProcedure
    .input(SendMessageInputSchema)
    .use(notDemo('send emails'))
    .mutation(async ({ ctx, input }) => {
      // Instance access (plan 36 §5) — BEFORE the try, which flattens to a 500.
      // `signatureId` arrives as an arbitrary client string and is forwarded to
      // `appendSignature`, whose only scope is the org; without this a member can
      // read any other member's private signature body by sending with its id.
      await assertSignatureUsable({
        db: ctx.db,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        signatureId: input.signatureId,
      })

      try {
        const { messageSender, organizationId, userId } = await getServiceDependencies(ctx)
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

        // Auto-link thread to ticket if linkTicketId is provided.
        // Uses linkEntityToThread so primary swaps demote the prior primary
        // atomically and entityDefinitionId is read from EntityInstance.
        if (input.linkTicketId && sentMessage.threadId) {
          try {
            await linkEntityToThread({
              threadId: sentMessage.threadId,
              entityInstanceId: input.linkTicketId,
              role: 'primary',
              organizationId,
              actorId: userId,
            })
            logger.info('Auto-linked new thread to ticket', {
              threadId: sentMessage.threadId,
              ticketId: input.linkTicketId,
            })

            // Confirmed-send status flip (money MQ2 build spec §E.3; MI1 §H.3 adds the
            // invoice branch) — only reached once the primary link above has actually
            // succeeded (no flip-without-timeline-evidence).
            try {
              const linkedInstance = await ctx.db.query.EntityInstance.findFirst({
                columns: { entityDefinitionId: true },
                where: (t, { eq: eqCol }) => eqCol(t.id, input.linkTicketId as string),
              })
              const quoteDefId = await getCachedEntityDefId(organizationId, 'quote')
              if (
                linkedInstance &&
                quoteDefId &&
                linkedInstance.entityDefinitionId === quoteDefId
              ) {
                try {
                  await markQuoteSent({
                    organizationId,
                    userId,
                    quoteInstanceId: input.linkTicketId,
                  })
                } catch (flipError) {
                  // markQuoteSent asserts status === 'draft' — a BadRequestError here
                  // means the quote was already sent (resend) or otherwise not a
                  // draft; that's the expected idempotent no-op, not a failure.
                  if (!(flipError instanceof BadRequestError)) throw flipError
                }

                // Communications-view signal (client-notifications plan §4.8/Phase 4) — a
                // CONFIRMED send (incl. a resend) writes one row per message, regardless of
                // whether the status flip above was a no-op. Never throws.
                if (sentMessage.sendStatus === 'SENT') {
                  await recordDocumentSendSignal({
                    organizationId,
                    userId,
                    documentType: 'quote',
                    documentInstanceId: input.linkTicketId,
                    messageId: sentMessage.id,
                    threadId: sentMessage.threadId,
                    subject: input.subject ?? 'Quote sent',
                  })
                }
              }

              const invoiceDefId = await getCachedEntityDefId(organizationId, 'invoice')
              if (
                linkedInstance &&
                invoiceDefId &&
                linkedInstance.entityDefinitionId === invoiceDefId
              ) {
                try {
                  await markInvoiceSent({
                    organizationId,
                    userId,
                    invoiceInstanceId: input.linkTicketId,
                  })
                } catch (flipError) {
                  // markInvoiceSent asserts status === 'draft' — a BadRequestError here
                  // means the invoice was already sent (resend) or otherwise not a
                  // draft; that's the expected idempotent no-op, not a failure.
                  if (!(flipError instanceof BadRequestError)) throw flipError
                }

                // Communications-view signal — see the quote branch above for rationale.
                if (sentMessage.sendStatus === 'SENT') {
                  await recordDocumentSendSignal({
                    organizationId,
                    userId,
                    documentType: 'invoice',
                    documentInstanceId: input.linkTicketId,
                    messageId: sentMessage.id,
                    threadId: sentMessage.threadId,
                    subject: input.subject ?? 'Invoice sent',
                  })
                }
              }
            } catch (statusFlipError) {
              logger.error('Failed to flip quote/invoice status to sent after send', {
                threadId: sentMessage.threadId,
                ticketId: input.linkTicketId,
                error:
                  statusFlipError instanceof Error
                    ? statusFlipError.message
                    : String(statusFlipError),
              })
            }
          } catch (linkError) {
            // Non-fatal: message was sent, link failure is acceptable. Logged at
            // error level (money MQ2 §E.3) — for document sends the status flip
            // depends on this link succeeding, so this is no longer a routine miss.
            logger.error('Failed to auto-link thread to ticket', {
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
  cancelScheduledMessage: mailProcedure
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
  getScheduledMessages: mailProcedure
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
  updateScheduledMessage: mailProcedure
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
  tagBulk: mailProcedure
    .input(
      z.object({
        recordIds: z.array(recordIdSchema),
        relatedRecordIds: z.array(recordIdSchema),
        operation: z.enum(['add', 'remove', 'set']).default('add'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = await getServiceDependencies(ctx)
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
  update: mailProcedure
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
          // Merge routing: when present, the lib service redirects to ThreadMergeService.
          mergedIntoThreadId: recordIdSchema.nullable().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = await getServiceDependencies(ctx)
      // Read/unread is stored & fanned out by UnreadService — peel it off the
      // unified payload and forward any remaining field updates to the service.
      const { isUnread, ...rest } = input.updates
      try {
        logger.info('API: Unified thread update', {
          recordId: input.recordId,
          updates: input.updates,
          userId,
          organizationId,
        })
        if (isUnread !== undefined) {
          await setThreadsReadFromUpdates(ctx, [getInstanceId(input.recordId)], isUnread)
        }
        if (Object.keys(rest).length > 0) {
          return await threadMutation.update(input.recordId, rest as any)
        }
        return {
          id: getInstanceId(input.recordId),
          success: true,
          updatedFields: input.updates,
          timestamp: new Date(),
        }
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
   * Explicit "Remember this thread" — force-enqueues a learned-KB extraction
   * for the thread, bypassing the resolve-trigger noise gates and the
   * `learnedExtractedAt` dedupe. The proposal lands in Today as usual.
   */
  rememberThread: mailProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { threadQuery, organizationId, userId } = await getServiceDependencies(ctx)
      const { FeaturePermissionService, FeatureKey } = await import('@auxx/lib/permissions')
      await new FeaturePermissionService(ctx.db).requireAccess(
        organizationId,
        FeatureKey.learnedMemory
      )
      const threadId = getInstanceId(input.recordId)
      try {
        // Visibility check — the viewer must be able to see the thread.
        const [meta] = await threadQuery.getThreadMetaBatch([threadId], userId)
        if (!meta) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found.' })
        }
        const { enqueueLearnedExtraction } = await import('@auxx/lib/jobs')
        // `requestedByUserId` is what makes the run possible at all: capture
        // runs bind to a human member, and most threads have no assignee to
        // derive one from. It also routes the proposal to this member's feed.
        await enqueueLearnedExtraction({
          organizationId,
          threadId,
          force: true,
          requestedByUserId: userId,
        })
        return { success: true }
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'rememberThread', { organizationId, userId, threadId })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to enqueue.' })
      }
    }),

  /**
   * Unified bulk update endpoint for multiple threads.
   * Accepts RecordIds and partial ThreadUpdates.
   */
  updateBulk: mailProcedure
    .input(
      z.object({
        recordIds: z
          .array(recordIdSchema)
          .max(500, 'You can update up to 500 conversations at once.'),
        updates: z.object({
          status: z.enum(['OPEN', 'ARCHIVED', 'SPAM', 'TRASH', 'IGNORED']).optional(),
          assigneeId: z.string().nullable().optional(),
          inboxId: recordIdSchema.nullable().optional(),
          ticketId: recordIdSchema.nullable().optional(),
          isUnread: z.boolean().optional(),
          mergedIntoThreadId: recordIdSchema.nullable().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = await getServiceDependencies(ctx)
      // Read/unread routes through UnreadService; forward the rest (if any).
      const { isUnread, ...rest } = input.updates
      try {
        logger.info('API: Unified bulk thread update', {
          count: input.recordIds.length,
          updates: input.updates,
          userId,
          organizationId,
        })
        if (isUnread !== undefined) {
          const threadIds = input.recordIds.map((recordId) => getInstanceId(recordId))
          await setThreadsReadFromUpdates(ctx, threadIds, isUnread)
        }
        if (Object.keys(rest).length > 0) {
          return await threadMutation.updateBulk(input.recordIds, rest as any)
        }
        return { count: input.recordIds.length }
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
  remove: mailProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = await getServiceDependencies(ctx)
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
  removeBulk: mailProcedure
    .input(z.object({ recordIds: z.array(recordIdSchema) }))
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = await getServiceDependencies(ctx)
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

  /**
   * Unmerge every source from a single merge batch. Used by the "Undo merge"
   * action on the target's collapsed merge timeline entry — needs a batchId,
   * which isn't a Thread field, so this stays as its own dedicated procedure.
   */
  unmergeBatch: mailProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = await getServiceDependencies(ctx)
      const service = new ThreadMergeService(ctx.db, organizationId, userId)
      try {
        await service.unmergeBatch(input.batchId, userId)
        return { success: true }
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'threadMerge.unmergeBatch', {
          organizationId,
          userId,
          batchId: input.batchId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to unmerge batch.',
        })
      }
    }),

  // ═══════════════════════════════════════════════════════════════

  getCounts: mailProcedure.query(async ({ ctx }) => {
    const { userId, organizationId } = ctx.session
    return await getMailCounts(organizationId, userId)
  }),
  /**
   * Retry sending a failed message
   * Delegates to MessageSenderService for proper retry handling
   */
  retrySendMessage: mailProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { messageSender, organizationId, userId } = await getServiceDependencies(ctx)
      try {
        // Retry isn't meaningful for chat — there's no external provider state
        // to reconcile, and the realtime publish is fire-and-forget on send.
        // Short-circuit with a typed 4xx so the frontend can hide the Retry UI
        // on chat bubbles.
        const [row] = await ctx.db
          .select({ provider: schema.Integration.provider })
          .from(schema.Message)
          .innerJoin(schema.Integration, eq(schema.Integration.id, schema.Message.integrationId))
          .where(eq(schema.Message.id, input.messageId))
          .limit(1)
        if (row?.provider === 'chat') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'chat_retry_unsupported',
          })
        }
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
        // Already-typed throws pass straight through: the `chat_retry_unsupported`
        // BAD_REQUEST above matches none of the message sniffs below and would
        // otherwise be re-wrapped as a 500 (plan 44 §1.4).
        if (error instanceof TRPCError) throw error
        if (isAuxxError(error)) throw error
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

  linkToTicket: mailProcedure
    .input(z.object({ threadId: z.string(), ticketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId, viewer } = await getServiceDependencies(ctx)

      // §7: linking requires `full` lens; invisible reads as nonexistent.
      if (!(await canLinkThread(ctx.db, organizationId, viewer, input.threadId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })
      }

      try {
        await linkEntityToThread({
          threadId: input.threadId,
          entityInstanceId: input.ticketId,
          role: 'primary',
          organizationId,
          actorId: userId,
        })
      } catch (error) {
        if (isAuxxError(error)) throw error
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })
      }

      logger.info('Thread linked to ticket', {
        threadId: input.threadId,
        ticketId: input.ticketId,
        userId,
        organizationId,
      })

      return { success: true }
    }),

  // ═══════════════════════════════════════════════════════════════
  // CHAT HANDOFF (P4.2)
  // Take-over / return-to-AI flips `Thread.handoffState`. The chat agent
  // run is gated on this in `ChatProvider.maybeEnqueueAgentRun`. Events
  // and realtime publishes land in P4.3.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Flip a chat thread to human-driven mode. Assigns the caller and sets
   * `handoffState = 'human'` in one update so the AI gate sees a consistent
   * snapshot. Does NOT publish thread events — that's P4.3.
   */
  takeOver: mailProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId, viewer } = await getServiceDependencies(ctx)
      // §7: take-over is self-assignment — a sub-`full` viewer must not be
      // able to raise their own lens through it.
      if (!(await canLinkThread(ctx.db, organizationId, viewer, input.threadId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })
      }
      const result = await takeOverThread({
        db: ctx.db,
        threadId: input.threadId,
        organizationId,
        userId,
      })
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      return result.value
    }),

  /**
   * Hand the thread back to the AI agent. Leaves `assigneeId` set so the
   * "last human to touch this" audit trail is preserved.
   */
  returnToAi: mailProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId, viewer } = await getServiceDependencies(ctx)
      if (!(await canLinkThread(ctx.db, organizationId, viewer, input.threadId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })
      }
      const result = await returnThreadToAi({
        db: ctx.db,
        threadId: input.threadId,
        organizationId,
        userId,
      })
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.error.message })
      }
      return result.value
    }),

  unlinkFromTicket: mailProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId, viewer } = await getServiceDependencies(ctx)

      // §7 gate replaces the bare org-scope existence check: unlinking
      // requires `full` lens; invisible reads as nonexistent.
      if (!(await canLinkThread(ctx.db, organizationId, viewer, input.threadId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })
      }

      await ctx.db
        .update(schema.Thread)
        .set({ primaryEntityInstanceId: null, primaryEntityDefinitionId: null })
        .where(eq(schema.Thread.id, input.threadId))

      logger.info('Thread unlinked from ticket', {
        threadId: input.threadId,
        userId,
        organizationId,
      })

      return { success: true }
    }),

  // ═══════════════════════════════════════════════════════════════
  // CHAT THREAD LIFECYCLE EVENTS (P4b-i)
  // Centered system-line feed for the admin chat panel: takeover,
  // return-to-AI, archive, reopen, assignee changed, visitor identified.
  // Uses the `Event_threadId_expr_idx` expression index on
  // `(Event.data->>'threadId')` added in #664.
  // ═══════════════════════════════════════════════════════════════
  listEvents: mailProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = await getServiceDependencies(ctx)
      const rows = await ctx.db
        .select({
          id: schema.Event.id,
          type: schema.Event.type,
          createdAt: schema.Event.createdAt,
          data: schema.Event.data,
        })
        .from(schema.Event)
        .where(
          and(
            eq(schema.Event.organizationId, organizationId),
            inArray(schema.Event.type, [
              'thread:taken_over',
              'thread:returned_to_ai',
              'thread:archived',
              'thread:reopened',
              'thread:assignee:changed',
              'thread:visitor:identified',
            ]),
            sql`(${schema.Event.data}->>'threadId') = ${input.threadId}`
          )
        )
        .orderBy(asc(schema.Event.createdAt))
        .limit(50)

      return rows.map((r) => ({
        id: r.id,
        type: r.type as
          | 'thread:taken_over'
          | 'thread:returned_to_ai'
          | 'thread:archived'
          | 'thread:reopened'
          | 'thread:assignee:changed'
          | 'thread:visitor:identified',
        createdAt: r.createdAt.toISOString(),
        data: (r.data ?? {}) as Record<string, unknown>,
      }))
    }),
})
