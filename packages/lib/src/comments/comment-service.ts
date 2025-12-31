// lib/comments/enhanced-comment-service.ts
import { database, schema, type Database, type Transaction } from '@auxx/database'
import { eq, and, or, desc, asc, sql, inArray, isNull, gt } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { NotificationService } from '../notifications/notification-service'
import { PermissionService } from '../permissions/permission-service'
import { SystemUserService } from '../users/system-user-service'
import { MediaAssetService } from '../files/core/media-asset-service'
import { AttachmentService, type GroupedAttachmentInfo } from '../files/core/attachment-service'
import type {
  CommentEntity as Comment,
  CommentReactionEntity as CommentReaction,
} from '@auxx/database/models'
import { publisher } from '../events'
import type {
  CommentCreatedEvent,
  CommentUpdatedEvent,
  CommentDeletedEvent,
  CommentRepliedEvent,
} from '../events/types'

// System entity types (hardcoded)
export const SYSTEM_ENTITY_TYPES = ['Ticket', 'Thread', 'Contact'] as const
export type SystemEntityType = (typeof SYSTEM_ENTITY_TYPES)[number]

// CommentableEntityType can be a system type OR an entityDefinitionId (for custom entities)
export type CommentableEntityType = SystemEntityType | string

/**
 * Check if entityType is a system type or a custom entity definition ID
 */
export function isSystemEntityType(entityType: string): entityType is SystemEntityType {
  return SYSTEM_ENTITY_TYPES.includes(entityType as SystemEntityType)
}
// Define reaction types
export type ReactionType = 'like' | 'emoji'
// Define file attachment types
export interface FileAttachment {
  id: string
  name: string
  size?: bigint | number
  mimeType?: string
  type: 'file' | 'asset' // 'file' = FolderFile, 'asset' = MediaAsset
}
// Define comment attachment info for display (alias to GroupedAttachmentInfo)
export type CommentAttachmentInfo = GroupedAttachmentInfo
// Define comment with attachments interface
export interface CommentWithAttachments extends Comment {
  createdBy: {
    id: string
    name: string
    email: string
    image: string | null
  }
  attachments: CommentAttachmentInfo[]
}
// Define interface for creating a comment
export interface CreateCommentInput {
  content: string
  entityId: string
  entityType: CommentableEntityType
  createdById: string
  organizationId?: string
  parentId?: string | null
  fileAttachments?: FileAttachment[]
  mentions?: string[] // Array of user IDs to mention
}
// Define interface for updating a comment
export interface UpdateCommentInput {
  id: string
  content?: string
  fileAttachments?: FileAttachment[] // New typed file attachments
  mentions?: string[] // New mentions to add
}
// Define interface for adding a reaction
export interface AddReactionInput {
  commentId: string
  userId: string
  type: ReactionType
  emoji?: string | null
}
// Define interface for aggregated reactions
export interface AggregatedReactions {
  likes: {
    count: number
    userReacted: boolean
  }
  emojis: {
    [emoji: string]: {
      count: number
      userReacted: boolean
    }
  }
}
const logger = createScopedLogger('comment-service')
// Define storage location selector

export class CommentService {
  private db: Database
  private userId: string
  private organizationId: string
  private permissionService: PermissionService
  private notificationService: NotificationService
  private mediaAssetService: MediaAssetService
  private attachmentService: AttachmentService
  constructor(organizationId: string, userId: string, db: Database = database) {
    this.organizationId = organizationId
    this.userId = userId
    this.db = db

    this.permissionService = new PermissionService(organizationId, userId, db)
    this.notificationService = new NotificationService(db)
    this.mediaAssetService = new MediaAssetService(organizationId, userId, db)
    this.attachmentService = new AttachmentService(organizationId, userId, db)
  }

