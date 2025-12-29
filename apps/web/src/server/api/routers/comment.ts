// server/api/routers/comment.ts
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { CommentService } from '@auxx/lib/comments'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('comment-router')

// New input schemas with typed attachments
const fileAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  type: z.enum(['file', 'asset']),
})

// entityType can be a system type ('Ticket', 'Thread', 'Contact') or an entityDefinitionId (for custom entities)
const createCommentSchema = z.object({
  content: z.string().min(1, 'Comment content cannot be empty'),
  entityId: z.string(),
  entityType: z.string().min(1),
  parentId: z.string().nullable().optional(),
  fileAttachments: z.array(fileAttachmentSchema).optional(),
})

const createReplySchema = z.object({
  content: z.string().min(1, 'Comment content cannot be empty'),
  parentId: z.string(),
  fileAttachments: z.array(fileAttachmentSchema).optional(),
})

const updateCommentSchema = z.object({
  id: z.string(),
  content: z.string().min(1, 'Comment content cannot be empty'),
  fileAttachments: z.array(fileAttachmentSchema).optional(),
})

export const commentRouter = createTRPCRouter({
  // Create a new comment
  create: protectedProcedure.input(createCommentSchema).mutation(async ({ ctx, input }) => {
    try {
      const { userId, organizationId } = ctx.session
      const commentService = new CommentService(organizationId, userId, ctx.db)
      const { content, entityId, entityType, parentId, fileAttachments } = input

      // Parse out mentions from content (if @username exists)
      const mentionedUserIds = await commentService.parseMentions(content, organizationId)

      // Create the comment
      const comment = await commentService.createComment({
        content,
        entityId,
        entityType,
        createdById: userId,
        parentId,
        fileAttachments,
        mentions: mentionedUserIds,
      })

      return comment
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create comment'
      logger.error('Error creating comment', { error, input })

      if (error instanceof TRPCError) {
        throw error
      }

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: message,
      })
    }
  }),

  // Update a comment
  update: protectedProcedure.input(updateCommentSchema).mutation(async ({ ctx, input }) => {
    try {
      const { userId, organizationId } = ctx.session
      const commentService = new CommentService(organizationId, userId, ctx.db)
      const { id, content, fileAttachments } = input

      // Parse out mentions if content provided
      let mentionedUserIds: string[] | undefined
      if (content) {
        mentionedUserIds = await commentService.parseMentions(content, organizationId)
      }

      // Update the comment
      const updatedComment = await commentService.updateComment({
        id,
        content,
        fileAttachments,
        mentions: mentionedUserIds,
      })

      return updatedComment
    } catch (error: unknown) {
      logger.error('Error updating comment', { error, input })
      // const message = error instanceof Error ? error.message : 'Failed to update comment'

      if (error instanceof TRPCError) {
        throw error
      }

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update comment',
      })
    }
  }),

  // Delete a comment
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session
        const { id } = input

        const commentService = new CommentService(organizationId, userId, ctx.db)
        await commentService.deleteComment(id)

        return { success: true }
      } catch (error: unknown) {
        logger.error('Error deleting comment', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete comment',
        })
      }
    }),
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    try {
      const { userId, organizationId } = ctx.session
      const commentService = new CommentService(organizationId, userId, ctx.db)

      const comment = await commentService.getById(input.id)

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        })
      }

      return { comment }
    } catch (error: unknown) {
      logger.error('Error fetching comment', { error, input })

      if (error instanceof TRPCError) {
        throw error
      }

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch comment',
      })
    }
  }),
  // Get comments for an entity
  getByEntity: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        entityType: z.string().min(1), // Can be system type or entityDefinitionId
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session
        const { entityId, entityType } = input

        const commentService = new CommentService(organizationId, userId, ctx.db)

        // Use efficient single query from CommentService
        const comments = await commentService.getCommentsByEntity(entityId, entityType)

        return { comments }
      } catch (error: unknown) {
        logger.error('Error fetching comments', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch comments',
        })
      }
    }),

  // Pin/unpin a comment
  togglePin: protectedProcedure
    .input(z.object({ id: z.string(), pin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session
        const { id, pin } = input

        const commentService = new CommentService(organizationId, userId, ctx.db)
        const comment = await commentService.pinComment(id, userId, pin)

        return comment
      } catch (error: unknown) {
        logger.error('Error toggling pin status', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to toggle pin status',
        })
      }
    }),

  // Add a reaction to a comment
  addReaction: protectedProcedure
    .input(
      z.object({
        commentId: z.string(),
        type: z.enum(['like', 'emoji']),
        emoji: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session

        const commentService = new CommentService(organizationId, userId, ctx.db)
        const reaction = await commentService.addReaction({
          commentId: input.commentId,
          userId,
          type: input.type,
          emoji: input.emoji,
        })

        return reaction
      } catch (error: unknown) {
        logger.error('Error adding reaction', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add reaction',
        })
      }
    }),

  // Remove a reaction from a comment
  removeReaction: protectedProcedure
    .input(
      z.object({
        commentId: z.string(),
        type: z.enum(['like', 'emoji']),
        emoji: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session

        const commentService = new CommentService(organizationId, userId, ctx.db)
        await commentService.removeReaction(input.commentId, userId, input.type, input.emoji)

        return { success: true }
      } catch (error: unknown) {
        logger.error('Error removing reaction', { error, input })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove reaction',
        })
      }
    }),
})
