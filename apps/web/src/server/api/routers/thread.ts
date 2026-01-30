// ~/server/api/routers/thread.ts ---
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { getUserOrganizationId } from '@auxx/lib/email' // Adjust import path if needed
import { createScopedLogger } from '@auxx/logger'
import { recordIdSchema } from '@auxx/types/resource'
import {
  DraftService,
  ThreadQueryService,
  ThreadMutationService,
  UnreadService,
  type ListThreadsInput,
  type ThreadSortDescriptor,
  type ListThreadIdsInput,
} from '@auxx/lib/threads' // Import service and its input type
import { ProviderRegistryService } from '@auxx/lib/providers'
import {
  MessageSenderService,
  ThreadManagerService,
  MessageComposerService,
} from '@auxx/lib/messages'
import { InternalFilterContextType, mapUrlSlugToStatusFilter } from '@auxx/lib/types' // Import context enum
import { IdentifierType, ThreadStatus as ThreadStatusEnum } from '@auxx/database/enums'
import { whereThreadMessageType, getMessageTypeFromProvider } from '@auxx/lib/providers'
const logger = createScopedLogger('thread-router')
// Captures the necessary information derived from various URL patterns
export const ThreadListInputSchema = z.object({
  limit: z.number().min(1).max(100).default(30),
  cursor: z.string().nullish(),
  searchQuery: z.string().optional(),
  // Context - Represents the primary view/scope
  contextType: z.enum([
    'personal_assigned', // /mail/assigned/*
    'personal_inbox', // /mail/inbox/*
    'drafts', // /mail/drafts
    'sent', // /mail/sent
    'tag', // /mail/tags/[id]/*
    'view', // /mail/views/[id]/*
    'all_inboxes', // /mail/inboxes/all/*
    'all',
    'specific_inbox', // /mail/inboxes/[id]/*
  ]),
  contextId: z.string().optional(), // Required for tag, view, specific_inbox
  // Status - Represents the refinement based on the last URL segment
  statusSlug: z.string().optional(), // e.g., "open", "done", "assigned", "unassigned"
  // Sorting options
  sortBy: z.enum(['newest', 'oldest', 'sender', 'subject']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
})
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
// Draft Upsert Input Schema
const UpsertDraftInputSchema = z.object({
  threadId: z.string().nullish(), // Optional: will create thread if not provided
  subject: z.string().nullish(),
  textHtml: z.string().nullish(),
  textPlain: z.string().nullish(),
  signatureId: z.string().nullish(),
  to: z.array(ParticipantInputSchema).optional(),
  cc: z.array(ParticipantInputSchema).optional(),
  bcc: z.array(ParticipantInputSchema).optional(),
  attachments: z.array(FileAttachmentSchema).optional(), // File attachments to attach
  integrationId: z.string(), // Required: which integration to use for draft context
  metadata: z.record(z.string(), z.unknown()).optional(), // Optional metadata object
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
  draftService: DraftService
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
  const threadManager = new ThreadManagerService(organizationId, ctx.db)
  const messageComposer = new MessageComposerService(organizationId, ctx.db)
  const messageSender = new MessageSenderService(organizationId, providerRegistry, ctx.db)
  // New specialized services
  const threadQuery = new ThreadQueryService(organizationId, ctx.db)
  const threadMutation = new ThreadMutationService(organizationId, ctx.db)
  // Updated draft service with new architecture
  const draftService = new DraftService(
    ctx.db,
    organizationId,
    userId,
    threadManager,
    messageComposer
  )
  return {
    // service,
    draftService,
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
   * Fetches a paginated list of threads based on context and status filters.
   * Updated to use ThreadQueryService.
   */
  list: protectedProcedure.input(ThreadListInputSchema).query(async ({ ctx, input }) => {
    const { threadQuery, organizationId, userId } = getServiceDependencies(ctx)

    const internalContextType =
      InternalFilterContextType[
        input.contextType.toUpperCase() as keyof typeof InternalFilterContextType
      ]
    if (!internalContextType) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Invalid context type provided: ${input.contextType}`,
      })
    }
    let contextForService: ListThreadsInput['context']
    const requiresContextId = [
      InternalFilterContextType.TAG,
      InternalFilterContextType.VIEW,
      InternalFilterContextType.SPECIFIC_INBOX,
    ].includes(internalContextType)
    if (requiresContextId) {
      if (!input.contextId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `contextId is required for context type '${input.contextType}'`,
        })
      }
      contextForService = { type: internalContextType, id: input.contextId }
    } else {
      // Use type assertion to help TypeScript understand the specific union member
      contextForService = { type: internalContextType } as ListThreadsInput['context']
    }
    const statusFilter = input.statusSlug ? mapUrlSlugToStatusFilter(input.statusSlug) : undefined
    if (input.statusSlug && !statusFilter) {
      logger.warn(`Unknown status slug received: '${input.statusSlug}', ignoring status filter.`)
      // Decide: throw error or proceed without status filter? Proceeding for now.
      // throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid status filter: ${input.statusSlug}`});
    }
    // Maps UI sort options to the shared descriptor contract understood by the service.
    const resolveSortDescriptor = (
      sortBy?: string,
      sortDirection?: string
    ): ThreadSortDescriptor | undefined => {
      switch (sortBy) {
        case 'newest':
          return { field: 'lastMessageAt', direction: 'desc' }
        case 'oldest':
          return { field: 'lastMessageAt', direction: 'asc' }
        case 'subject':
          return { field: 'subject', direction: sortDirection === 'desc' ? 'desc' : 'asc' }
        case 'sender':
          return { field: 'sender', direction: sortDirection === 'desc' ? 'desc' : 'asc' }
        default:
          return undefined
      }
    }

    const sortDescriptor = resolveSortDescriptor(input.sortBy, input.sortDirection)

    const serviceInput: ListThreadsInput = {
      userId, // Pass user ID for personal context filtering
      context: contextForService,
      statusFilter: statusFilter,
      searchQuery: input.searchQuery,
      ...(sortDescriptor ? { sort: sortDescriptor } : {}),
    }

    try {
      // Call the ThreadQueryService with the structured input
      logger.debug('Calling threadQuery.listThreads', {
        serviceInput,
        sortDescriptor: sortDescriptor ?? 'default',
      })
      const result = await threadQuery.listThreads(serviceInput, {
        limit: input.limit,
        cursor: input.cursor,
      })
      return result
    } catch (error: unknown) {
      // Pass relevant context to error handler
      handleServiceError(error, 'threadQuery.listThreads', { organizationId, userId, serviceInput })
      // handleServiceError should throw, but add fallback
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed fetching threads.' })
    }
  }),

  // ============================================================================
  // New ID-first batch-fetch endpoints (Phase 1 refactor)
  // ============================================================================

  /**
   * Returns only thread IDs with pagination info.
   * Frontend calls getByIds to batch-fetch metadata separately.
   */
  listIds: protectedProcedure
    .input(
      z.object({
        contextType: z.enum([
          'personal_assigned',
          'personal_inbox',
          'drafts',
          'sent',
          'tag',
          'view',
          'all_inboxes',
          'all',
          'specific_inbox',
        ]),
        contextId: z.string().optional(),
        statusSlug: z.string().optional(), // e.g., "open", "done", "assigned", "unassigned"
        filter: z
          .object({
            // Free text search
            search: z.string().optional(),
            // Participant filters
            from: z.array(z.string()).optional(),
            to: z.array(z.string()).optional(),
            // Entity ID filters
            tagIds: z.array(z.string()).optional(),
            assigneeIds: z.array(z.string()).optional(),
            inboxIds: z.array(z.string()).optional(),
            // Text field filters
            subject: z.string().optional(),
            body: z.string().optional(),
            // Status filters (read, unread, starred, etc.)
            is: z.array(z.string()).optional(),
            // Property filters
            hasAttachments: z.boolean().optional(),
            isUnread: z.boolean().optional(), // Legacy compat
            // Date filters (ISO string format)
            before: z.string().optional(),
            after: z.string().optional(),
          })
          .optional(),
        sortBy: z.enum(['newest', 'oldest', 'sender', 'subject']).optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const { threadQuery, organizationId, userId } = getServiceDependencies(ctx)

      // Map context type to internal enum
      const internalContextType =
        InternalFilterContextType[
          input.contextType.toUpperCase() as keyof typeof InternalFilterContextType
        ]
      if (!internalContextType) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid context type provided: ${input.contextType}`,
        })
      }

      // Build context for service
      let context: ListThreadIdsInput['context']
      const requiresContextId = [
        InternalFilterContextType.TAG,
        InternalFilterContextType.VIEW,
        InternalFilterContextType.SPECIFIC_INBOX,
      ].includes(internalContextType)

      if (requiresContextId) {
        if (!input.contextId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `contextId is required for context type '${input.contextType}'`,
          })
        }
        context = { type: internalContextType, id: input.contextId }
      } else {
        context = { type: internalContextType } as ListThreadIdsInput['context']
      }

      // Map sort options
      const resolveSortDescriptor = (
        sortBy?: string,
        sortDirection?: string
      ): ThreadSortDescriptor | undefined => {
        switch (sortBy) {
          case 'newest':
            return { field: 'lastMessageAt', direction: 'desc' }
          case 'oldest':
            return { field: 'lastMessageAt', direction: 'asc' }
          case 'subject':
            return { field: 'subject', direction: sortDirection === 'desc' ? 'desc' : 'asc' }
          case 'sender':
            return { field: 'sender', direction: sortDirection === 'desc' ? 'desc' : 'asc' }
          default:
            return undefined
        }
      }

      // Map status to internal filter
      // Prefer filter.is (from searchbar conditions) over statusSlug (from URL)
      let statusFilter: ReturnType<typeof mapUrlSlugToStatusFilter> | undefined
      if (input.filter?.is && input.filter.is.length > 0) {
        // Convert filter.is values to statusFilter (e.g., 'unassigned' -> { hasAssignee: false, status: 'OPEN' })
        statusFilter = mapUrlSlugToStatusFilter(input.filter.is[0])
      } else if (input.statusSlug) {
        statusFilter = mapUrlSlugToStatusFilter(input.statusSlug)
      }

      const serviceInput: ListThreadIdsInput = {
        context,
        userId,
        statusFilter,
        filter: input.filter,
        sort: resolveSortDescriptor(input.sortBy, input.sortDirection),
        cursor: input.cursor,
        limit: input.limit,
      }

      try {
        logger.debug('Calling threadQuery.listThreadIds', { serviceInput })
        return await threadQuery.listThreadIds(serviceInput)
      } catch (error: unknown) {
        handleServiceError(error, 'threadQuery.listThreadIds', { organizationId, userId })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed fetching thread IDs.' })
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed fetching thread metadata.' })
      }
    }),

  /**
   * Get a single thread by ID.
   * Updated to use ThreadQueryService.
   */
  getById: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { threadQuery, organizationId, userId } = getServiceDependencies(ctx)
      try {
        const thread = await threadQuery.getThreadById(input.threadId, userId) // Service handles org scoping
        if (!thread) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Thread '${input.threadId}' not found.`,
          })
        }

        // Add computed messageType field for backward compatibility
        const messageType = thread.integration?.provider
          ? getMessageTypeFromProvider(thread.integration.provider as any)
          : 'EMAIL'

        // Also add messageType to each message for consistency
        const messagesWithType = thread.messages?.map(msg => ({
          ...msg,
          messageType,  // All messages in a thread share the same type
        })) ?? []

        return {
          ...thread,
          messageType,
          messages: messagesWithType,
        }
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error // Re-throw known TRPC errors
        handleServiceError(error, 'threadQuery.getThreadById', {
          organizationId: organizationId,
          userId: ctx.session.user.id,
          threadId: input.threadId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed fetching thread details.',
        }) // Fallback
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
   * Creates or updates a private draft message.
   */
  createOrUpdateDraft: protectedProcedure
    .input(UpsertDraftInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { draftService, organizationId, userId } = getServiceDependencies(ctx)
      try {
        logger.info('API: Upserting draft', {
          userId,
          threadId: input.threadId,
          integrationId: input.integrationId,
        })
        const draftMessage = await draftService.createOrUpdateDraft(input)
        return draftMessage
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'createOrUpdateDraft', {
          organizationId,
          userId,
          threadId: input.threadId,
        })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save draft.' })
      }
    }),
  /**
   * Deletes a private draft message.
   */
  deleteDraft: protectedProcedure
    .input(z.object({ draftMessageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { draftMessageId } = input
      try {
        const { draftService } = getServiceDependencies(ctx)
        logger.info('API: Deleting draft', { userId, draftMessageId })
        const result = await draftService.deleteDraft(draftMessageId)
        return result
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'deleteDraft', {
          organizationId,
          userId,
          draftMessageId,
        })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete draft.' })
      }
    }),

  // ============================================================================
  // Draft Query Endpoints (Phase 2 additions)
  // ============================================================================

  /**
   * Check if a thread has a draft for the current user.
   */
  hasDraft: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { draftService } = getServiceDependencies(ctx)
      return await draftService.hasDraft(input.threadId)
    }),

  /**
   * Get draft ID for a thread (for the current user).
   */
  getDraftId: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { draftService } = getServiceDependencies(ctx)
      return await draftService.getDraftId(input.threadId)
    }),

  /**
   * Batch check which threads have drafts for the current user.
   * Returns array of thread IDs that have drafts.
   */
  getThreadsWithDrafts: protectedProcedure
    .input(z.object({ threadIds: z.array(z.string()).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const { draftService } = getServiceDependencies(ctx)
      const set = await draftService.getThreadsWithDrafts(input.threadIds)
      return Array.from(set) // Return as array for JSON serialization
    }),

  /**
   * Sends an email message, potentially from a draft.
   * Updated to use MessageSenderService directly.
   */
  sendMessage: protectedProcedure.input(SendMessageInputSchema).mutation(async ({ ctx, input }) => {
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
      // Transform input to MessageSenderService format
      const senderInput = {
        userId,
        organizationId,
        integrationId,
        threadId,
        subject,
        textHtml: textHtml || undefined,
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
        draftMessageId: draftMessageId || undefined,
        attachmentIds: attachments?.map((att) => att.id) || undefined, // Map attachments to IDs
      }
      logger.info('API: Sending message via MessageSenderService', {
        userId,
        threadId: input.threadId,
        draftId: input.draftMessageId,
      })
      const sentMessage = await messageSender.sendMessage(senderInput)
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
   * Tag multiple threads in bulk
   * Updated to use ThreadMutationService.
   */
  tagBulk: protectedProcedure
    .input(
      z.object({
        threadIds: z.array(z.string()),
        tagIds: z.array(z.string()),
        operation: z.enum(['add', 'remove', 'set']).default('add'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { threadMutation, organizationId, userId } = getServiceDependencies(ctx)
      try {
        logger.info('API: Bulk tagging threads', {
          threadCount: input.threadIds.length,
          tagCount: input.tagIds.length,
          operation: input.operation,
          userId,
          organizationId,
        })
        // Call the service method to bulk tag threads
        const result = await threadMutation.tagThreadsBulk(
          input.threadIds,
          input.tagIds,
          input.operation
        )
        return result
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        handleServiceError(error, 'threadMutation.tagThreadsBulk', {
          organizationId,
          userId,
          threadIds: input.threadIds,
          tagIds: input.tagIds,
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
          status: z.enum(['OPEN', 'ARCHIVED', 'SPAM', 'TRASH']).optional(),
          subject: z.string().optional(),
          assigneeId: z.string().nullable().optional(),
          inboxId: z.string().optional(),
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
          status: z.enum(['OPEN', 'ARCHIVED', 'SPAM', 'TRASH']).optional(),
          assigneeId: z.string().nullable().optional(),
          inboxId: z.string().optional(),
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
    return await unreadService.getUnreadCountsForUser()
  }),
  markAsRead: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const unreadService = new UnreadService(organizationId, userId)
      await unreadService.markThreadAsRead(input.threadId)
    }),
  markAsUnread: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const unreadService = new UnreadService(organizationId, userId)
      await unreadService.markThreadAsUnread(input.threadId)
    }),
  // Mark multiple threads as read
  markBatchRead: protectedProcedure
    .input(z.object({ threadIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const unreadService = new UnreadService(organizationId, userId)
      await unreadService.markMultipleThreads(input.threadIds, 'read')
    }),
  // Mark multiple threads as unread
  markBatchUnread: protectedProcedure
    .input(z.object({ threadIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const unreadService = new UnreadService(organizationId, userId)
      await unreadService.markMultipleThreads(input.threadIds, 'unread')
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
})
