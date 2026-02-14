// lib/comments/enhanced-comment-service.ts
import { type Database, database, schema, type Transaction } from '@auxx/database'
import type {
  CommentEntity as Comment,
  CommentReactionEntity as CommentReaction,
} from '@auxx/database/models'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { publisher } from '../events'
import type {
  CommentCreatedEvent,
  CommentDeletedEvent,
  CommentRepliedEvent,
  CommentUpdatedEvent,
} from '../events/types'
import { AttachmentService, type GroupedAttachmentInfo } from '../files/core/attachment-service'
import { MediaAssetService } from '../files/core/media-asset-service'
import { NotificationService } from '../notifications/notification-service'
import { PermissionService } from '../permissions/permission-service'
import { parseRecordId, type RecordId } from '../resources/resource-id'

// System entity types (hardcoded)
export const SYSTEM_ENTITY_TYPES = ['Ticket', 'Thread', 'Contact'] as const
export type SystemEntityType = (typeof SYSTEM_ENTITY_TYPES)[number]

// CommentableEntityType can be a system type OR an entityDefinitionId (for custom entities)
export type CommentableEntityType = SystemEntityType | string

/**
 * Check if entityType is a system type or a custom entity definition ID
 * Handles both lowercase ('ticket', 'contact', 'thread') and capital case
 */
export function isSystemEntityType(entityType: string): entityType is SystemEntityType {
  const normalized = entityType.toLowerCase()
  return normalized === 'ticket' || normalized === 'thread' || normalized === 'contact'
}

/**
 * Normalize entity type to capitalized format for permission checks
 * Permission service expects 'Contact', 'Ticket', 'Thread' but resource IDs use lowercase
 */
