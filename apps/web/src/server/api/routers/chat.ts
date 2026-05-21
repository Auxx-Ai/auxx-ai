// src/server/api/routers/chat.ts

import { database as db } from '@auxx/database'
import { createChatService } from '@auxx/lib/chat'
import { findMemberByUser } from '@auxx/lib/members'
import { getRealtimeService } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('chat-router')

/**
 * Agent-facing chat procedures only. Visitor-facing procedures
 * (`initialize`, `sendMessage`, `uploadAttachment`, `getChatHistory`,
 * `updateVisitorInfo`, `setTyping`) moved to `apps/api` Hono routes in
 * Phase 2b — embedded clients do not call tRPC.
 *
 * Phase 4 removes the remaining procedures below as part of the unified
 * Thread/Message swap.
 */
export const chatRouter = createTRPCRouter({
  /** Agent-only: list chat sessions in the agent dashboard. */
  getActiveSessions: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        status: z.enum(['ACTIVE', 'CLOSED', 'ALL']).default('ACTIVE'),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const membership = await findMemberByUser(input.organizationId, ctx.session.user.id)
        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }
        const realtimeService = getRealtimeService()
        const chatService = createChatService(db, realtimeService)
        const sessions = await chatService.getActiveSessions(
          input.organizationId,
          input.status.toLowerCase() as 'active' | 'closed' | 'all'
        )
        return { sessions }
      } catch (error) {
        logger.error('Failed to get active sessions', { error, input })
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get active sessions',
        })
      }
    }),

  /** Agent-only: load message history for a session in the dashboard. */
  getChatHistory: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const realtimeService = getRealtimeService()
        const chatService = createChatService(db, realtimeService)
        const session = await chatService.getSession(input.sessionId)
        if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found' })

        const membership = await findMemberByUser(session.organizationId, ctx.session.user.id)
        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }

        const messages = await chatService.getMessages(input.sessionId)
        return { messages }
      } catch (error) {
        logger.error('Failed to get chat history', { error, input })
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get chat history',
        })
      }
    }),

  /** Agent-only: send a message into the customer's chat channel. */
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
        const realtimeService = getRealtimeService()
        const chatService = createChatService(db, realtimeService)

        const session = await chatService.getSession(sessionId)
        if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found' })
        if (session.organizationId !== organizationId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }

        const message = await chatService.sendAgentMessage({
          sessionId,
          agent: ctx.session.user,
          content,
          attachmentIds,
        })

        if (message) {
          await realtimeService.sendToChat(session.id, 'new-message', message)
        }

        return { message }
      } catch (error) {
        logger.error('Failed to send agent message', { error, input })
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to send agent message',
        })
      }
    }),

  /** Agent-only: broadcast a typing indicator on the customer's chat channel. */
  setAgentTyping: protectedProcedure
    .input(z.object({ sessionId: z.string(), isTyping: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const realtimeService = getRealtimeService()
        const chatService = createChatService(db, realtimeService)
        const session = await chatService.getSession(input.sessionId)
        if (!session || session.status === 'closed') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found or is closed' })
        }
        await chatService.setAgentTyping(input.sessionId, ctx.session.userId, input.isTyping)
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

  /** Agent-only: fetch session + messages for the dashboard view. */
  getSessionDetails: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        const realtimeService = getRealtimeService()
        const chatService = createChatService(db, realtimeService)

        const session = await chatService.getSession(input.sessionId)
        if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found' })

        const membership = await findMemberByUser(session.organizationId, ctx.session.user.id)
        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }

        const messages = await chatService.getMessages(input.sessionId)
        await chatService.markMessagesAsRead(input.sessionId, ctx.session.user.id)
        return { session, messages }
      } catch (error) {
        logger.error('Failed to get session details', { error, input })
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get session details',
        })
      }
    }),

  /** Agent-only: close a chat session. */
  closeSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const realtimeService = getRealtimeService()
        const chatService = createChatService(db, realtimeService)

        const session = await chatService.getSession(input.sessionId)
        if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat session not found' })

        const membership = await findMemberByUser(session.organizationId, ctx.session.user.id)
        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }

        await chatService.closeSession(input.sessionId, ctx.session.user.id)
        return { success: true }
      } catch (error) {
        logger.error('Failed to close chat session', { error, input })
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to close chat session',
        })
      }
    }),
})