  /**
   * Create a new comment
   */
  async createComment(data: CreateCommentInput): Promise<Comment> {
    try {
      data.organizationId = this.organizationId

      // Verify entity access based on type
      if (isSystemEntityType(data.entityType)) {
        // System entity (Ticket, Thread, Contact)
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(data.entityId, data.entityType),
          `You don't have access to this ${data.entityType.toLowerCase()}`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(data.entityId, data.entityType),
          `You don't have access to this entity`
        )
      }

      // Verify file access if provided
      if (data.fileAttachments && data.fileAttachments.length > 0) {
        await this.verifyFileAttachments(data.fileAttachments)
      }
      const {
        content,
        entityId,
        entityType,
        createdById,
        organizationId,
        parentId,
        fileAttachments,
        mentions,
      } = data

      // Determine FK values - only set for system entity types
      let threadIdToSet: string | null = null
      let ticketIdToSet: string | null = null
      if (entityType === 'Thread') {
        threadIdToSet = entityId
      } else if (entityType === 'Ticket') {
        ticketIdToSet = entityId
      }
      // For Contact and custom entities, no FK needed
      // Use transaction to ensure data consistency
      const result = await this.db.transaction(async (tx) => {
        // First create the comment
        const [comment] = await tx
          .insert(schema.Comment)
          .values({
            content,
            entityId,
            entityType,
            createdById,
            organizationId,
            parentId,
            threadId: threadIdToSet, // <<< Set direct Thread FK (or null) >>>
            ticketId: ticketIdToSet, // <<< Set direct Ticket FK (or null) >>>
            updatedAt: new Date(),
          })
          .returning()

        // Handle file attachments if provided
        if (fileAttachments && fileAttachments.length > 0) {
          await this.addAttachmentsToComment(comment!.id, fileAttachments, tx)
        }
        // Process mentions if provided
        if (mentions && mentions.length > 0) {
          await this.addMentionsToComment(comment!.id, mentions, tx)
        }
        return comment
      })
      // Trigger notifications outside the transaction
      if (data.parentId) {
        // Notify parent comment creator about the reply
        const parentComment = await this.db.query.Comment.findFirst({
          where: eq(schema.Comment.id, data.parentId),
          columns: { createdById: true },
        })
        if (parentComment && parentComment.createdById !== this.userId) {
          await this.notificationService.sendNotification({
            type: 'COMMENT_REPLY',
            userId: parentComment.createdById,
            entityId: result!.id,
            entityType: 'Comment',
            message: 'Someone replied to your comment',
            actorId: this.userId,
          })
        }
      }
      // Notify mentioned users
      if (mentions && mentions.length > 0) {
        await Promise.all(
          mentions.map((userId) => {
            if (userId !== this.userId) {
              return this.notificationService.sendNotification({
                type: 'COMMENT_MENTION',
                userId,
                entityId: result!.id,
                entityType: 'Comment',
                message: 'You were mentioned in a comment',
                actorId: this.userId,
              })
            }
          })
        )
      }
      if (!result) {
        throw new Error('Failed to create comment')
      }
      // Publish timeline event
      // Determine contactId based on entity type
      let contactId: string | undefined
      if (data.entityType === 'Ticket') {
        const ticket = await this.db.query.Ticket.findFirst({
          where: eq(schema.Ticket.id, data.entityId),
          columns: { contactId: true },
        })
        contactId = ticket?.contactId || undefined
      } else if (data.entityType === 'Contact') {
        contactId = data.entityId
      } else if (!isSystemEntityType(data.entityType)) {
        // Custom entity - no contact association for now
        contactId = undefined
      }

      // Only publish if we have a contactId
      if (contactId) {
        await publisher.publishLater({
          type: 'comment:created',
          data: {
            commentId: result.id,
            organizationId: this.organizationId,
            createdById: this.userId,
            entityId: contactId, // entityId IS the contactId
            content: data.content.substring(0, 150),
            hasAttachments: (data.fileAttachments?.length || 0) > 0,
          },
        } as CommentCreatedEvent)

        // Also check if it's a reply
        if (data.parentId) {
          await publisher.publishLater({
            type: 'comment:replied',
            data: {
              commentId: result.id,
              organizationId: this.organizationId,
              createdById: this.userId,
              entityId: contactId, // entityId IS the contactId
              parentCommentId: data.parentId,
              content: data.content.substring(0, 150),
            },
          } as CommentRepliedEvent)
        }
      }

      return result
    } catch (error: any) {
      logger.error('Error creating comment', { error, data })
      // Rethrow other errors
      throw error
    }
  }
  /**
   * Update an existing comment
   */
  async updateComment(data: UpdateCommentInput): Promise<Comment> {
    try {
      const { id, content, fileAttachments, mentions } = data
      // Verify comment modification permission
      await this.permissionService.verifyAccess(
        this.permissionService.canModifyComment(id),
        `You don't have permission to update this comment`
      )
      // Verify file access if provided
      if (fileAttachments && fileAttachments.length > 0) {
        await this.verifyFileAttachments(fileAttachments)
      }
      // Use transaction for data consistency
      const result = await this.db.transaction(async (tx) => {
        // First update the basic comment data
        const [comment] = await tx
          .update(schema.Comment)
          .set({ content: content ? content : undefined, updatedAt: new Date() })
          .where(eq(schema.Comment.id, id))
          .returning()
        // Handle file attachments if provided (replaces existing attachments)
        if (fileAttachments !== undefined) {
          // For update, we'll replace all existing attachments with new ones
          // First remove existing attachments
          await tx
            .delete(schema.Attachment)
            .where(
              and(
                eq(schema.Attachment.entityType, 'COMMENT'),
                eq(schema.Attachment.entityId, id),
                eq(schema.Attachment.organizationId, this.organizationId)
              )
            )
          // Then add new attachments if there are any
          if (fileAttachments.length > 0) {
            await this.addAttachmentsToComment(id, fileAttachments, tx)
          }
        }
        // Handle mentions if provided
        if (mentions && mentions.length > 0) {
          // Get existing mentions to compare
          const existingMentions = await tx.query.CommentMention.findMany({
            where: eq(schema.CommentMention.commentId, id),
            columns: { userId: true },
          })
          const existingUserIds = existingMentions.map((mention) => mention.userId)
          // Find new mentions for notifications
          const newMentions = mentions.filter((userId) => !existingUserIds.includes(userId))
          // First delete existing mentions
          await tx.delete(schema.CommentMention).where(eq(schema.CommentMention.commentId, id))
          // Then add new mentions
          await this.addMentionsToComment(id, mentions, tx)
          // Store new mentions for notifications
          return { comment, newMentions }
        }
        return { comment, newMentions: [] }
      })
      // Notify newly mentioned users
      if (result.newMentions && result.newMentions.length > 0) {
        await Promise.all(
          result.newMentions.map((userId) => {
            if (userId !== this.userId) {
              return this.notificationService.sendNotification({
                type: 'COMMENT_MENTION',
                userId,
                entityId: id,
                entityType: 'Comment',
                message: 'You were mentioned in a comment',
                actorId: this.userId,
              })
            }
          })
        )
      }

      // Get the comment to find contactId
      const comment = await this.db.query.Comment.findFirst({
        where: eq(schema.Comment.id, id),
      })

      let contactId: string | undefined
      if (comment) {
        if (comment.entityType === 'Ticket') {
          const ticket = await this.db.query.Ticket.findFirst({
            where: eq(schema.Ticket.id, comment.entityId),
            columns: { contactId: true },
          })
          contactId = ticket?.contactId || undefined
        } else if (comment.entityType === 'Contact') {
          contactId = comment.entityId
        }

        // Only publish if we have a contactId
        if (contactId) {
          await publisher.publishLater({
            type: 'comment:updated',
            data: {
              commentId: id,
              organizationId: this.organizationId,
              createdById: this.userId,
              entityId: contactId, // entityId IS the contactId
              content: (content || comment.content).substring(0, 150),
            },
          } as CommentUpdatedEvent)
        }
      }

      return result.comment!
    } catch (error) {
      logger.error('Error updating comment', { error, data })
      throw error
    }
  }
  /**
   * Delete all comments for an entity (hard delete)
   * Used when deleting parent entities like Contact, EntityInstance, etc.
   * Note: Ticket/Thread comments are handled via FK cascade in the database
   */
  async deleteCommentsByEntity(entityId: string, entityType: CommentableEntityType): Promise<void> {
    try {
      await this.db
        .delete(schema.Comment)
        .where(
          and(
            eq(schema.Comment.entityId, entityId),
            eq(schema.Comment.entityType, entityType),
            eq(schema.Comment.organizationId, this.organizationId)
          )
        )

      logger.info('Deleted comments for entity', { entityId, entityType })
    } catch (error) {
      logger.error('Error deleting comments by entity', { error, entityId, entityType })
      throw error
    }
  }

  /**
   * Delete a comment (soft delete)
   */
  async deleteComment(id: string): Promise<void> {
    try {
      // Get the comment to find contactId before deleting
      const comment = await this.db.query.Comment.findFirst({
        where: eq(schema.Comment.id, id),
      })

      // Verify comment modification permission
      await this.permissionService.verifyAccess(
        this.permissionService.canModifyComment(id),
        `You don't have permission to delete this comment`
      )
      // Soft delete by setting deletedAt
      await this.db
        .update(schema.Comment)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.Comment.id, id))

      // Publish event after deletion
      if (comment) {
        let contactId: string | undefined
        if (comment.entityType === 'Ticket') {
          const ticket = await this.db.query.Ticket.findFirst({
            where: eq(schema.Ticket.id, comment.entityId),
            columns: { contactId: true },
          })
          contactId = ticket?.contactId || undefined
        } else if (comment.entityType === 'Contact') {
          contactId = comment.entityId
        }

        // Only publish if we have a contactId
        if (contactId) {
          await publisher.publishLater({
            type: 'comment:deleted',
            data: {
              commentId: id,
              organizationId: this.organizationId,
              createdById: this.userId,
              entityId: contactId, // entityId IS the contactId
            },
          } as CommentDeletedEvent)
        }
      }
    } catch (error) {
      logger.error('Error deleting comment', { error, id })
      throw error
    }
  }
  /**
   * Get comments by entity with optimized reactions
   */
  async getCommentsByEntity(
    entityId: string,
    entityType: CommentableEntityType,
    options: {
      includeReplies?: boolean
      page?: number
      limit?: number
    } = {}
  ): Promise<Comment[]> {
    try {
      // Verify entity access based on type
      if (isSystemEntityType(entityType)) {
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(entityId, entityType),
          `You don't have access to this ${entityType.toLowerCase()}`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(entityId, entityType),
          `You don't have access to this entity`
        )
      }
      const { includeReplies = true, page = 1, limit = 20 } = options
      // Calculate skip value for pagination
      const skip = (page - 1) * limit
      // Get top-level comments
      const comments = await this.db.query.Comment.findMany({
        where: and(
          eq(schema.Comment.entityId, entityId),
          eq(schema.Comment.entityType, entityType),
          isNull(schema.Comment.parentId), // Only get top-level comments (replies are nested)
          isNull(schema.Comment.deletedAt) // Exclude soft-deleted comments
        ),
        with: {
          createdBy: {
            columns: { id: true, name: true, image: true },
          },
          mentions: {
            with: {
              user: {
                columns: { id: true, name: true },
              },
            },
          },
          reactions: true, // Include all reactions for processing
          pinnedBy: {
            columns: { id: true, name: true },
          },
          ...(includeReplies
            ? {
                replies: {
                  where: isNull(schema.Comment.deletedAt), // Exclude soft-deleted replies
                  with: {
                    createdBy: {
                      columns: { id: true, name: true, image: true },
                    },
                    mentions: {
                      with: {
                        user: {
                          columns: { id: true, name: true },
                        },
                      },
                    },
                    reactions: true, // Include all reactions for processing
                    pinnedBy: {
                      columns: { id: true, name: true },
                    },
                  },
                },
              }
            : {}),
        },
        orderBy: [
          desc(schema.Comment.isPinned), // Pinned comments first
          desc(schema.Comment.createdAt), // Then by creation date
        ],
        offset: skip,
        limit: limit,
      })
      // Collect all comment IDs (including replies)
      const allCommentIds = this.collectCommentIds(comments, includeReplies || false)
      // Fetch attachments for all comments
      const attachmentMap = await this.fetchAttachmentsForComments(allCommentIds)
      // Splice attachments into comments
      const commentsWithAttachments = this.spliceAttachmentsIntoComments(comments, attachmentMap)
      // Process and optimize the reaction data
      const processedComments = commentsWithAttachments.map((comment) => {
        const processedComment = {
          ...comment,
          reactions: this.aggregateReactions((comment as any).reactions, this.userId),
        }
        // Process replies if included
        if (includeReplies && (comment as any).replies) {
          processedComment.replies = (comment as any).replies.map((reply: any) => ({
            ...reply,
            reactions: this.aggregateReactions(reply.reactions, this.userId),
          }))
        }
        return processedComment
      })
      return processedComments
    } catch (error) {
      logger.error('Error getting comments by entity', { error, entityId, entityType })
      throw error
    }
  }
  async getCommentById(id: string): Promise<Comment> {
    try {
      // Get the comment with all related data
      const comment = await this.db.query.Comment.findFirst({
        where: and(
          eq(schema.Comment.id, id),
          isNull(schema.Comment.deletedAt) // Exclude soft-deleted comments
        ),
        with: {
          createdBy: {
            columns: { id: true, name: true, image: true },
          },
          mentions: {
            with: {
              user: {
                columns: { id: true, name: true },
              },
            },
          },
          reactions: true, // Include all reactions for processing
          pinnedBy: {
            columns: { id: true, name: true },
          },
          replies: {
            where: isNull(schema.Comment.deletedAt), // Exclude soft-deleted replies
            with: {
              createdBy: {
                columns: { id: true, name: true, image: true },
              },
              mentions: {
                with: {
                  user: {
                    columns: { id: true, name: true },
                  },
                },
              },
              reactions: true, // Include all reactions for processing
              pinnedBy: {
                columns: { id: true, name: true },
              },
            },
          },
        },
      })
      if (!comment) {
        throw new Error('Comment not found')
      }
      // Check access to the entity this comment belongs to based on type
      if (isSystemEntityType(comment.entityType)) {
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(comment.entityId, comment.entityType),
          `You don't have access to this comment`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(comment.entityId, comment.entityType),
          `You don't have access to this comment`
        )
      }
      // Collect comment IDs (main comment + replies)
      const commentIds = [comment.id, ...(comment.replies || []).map((r) => r.id)]
      // Fetch attachments
      const attachmentMap = await this.fetchAttachmentsForComments(commentIds)
      // Splice attachments
      const commentWithAttachments = {
        ...comment,
        attachments: attachmentMap.get(comment.id) || [],
        replies: comment.replies
          ? this.spliceAttachmentsIntoComments(comment.replies, attachmentMap)
          : undefined,
      }
      // Process and optimize the reaction data
      const processedComment = {
        ...commentWithAttachments,
        reactions: this.aggregateReactions((commentWithAttachments as any).reactions, this.userId),
      }
      // Process replies if present
      if (processedComment.replies) {
        processedComment.replies = processedComment.replies.map((reply: any) => ({
          ...reply,
          reactions: this.aggregateReactions(reply.reactions, this.userId),
        }))
      }
      return processedComment
    } catch (error) {
      logger.error('Error getting comment by ID', { error, id })
      throw error
    }
  }
  /**
   * Pin/unpin a comment
   */
  async pinComment(commentId: string, userId: string, pin: boolean) {
    try {
      // Get the comment first to check its organization
      const comment = await this.db.query.Comment.findFirst({
        where: eq(schema.Comment.id, commentId),
        columns: { organizationId: true },
      })
      if (!comment) {
        throw new Error('Comment not found')
      }
      // Verify pin permission
      await this.permissionService.verifyAccess(
        this.permissionService.canPinComments(comment.organizationId),
        `You don't have permission to pin comments`
      )
      const [updatedComment] = await this.db
        .update(schema.Comment)
        .set({
          isPinned: pin,
          pinnedAt: pin ? new Date() : null,
          pinnedById: pin ? userId : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.Comment.id, commentId))
        .returning()

      return updatedComment
    } catch (error) {
      logger.error('Error pinning/unpinning comment', { error, commentId, userId, pin })
      throw error
    }
  }
  /**
   * Add a reaction to a comment
   */
  async addReaction(data: AddReactionInput) {
    try {
      const { commentId, userId, type, emoji } = data
      // Get the comment first to check permissions
      const comment = await this.db.query.Comment.findFirst({
        where: eq(schema.Comment.id, commentId),
        columns: { entityId: true, entityType: true, createdById: true },
      })
      if (!comment) {
        throw new Error('Comment not found')
      }
      // Verify entity access based on type
      if (isSystemEntityType(comment.entityType)) {
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(comment.entityId, comment.entityType),
          `You don't have access to this comment`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(comment.entityId, comment.entityType),
          `You don't have access to this comment`
        )
      }
      // Upsert to handle both adding new reactions and updating existing ones
      const [reaction] = await this.db
        .insert(schema.CommentReaction)
        .values({
          commentId,
          userId,
          type,
          emoji: emoji || null,
        })
        .onConflictDoUpdate({
          target: [
            schema.CommentReaction.commentId,
            schema.CommentReaction.userId,
            schema.CommentReaction.type,
            schema.CommentReaction.emoji,
          ],
          set: { emoji: emoji },
        })
        .returning()
      // Trigger notification for the comment creator
      if (comment.createdById !== userId) {
        await this.notificationService.sendNotification({
          type: 'COMMENT_REACTION',
          userId: comment.createdById,
          entityId: commentId,
          entityType: 'Comment',
          message: `Someone reacted to your comment with ${type === 'like' ? 'a like' : 'an emoji'}`,
          actorId: userId,
        })
      }
      return reaction
    } catch (error) {
      logger.error('Error adding reaction', { error, data })
      throw error
    }
  }
  /**
   * Remove a reaction from a comment
   */
  async removeReaction(
    commentId: string,
    userId: string,
    type: ReactionType,
    emoji?: string | null
  ): Promise<void> {
    try {
      // Verify access to the comment
      const comment = await this.db.query.Comment.findFirst({
        where: eq(schema.Comment.id, commentId),
        columns: { entityId: true, entityType: true },
      })
      if (!comment) {
        throw new Error('Comment not found')
      }
      // Verify entity access based on type
      if (isSystemEntityType(comment.entityType)) {
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(comment.entityId, comment.entityType),
          `You don't have access to this comment`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(comment.entityId, comment.entityType),
          `You don't have access to this comment`
        )
      }
      await this.db
        .delete(schema.CommentReaction)
        .where(
          and(
            eq(schema.CommentReaction.commentId, commentId),
            eq(schema.CommentReaction.userId, userId),
            eq(schema.CommentReaction.type, type),
            eq(schema.CommentReaction.emoji, emoji!)
          )
        )
    } catch (error: any) {
      // Ignore not found errors when removing reactions
      if (error.code !== 'P2025') {
        logger.error('Error removing reaction', { error, commentId, userId, type, emoji })
        throw error
      }
    }
  }
  /**
   * Parse comment content to extract mentions
   * This is useful when creating/updating comments with @username syntax
   */
  async parseMentions(content: string, organizationId: string): Promise<string[]> {
    try {
      // Extract all potential @mentions from content
      const mentionRegex = /@(\w+)/g
      const matches = content.match(mentionRegex) || []
      logger.info('Mentions found', { matches })
      // Extract usernames without the @ symbol
      const usernames = matches.map((match) => match.substring(1))
      logger.info('usernames found', { usernames })
      if (usernames.length === 0) return []
      // Look up users by their names in the organization
      const users = await this.db.query.User.findMany({
        where: and(
          inArray(schema.User.name, usernames)
          // TODO: Add membership filter when schema is available
        ),
        columns: { id: true },
      })
      // Return array of user IDs
      logger.info('User IDs returned', { userIds: users.map((user) => user.id) })
      return users.map((user) => user.id)
    } catch (error) {
      logger.error('Error parsing mentions', { error, content })
      return []
    }
  }
  /**
   * Fetch and group attachments for multiple comments using AttachmentService
   */
  private async fetchAttachmentsForComments(
    commentIds: string[]
  ): Promise<Map<string, CommentAttachmentInfo[]>> {
    return this.attachmentService.fetchAttachmentsForEntities('COMMENT', commentIds)
  }
  /**
   * Add attachments to comment objects (handles both comments and replies)
   */
  private spliceAttachmentsIntoComments<
    T extends {
      id: string
      replies?: any[]
    },
  >(
    comments: T[],
    attachmentMap: Map<string, CommentAttachmentInfo[]>
  ): (T & {
    attachments: CommentAttachmentInfo[]
  })[] {
    return comments.map((comment) => {
      const result = {
        ...comment,
        attachments: attachmentMap.get(comment.id) || [],
      } as T & {
        attachments: CommentAttachmentInfo[]
      }
      // Handle replies recursively
      if (comment.replies && Array.isArray(comment.replies)) {
        result.replies = this.spliceAttachmentsIntoComments(comment.replies, attachmentMap)
      }
      return result
    })
  }
  /**
   * Recursively collect all comment IDs from comments and their replies
   */
  private collectCommentIds(
    comments: {
      id: string
      replies?: {
        id: string
      }[]
    }[],
    includeReplies: boolean
  ): string[] {
    const ids: string[] = []
    for (const comment of comments) {
      ids.push(comment.id)
      if (includeReplies && comment.replies) {
        for (const reply of comment.replies) {
          ids.push(reply.id)
        }
      }
    }
    return ids
  }

  private async addMentionsToComment(
    commentId: string,
    userIds: string[],
    tx: Database | Transaction
  ): Promise<void> {
    try {
      const createData = userIds.map((userId) => ({ commentId, userId, updatedAt: new Date() }))
      await tx.insert(schema.CommentMention).values(createData)
    } catch (error) {
      logger.error('Error adding mentions to comment', { error, commentId, userIds })
      throw error
    }
  }
  /**
   * Aggregate reactions for optimized output
   */
  private aggregateReactions(
    reactions: CommentReaction[],
    currentUserId: string
  ): AggregatedReactions {
    const result: AggregatedReactions = { likes: { count: 0, userReacted: false }, emojis: {} }
    // Process each reaction
    for (const reaction of reactions) {
      if (reaction.type === 'like') {
        result.likes.count++
        if (reaction.userId === currentUserId) {
          result.likes.userReacted = true
        }
      } else if (reaction.type === 'emoji' && reaction.emoji) {
        // Initialize emoji if not exists
        if (!result.emojis[reaction.emoji]) {
          result.emojis[reaction.emoji] = { count: 0, userReacted: false }
        }
        // Increment count and check if current user reacted
        result.emojis[reaction.emoji]!.count++
        if (reaction.userId === currentUserId) {
          result.emojis[reaction.emoji]!.userReacted = true
        }
      }
    }
    return result
  }
  /**
   * Get single comment by ID with attachments
   */
  async getById(commentId: string): Promise<CommentWithAttachments | null> {
    try {
      logger.info('Fetching comment with attachments', {
        commentId,
        organizationId: this.organizationId,
      })
      // Get the comment with all related data including reactions and mentions
      const comment = await this.db.query.Comment.findFirst({
        where: and(
          eq(schema.Comment.id, commentId),
          eq(schema.Comment.organizationId, this.organizationId),
          isNull(schema.Comment.deletedAt)
        ),
        with: {
          createdBy: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          mentions: {
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          reactions: true, // Include all reactions for processing
          pinnedBy: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      })
      if (!comment) {
        return null
      }
      // Check access to the entity this comment belongs to based on type
      if (isSystemEntityType(comment.entityType)) {
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(comment.entityId, comment.entityType),
          `You don't have access to this comment`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(comment.entityId, comment.entityType),
          `You don't have access to this comment`
        )
      }
      // Fetch attachments for this single comment
      const attachmentMap = await this.fetchAttachmentsForComments([commentId])
      // Process and optimize the reaction data
      const processedReactions = this.aggregateReactions(comment.reactions, this.userId)
      // Convert to CommentWithAttachments format
      return {
        ...comment,
        reactions: processedReactions,
        attachments: attachmentMap.get(commentId) || [],
      } as CommentWithAttachments
    } catch (error) {
      logger.error('Error in getById', { error, commentId, organizationId: this.organizationId })
      return null
    }
  }
  /**
   * Verify access to file attachments
   */
  private async verifyFileAttachments(fileAttachments: FileAttachment[]): Promise<void> {
    for (const attachment of fileAttachments) {
      if (attachment.type === 'asset') {
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessFile(attachment.id),
          `MediaAsset not found or you don't have access to it`
        )
      } else if (attachment.type === 'file') {
        // Check FolderFile access
        const folderFile = await this.db.query.FolderFile.findFirst({
          where: and(
            eq(schema.FolderFile.id, attachment.id),
            eq(schema.FolderFile.organizationId, this.organizationId)
          ),
        })
        if (!folderFile) {
          throw new Error(`FolderFile not found or access denied: ${attachment.id}`)
        }
      }
    }
  }
  /**
   * Add typed attachments to comment using AttachmentService
   */
  private async addAttachmentsToComment(
    commentId: string,
    fileAttachments: FileAttachment[],
    tx: Transaction
  ): Promise<void> {
    try {
      const attachmentService = new AttachmentService(this.organizationId, this.userId, tx)
      for (const attachment of fileAttachments) {
        if (attachment.type === 'asset') {
          // Handle MediaAsset - convert temp to permanent first
          await this.mediaAssetService.convertTempToPermanent(
            attachment.id,
            'EMAIL_ATTACHMENT',
            this.organizationId
          )
          // Use AttachmentService create method
          await attachmentService.create({
            entityType: 'COMMENT',
            entityId: commentId,
            role: 'ATTACHMENT',
            assetId: attachment.id,
            createdById: this.userId,
            title: attachment.name,
            organizationId: this.organizationId,
          })
        } else if (attachment.type === 'file') {
          // Use AttachmentService attachFileToEntity method
          await attachmentService.attachFileToEntity(
            attachment.id,
            'COMMENT',
            commentId,
            this.userId,
            'ATTACHMENT',
            { title: attachment.name }
          )
        }
      }
    } catch (error) {
      logger.error('Error adding attachments to comment', { error, commentId, fileAttachments })
      throw error
    }
  }
}