function normalizeEntityTypeForPermissions(entityType: string): SystemEntityType {
  const normalized = entityType.toLowerCase()
  if (normalized === 'contact') return 'Contact'
  if (normalized === 'ticket') return 'Ticket'
  if (normalized === 'thread') return 'Thread'
  return entityType as SystemEntityType
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
// Note: createdBy/pinnedBy removed - frontend uses useActor hook to resolve user info
export interface CommentWithAttachments extends Comment {
  attachments: CommentAttachmentInfo[]
}
// Define interface for creating a comment
export interface CreateCommentInput {
  content: string
  recordId: RecordId
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

      // Parse recordId to get components
      const { entityDefinitionId, entityInstanceId } = parseRecordId(data.recordId)
      const entityId = entityInstanceId
      const entityType = entityDefinitionId

      // Verify entity access based on type
      if (isSystemEntityType(entityType)) {
        // System entity (Ticket, Thread, Contact)
        // Normalize to capitalized format for permission checks
        const normalizedType = normalizeEntityTypeForPermissions(entityType)
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(entityId, normalizedType),
          `You don't have access to this ${entityType.toLowerCase()}`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(entityId, entityType),
          `You don't have access to this entity`
        )
      }

      // Verify file access if provided
      if (data.fileAttachments && data.fileAttachments.length > 0) {
        await this.verifyFileAttachments(data.fileAttachments)
      }
      const { content, createdById, organizationId, parentId, fileAttachments, mentions } = data

      // Use transaction to ensure data consistency
      const result = await this.db.transaction(async (tx) => {
        // First create the comment
        const [comment] = await tx
          .insert(schema.Comment)
          .values({
            content,
            entityId,
            entityDefinitionId: entityType,
            createdById,
            organizationId,
            parentId,
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

        // Update Thread.latestCommentId if this is a thread comment
        if (entityType === 'thread') {
          await tx
            .update(schema.Thread)
            .set({ latestCommentId: comment!.id })
            .where(eq(schema.Thread.id, entityId))
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
      const normalizedType = entityType.toLowerCase()
      if (normalizedType === 'ticket') {
        const ticket = await this.db.query.Ticket.findFirst({
          where: eq(schema.Ticket.id, entityId),
          columns: { contactId: true },
        })
        contactId = ticket?.contactId || undefined
      } else if (normalizedType === 'contact') {
        contactId = entityId
      } else if (!isSystemEntityType(entityType)) {
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
        const normalizedType = comment.entityDefinitionId.toLowerCase()
        if (normalizedType === 'ticket') {
          const ticket = await this.db.query.Ticket.findFirst({
            where: eq(schema.Ticket.id, comment.entityId),
            columns: { contactId: true },
          })
          contactId = ticket?.contactId || undefined
        } else if (normalizedType === 'contact') {
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
  async deleteCommentsByRecordId(recordId: RecordId): Promise<void> {
    try {
      // Parse recordId to get components
      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      const entityId = entityInstanceId
      const entityType = entityDefinitionId

      await this.db
        .delete(schema.Comment)
        .where(
          and(
            eq(schema.Comment.entityId, entityId),
            eq(schema.Comment.entityDefinitionId, entityType),
            eq(schema.Comment.organizationId, this.organizationId)
          )
        )

      // Set Thread.latestCommentId to null if deleting all thread comments
      if (entityType === 'thread') {
        await this.db
          .update(schema.Thread)
          .set({ latestCommentId: null })
          .where(eq(schema.Thread.id, entityId))
      }

      logger.info('Deleted comments for entity', { entityId, entityType })
    } catch (error) {
      logger.error('Error deleting comments by entity', { error, recordId })
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

      // Recalculate Thread.latestCommentId if this was a thread comment
      if (comment && comment.entityDefinitionId === 'thread') {
        await this.recalculateLatestCommentId(comment.entityId)
      }

      // Publish event after deletion
      if (comment) {
        let contactId: string | undefined
        const normalizedType = comment.entityDefinitionId.toLowerCase()
        if (normalizedType === 'ticket') {
          const ticket = await this.db.query.Ticket.findFirst({
            where: eq(schema.Ticket.id, comment.entityId),
            columns: { contactId: true },
          })
          contactId = ticket?.contactId || undefined
        } else if (normalizedType === 'contact') {
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
  async getCommentsByRecordId(
    recordId: RecordId,
    options: {
      includeReplies?: boolean
      page?: number
      limit?: number
    } = {}
  ): Promise<Comment[]> {
    try {
      // Parse recordId to get components
      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      const entityId = entityInstanceId
      const entityType = entityDefinitionId

      // Verify entity access based on type
      if (isSystemEntityType(entityType)) {
        // Normalize to capitalized format for permission checks
        const normalizedType = normalizeEntityTypeForPermissions(entityType)
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(entityId, normalizedType),
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
      // Note: createdBy/pinnedBy removed - frontend uses useActor hook to resolve user info
      const comments = await this.db.query.Comment.findMany({
        where: and(
          eq(schema.Comment.entityId, entityId),
          eq(schema.Comment.entityDefinitionId, entityType),
          isNull(schema.Comment.parentId), // Only get top-level comments (replies are nested)
          isNull(schema.Comment.deletedAt) // Exclude soft-deleted comments
        ),
        with: {
          mentions: {
            with: {
              user: {
                columns: { id: true, name: true },
              },
            },
          },
          reactions: true, // Include all reactions for processing
          ...(includeReplies
            ? {
                replies: {
                  where: isNull(schema.Comment.deletedAt), // Exclude soft-deleted replies
                  with: {
                    mentions: {
                      with: {
                        user: {
                          columns: { id: true, name: true },
                        },
                      },
                    },
                    reactions: true, // Include all reactions for processing
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
      logger.error('Error getting comments by entity', { error, recordId })
      throw error
    }
  }
  async getCommentById(id: string): Promise<Comment> {
    try {
      // Get the comment with all related data
      // Note: createdBy/pinnedBy removed - frontend uses useActor hook to resolve user info
      const comment = await this.db.query.Comment.findFirst({
        where: and(
          eq(schema.Comment.id, id),
          isNull(schema.Comment.deletedAt) // Exclude soft-deleted comments
        ),
        with: {
          mentions: {
            with: {
              user: {
                columns: { id: true, name: true },
              },
            },
          },
          reactions: true, // Include all reactions for processing
          replies: {
            where: isNull(schema.Comment.deletedAt), // Exclude soft-deleted replies
            with: {
              mentions: {
                with: {
                  user: {
                    columns: { id: true, name: true },
                  },
                },
              },
              reactions: true, // Include all reactions for processing
            },
          },
        },
      })
      if (!comment) {
        throw new Error('Comment not found')
      }
      // Check access to the entity this comment belongs to based on type
      if (isSystemEntityType(comment.entityDefinitionId)) {
        // Normalize to capitalized format for permission checks
        const normalizedType = normalizeEntityTypeForPermissions(comment.entityDefinitionId)
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(comment.entityId, normalizedType),
          `You don't have access to this comment`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(
            comment.entityId,
            comment.entityDefinitionId
          ),
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
      if (isSystemEntityType(comment.entityDefinitionId)) {
        // Normalize to capitalized format for permission checks
        const normalizedType = normalizeEntityTypeForPermissions(comment.entityDefinitionId)
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(comment.entityId, normalizedType),
          `You don't have access to this comment`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(
            comment.entityId,
            comment.entityDefinitionId
          ),
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
      if (isSystemEntityType(comment.entityDefinitionId)) {
        // Normalize to capitalized format for permission checks
        const normalizedType = normalizeEntityTypeForPermissions(comment.entityDefinitionId)
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(comment.entityId, normalizedType),
          `You don't have access to this comment`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(
            comment.entityId,
            comment.entityDefinitionId
          ),
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
      // Note: createdBy/pinnedBy removed - frontend uses useActor hook to resolve user info
      const comment = await this.db.query.Comment.findFirst({
        where: and(
          eq(schema.Comment.id, commentId),
          eq(schema.Comment.organizationId, this.organizationId),
          isNull(schema.Comment.deletedAt)
        ),
        with: {
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
        },
      })
      if (!comment) {
        return null
      }
      // Check access to the entity this comment belongs to based on type
      if (isSystemEntityType(comment.entityDefinitionId)) {
        // Normalize to capitalized format for permission checks
        const normalizedType = normalizeEntityTypeForPermissions(comment.entityDefinitionId)
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntity(comment.entityId, normalizedType),
          `You don't have access to this comment`
        )
      } else {
        // Custom entity - entityType IS the entityDefinitionId
        await this.permissionService.verifyAccess(
          this.permissionService.canAccessEntityInstance(
            comment.entityId,
            comment.entityDefinitionId
          ),
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

  /**
   * Recalculates and updates the latestCommentId for a thread
   */
  private async recalculateLatestCommentId(threadId: string): Promise<void> {
    try {
      const latest = await this.db.query.Comment.findFirst({
        where: and(
          eq(schema.Comment.entityId, threadId),
          eq(schema.Comment.entityDefinitionId, 'thread'),
          isNull(schema.Comment.deletedAt)
        ),
        columns: { id: true },
        orderBy: [desc(schema.Comment.createdAt), desc(schema.Comment.id)],
      })

      await this.db
        .update(schema.Thread)
        .set({ latestCommentId: latest?.id ?? null })
        .where(eq(schema.Thread.id, threadId))
    } catch (error) {
      logger.error('Failed to recalculate latestCommentId', { threadId, error })
    }
  }
}
