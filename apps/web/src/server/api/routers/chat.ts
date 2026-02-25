// src/server/api/routers/chat.ts

import { database as db } from '@auxx/database'
import { createChatService } from '@auxx/lib/chat'
import { findMemberByUser } from '@auxx/lib/members'
import { RealTimeService } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure, publicProcedure } from '~/server/api/trpc' // Use publicProcedure for initialization

const logger = createScopedLogger('chat-router')

export const chatRouter = createTRPCRouter({
  /**
   * Initialize a new chat session from an embedded widget.
   */

  initialize: publicProcedure
    .input(
      z.object({
        integrationId: z.string(),
        visitorId: z.string().optional().nullable(),
        sessionId: z.string().optional(),
        threadId: z.string().optional(),
        userAgent: z.string().optional(),
        referrer: z.string().optional(),
        url: z.string().optional(),
        ipAddress: z.string().optional(), // Consider getting IP from request context instead
        visitorName: z.string().optional(),
        visitorEmail: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Use chatService from context if available, otherwise create instance
      const realtimeService = new RealTimeService()
      const chatService = createChatService(db, realtimeService)
      // Assuming direct creation for this example:

      logger.info('TRPC: chat.initialize called', { input })

      try {
        // Call the refactored service method
        const result = await chatService.initializeOrResumeSession({
          integrationId: input.integrationId,
          visitorId: input.visitorId,
          sessionId: input.sessionId,
          threadId: input.threadId,
          userAgent: input.userAgent,
          referrer: input.referrer,
          url: input.url,
          ipAddress: input.ipAddress, // Get IP from context if possible
          visitorName: input.visitorName,
          visitorEmail: input.visitorEmail,
        })

        // Return the result directly, it already matches the expected structure
        logger.info('TRPC: chat.initialize successful', {
          sessionId: result.sessionId,
          isNew: result.isNewSession,
        })
        return result
      } catch (error: any) {
        // Log the error from the service or TRPC layer
        logger.error('TRPC: chat.initialize failed', {
          error: error.message,
          input,
          code: error instanceof TRPCError ? error.code : 'UNKNOWN',
        })

        // Re-throw TRPCError or wrap other errors
        if (error instanceof TRPCError) {
          throw error
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to initialize chat session.',
          cause: error, // Keep original error cause if needed
        })
      }
    }),

  /**
   * Send a message from the chat widget
   */
  sendMessage: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        content: z.string().min(1, 'Message cannot be empty'),
        clientMessageId: z.string().optional(),
        attachmentIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      logger.info('Widget sending message', {
        sessionId: input.sessionId,
        clientMessageId: input.clientMessageId,
      })

      try {
        const realtimeService = new RealTimeService()

        const chatService = createChatService(db, realtimeService)

        const session = await chatService.getSession(input.sessionId) // Use chatService's getSession

        // Check if the user is authenticated
        // Verify the chat session exists and is active
        // const session = await db.chatSession.findUnique({
        //   where: { id: input.sessionId, status: 'ACTIVE' },
        //   select: { id: true, organizationId: true, threadId: true },
        // })

        if (!session || session.status === 'closed') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found or inactive' })
        }
        if (!session.threadId) {
          // This should ideally not happen after the initialize fix, but handle defensively
          logger.error('Session found but missing threadId, cannot send message', {
            sessionId: input.sessionId,
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Cannot send message, session configuration error.',
          })
        }

        // Create chat service for processing the message
        // const chatService = createChatService(db)

        // Send the message using the chat service
        if (!session.threadId) {
          // This should ideally not happen after the initialize fix, but handle defensively
          logger.error('Session found but missing threadId, cannot send message', {
            sessionId: input.sessionId,
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Cannot send message, session configuration error.',
          })
        }
        const message = await chatService.sendUserMessage({
          sessionId: input.sessionId,
          threadId: session.threadId, // Pass the threadId from the fetched session
          content: input.content,
          clientMessageId: input.clientMessageId,
          // attachmentIds: input.attachmentIds, // Pass if implemented
        })

        return { messageId: message.id, status: message.status, createdAt: message.createdAt }

        // Return success with the message details
        // return {
        //   messageId: message.id,
        //   status: 'sent',
        //   timestamp: message.createdAt,
        // }
      } catch (error: any) {
        logger.error('Failed to send message', { error: error.message, sessionId: input.sessionId })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send message' })
      }
    }),
  /**
   * Upload a file attachment for a chat
   */
  uploadAttachment: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        fileName: z.string(),
        fileType: z.string(),
        fileSize: z.number(),
        fileBuffer: z.any(), // This would be properly handled with a buffer type
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const realtimeService = new RealTimeService()

        const chatService = createChatService(db, realtimeService)

        const attachment = await chatService.uploadAttachment({
          sessionId: input.sessionId,
          fileName: input.fileName,
          fileType: input.fileType,
          fileSize: input.fileSize,
          fileBuffer: input.fileBuffer,
        })

        return { id: attachment.id, url: attachment.url, originalName: input.fileName }
      } catch (error) {
        logger.error('Failed to upload attachment', { error, input })

        if (error instanceof Error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
            cause: error,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to upload attachment',
        })
      }
    }),

  /**
   * Get chat history for a session
   */
  getChatHistory: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const realtimeService = new RealTimeService()

        const chatService = createChatService(db, realtimeService)

        const messages = await chatService.getMessages(input.sessionId)

        return { messages }
      } catch (error) {
        logger.error('Failed to get chat history', { error, input })

        if (error instanceof Error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
            cause: error,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get chat history',
        })
      }
    }),

  /**
   * Update visitor information
   */
  updateVisitorInfo: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        name: z.string().optional(),
        email: z.email().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const realtimeService = new RealTimeService()

        const chatService = createChatService(db, realtimeService)

        await chatService.updateVisitorInfo(input.sessionId, {
          name: input.name,
          email: input.email,
          metadata: input.metadata,
        })

        return { success: true }
      } catch (error) {
        logger.error('Failed to update visitor info', { error, input })

        if (error instanceof Error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
            cause: error,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update visitor info',
        })
      }
    }),

  /**
   * Agent-only: Get a list of chat sessions
   */
  getActiveSessions: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        status: z.enum(['ACTIVE', 'CLOSED', 'ALL']).default('ACTIVE'),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        // Check if user has access to the organization
        const membership = await findMemberByUser(input.organizationId, ctx.session.user.id)

        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }
        const realtimeService = new RealTimeService()

        const chatService = createChatService(db, realtimeService)

        const sessions = await chatService.getActiveSessions(
          input.organizationId,
          input.status.toLowerCase() as 'active' | 'closed' | 'all'
        )

        return { sessions }
      } catch (error) {
        logger.error('Failed to get active sessions', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        if (error instanceof Error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
            cause: error,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get active sessions',
        })
      }
    }),

  /**
   * Agent-only: Send a message from an agent
   */
  sendAgentMessage: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        content: z.string(),
        attachmentIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { sessionId, content, attachmentIds } = input
      const { organizationId } = ctx.session
      try {
        const realtimeService = new RealTimeService()

        const chatService = createChatService(db, realtimeService)

        // Check if session exists
        const session = await chatService.getSession(sessionId)
        if (!session) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found' })
        }
        if (session.organizationId !== organizationId) {
          // Check if user has access to the organization
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }

        const message = await chatService.sendAgentMessage({
          threadId: session.threadId!,
          sessionId,
          agent: ctx.session.user,
          content,
          attachmentIds,
        })

        if (message) {
          await realtimeService.sendToChat(
            session.id, // Use the session ID obtained earlier
            'new-message', // The event the bundle listens for
            message // Send the full formatted message object
          )
        }

        return { message }
      } catch (error) {
        logger.error('Failed to send agent message', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        if (error instanceof Error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
            cause: error,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to send agent message',
        })
      }
    }),

  setTyping: publicProcedure
    .input(z.object({ sessionId: z.string(), isTyping: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { sessionId, isTyping } = input
        const realtimeService = new RealTimeService()

        const chatService = createChatService(db, realtimeService)

        // Get session to ensure it exists and is active
        const session = await chatService.getSession(sessionId)
        if (!session || session.status === 'closed') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found or is closed' })
        }

        // Notify about typing via the service
        await chatService.setUserTyping(sessionId, isTyping)

        return { success: true }
      } catch (error) {
        logger.error('Failed to update typing state', { error, input })
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update typing state',
        })
      }
    }),

  setAgentTyping: protectedProcedure
    .input(z.object({ sessionId: z.string(), isTyping: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { sessionId, isTyping } = input
        const { userId } = ctx.session
        const realtimeService = new RealTimeService()

        const chatService = createChatService(db, realtimeService)

        // Get session to ensure it exists and is active
        const session = await chatService.getSession(sessionId)
        if (!session || session.status === 'closed') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found or is closed' })
        }

        // Notify about agent typing via the service
        await chatService.setAgentTyping(sessionId, userId, isTyping)

        return { success: true }
      } catch (error) {
        logger.error('Failed to update agent typing state', { error, input })
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update agent typing state',
        })
      }
    }),
  /**
   * Agent-only: Get session details
   */
  getSessionDetails: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        const realtimeService = new RealTimeService()

        const chatService = createChatService(db, realtimeService)

        // Get session
        const session = await chatService.getSession(input.sessionId)
        if (!session) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found' })
        }

        // Check if user has access to the organization
        const membership = await findMemberByUser(session.organizationId, ctx.session.user.id)

        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }

        // Get messages
        const messages = await chatService.getMessages(input.sessionId)

        // Mark messages as read
        await chatService.markMessagesAsRead(input.sessionId, ctx.session.user.id)

        return { session, messages }
      } catch (error) {
        logger.error('Failed to get session details', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        if (error instanceof Error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
            cause: error,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get session details',
        })
      }
    }),

  /**
   * Agent-only: Close a chat session
   */
  closeSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const realtimeService = new RealTimeService()

        const chatService = createChatService(db, realtimeService)

        // Get session
        const session = await chatService.getSession(input.sessionId)
        if (!session) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found' })
        }

        // Check if user has access to the organization
        const membership = await findMemberByUser(session.organizationId, ctx.session.user.id)

        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }

        // Close session
        await chatService.closeSession(input.sessionId, ctx.session.user.id)

        return { success: true }
      } catch (error) {
        logger.error('Failed to close chat session', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        if (error instanceof Error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
            cause: error,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to close chat session',
        })
      }
    }),
})
