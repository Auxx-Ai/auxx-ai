// server/api/routers/comment.ts

import { CommentService } from '@auxx/lib/comments'
import { PermissionKey } from '@auxx/lib/permissions'
import { isNonEmptyDoc } from '@auxx/lib/tiptap'
import { createScopedLogger } from '@auxx/logger'
import { recordIdSchema } from '@auxx/types'
import { type ActorId, toActorId } from '@auxx/types/actor'
import { toRecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, isAuxxError, permissionProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('comment-router')

/**
 * Transform comment to include recordId and actorId, stripping internal fields.
 * Handles both old (entityType) and new (entityDefinitionId) column names for compatibility.
 * Recursively transforms replies as well.
 */
const transformCommentResponse = <
  T extends {
    entityDefinitionId?: string
    entityType?: string
    entityId: string
    createdById: string
    replies?: any[]
  },
>(
  comment: T
): Omit<T, 'entityDefinitionId' | 'entityType' | 'entityId' | 'createdById'> & {
  recordId: string
  actorId: ActorId
} => {
  const { entityDefinitionId, entityType, entityId, createdById, replies, ...rest } = comment
  const definitionId = entityDefinitionId || entityType || ''
  return {
    ...rest,
    recordId: toRecordId(definitionId, entityId),
    actorId: toActorId('user', createdById),
    // Recursively transform replies
    ...(replies && { replies: replies.map(transformCommentResponse) }),
  } as any
}

// New input schemas with typed attachments
const fileAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  type: z.enum(['file', 'asset']),
})

const contentJsonSchema = z
  .unknown()
  .refine((v): v is Record<string, unknown> => isNonEmptyDoc(v), 'Comment content cannot be empty')

const createCommentSchema = z.object({
  contentJson: contentJsonSchema,
  recordId: recordIdSchema,
  parentId: z.string().nullable().optional(),
  fileAttachments: z.array(fileAttachmentSchema).optional(),
})

const updateCommentSchema = z.object({
  id: z.string(),
  contentJson: contentJsonSchema,
  fileAttachments: z.array(fileAttachmentSchema).optional(),
})

export const commentRouter = createTRPCRouter({
  // Create a new comment
  create: permissionProcedure(PermissionKey.commentsManage)
    .input(createCommentSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session
        const commentService = new CommentService(organizationId, userId, ctx.db, ctx.capabilities)
        const { contentJson, recordId, parentId, fileAttachments } = input

        // Create the comment
        const comment = await commentService.createComment({
          contentJson: contentJson as Record<string, unknown>,
          recordId,
          createdById: userId,
          parentId,
          fileAttachments,
        })

        return transformCommentResponse(comment)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to create comment'
        logger.error('Error creating comment', { error, input })

        if (error instanceof TRPCError || isAuxxError(error)) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: message,
        })
      }
    }),

  // Update a comment
  update: permissionProcedure(PermissionKey.commentsManage)
    .input(updateCommentSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session
        const commentService = new CommentService(organizationId, userId, ctx.db, ctx.capabilities)
        const { id, contentJson, fileAttachments } = input

        // Update the comment
        const updatedComment = await commentService.updateComment({
          id,
          contentJson: contentJson as Record<string, unknown>,
          fileAttachments,
        })

        return updatedComment
      } catch (error: unknown) {
        logger.error('Error updating comment', { error, input })
        // const message = error instanceof Error ? error.message : 'Failed to update comment'

        if (error instanceof TRPCError || isAuxxError(error)) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update comment',
        })
      }
    }),

  // Delete a comment
  delete: permissionProcedure(PermissionKey.commentsManage)
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session
        const { id } = input

        const commentService = new CommentService(organizationId, userId, ctx.db, ctx.capabilities)
        await commentService.deleteComment(id)

        return { success: true }
      } catch (error: unknown) {
        logger.error('Error deleting comment', { error, input })

        if (error instanceof TRPCError || isAuxxError(error)) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete comment',
        })
      }
    }),
  getById: permissionProcedure(PermissionKey.commentsView)
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session
        const commentService = new CommentService(organizationId, userId, ctx.db, ctx.capabilities)

        const comment = await commentService.getById(input.id)

        if (!comment) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Comment not found',
          })
        }

        return { comment: transformCommentResponse(comment) }
      } catch (error: unknown) {
        logger.error('Error fetching comment', { error, input })

        if (error instanceof TRPCError || isAuxxError(error)) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch comment',
        })
      }
    }),
  // Get comments for an entity
  getByRecordId: permissionProcedure(PermissionKey.commentsView)
    .input(
      z.object({
        recordId: recordIdSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session
        const { recordId } = input

        const commentService = new CommentService(organizationId, userId, ctx.db, ctx.capabilities)

        // Use efficient single query from CommentService
        const comments = await commentService.getCommentsByRecordId(recordId)

        return { comments: comments.map(transformCommentResponse) }
      } catch (error: unknown) {
        logger.error('Error fetching comments', { error, input })

        if (error instanceof TRPCError || isAuxxError(error)) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch comments',
        })
      }
    }),

  // Pin/unpin a comment
  togglePin: permissionProcedure(PermissionKey.commentsManage)
    .input(z.object({ id: z.string(), pin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId, organizationId } = ctx.session
        const { id, pin } = input

        const commentService = new CommentService(organizationId, userId, ctx.db, ctx.capabilities)
        const comment = await commentService.pinComment(id, userId, pin)

        return comment
      } catch (error: unknown) {
        logger.error('Error toggling pin status', { error, input })

        if (error instanceof TRPCError || isAuxxError(error)) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to toggle pin status',
        })
      }
    }),

  // Add a reaction to a comment
  addReaction: permissionProcedure(PermissionKey.commentsView)
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

        const commentService = new CommentService(organizationId, userId, ctx.db, ctx.capabilities)
        const reaction = await commentService.addReaction({
          commentId: input.commentId,
          userId,
          type: input.type,
          emoji: input.emoji,
        })

        return reaction
      } catch (error: unknown) {
        logger.error('Error adding reaction', { error, input })

        if (error instanceof TRPCError || isAuxxError(error)) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add reaction',
        })
      }
    }),

  // Remove a reaction from a comment
  removeReaction: permissionProcedure(PermissionKey.commentsView)
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

        const commentService = new CommentService(organizationId, userId, ctx.db, ctx.capabilities)
        await commentService.removeReaction(input.commentId, userId, input.type, input.emoji)

        return { success: true }
      } catch (error: unknown) {
        logger.error('Error removing reaction', { error, input })

        if (error instanceof TRPCError || isAuxxError(error)) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove reaction',
        })
      }
    }),
})
