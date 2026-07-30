// packages/lib/src/comments/comment-service.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import type {
  CommentEntity as Comment,
  CommentReactionEntity as CommentReaction,
} from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getCachedResources } from '../cache/org-cache-helpers'
import { getCachedUserInstanceGrants } from '../cache/user-cache-helpers'
import { touchActivityForThreadLinks, touchEntityActivity } from '../entity-instances/activity'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { publisher } from '../events'
import type {
  CommentCreatedEvent,
  CommentDeletedEvent,
  CommentReferencedEvent,
  CommentRepliedEvent,
  CommentUpdatedEvent,
} from '../events/types'
import { AttachmentService, type GroupedAttachmentInfo } from '../files/core/attachment-service'
import { MediaAssetService } from '../files/core/media-asset-service'
import { NotificationService } from '../notifications/notification-service'
import type { CapabilityView } from '../permissions/capabilities/capability-view'
import { PermissionKey } from '../permissions/capabilities/registry'
import {
  buildDefIdToDefinitionId,
  buildDefIdToSlug,
} from '../permissions/capabilities/resolve-capability-inputs'
import { getThreadLens } from '../permissions/visibility/thread-lens'
import { collectReferenceIds } from '../references'
import { inboxAccessRecordId } from '../resource-access/mail-sharing-guard'
import { parseRecordId, type RecordId, toRecordId } from '../resources/resource-id'
import { assertCanActOnThreads } from '../threads/thread-action-access'
import { docToText } from '../tiptap'

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
  /** Tiptap doc JSON — single source of truth for the comment body. */
  contentJson: Record<string, unknown>
  recordId: RecordId
  createdById: string
  organizationId?: string
  parentId?: string | null
  fileAttachments?: FileAttachment[]
}
// Define interface for updating a comment
export interface UpdateCommentInput {
  id: string
  contentJson?: Record<string, unknown>
  fileAttachments?: FileAttachment[]
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

type ResolvedCommentParent = {
  entityDefinitionId: string
  entityInstanceId: string
  canonicalDefinitionId: string
  slug: string
  inboxId: string | null
}

export class CommentService {
  private db: Database
  private userId: string
  private organizationId: string
  private notificationService: NotificationService
  private mediaAssetService: MediaAssetService
  private attachmentService: AttachmentService
  private readonly capabilities: CapabilityView | null

  /**
   * @param capabilities Required nullable authorization view. Pass `null` only for
   * parent-delete cascades and explicitly reviewed headless callers.
   */
  constructor(
    organizationId: string,
    userId: string,
    db: Database,
    capabilities: CapabilityView | null
  ) {
    this.organizationId = organizationId
    this.userId = userId
    this.db = db
    this.capabilities = capabilities

    this.notificationService = new NotificationService(db)
    this.mediaAssetService = new MediaAssetService(organizationId, userId, db)
    this.attachmentService = new AttachmentService(organizationId, userId, db)
  }

  /** All RecordId definition spellings that resolve to the same canonical host. */
  private async equivalentDefinitionKeys(entityDefinitionId: string): Promise<string[]> {
    const resources = await getCachedResources(this.organizationId)
    const toSlug = buildDefIdToSlug(resources)
    const toDefinitionId = buildDefIdToDefinitionId(resources)
    const slug = toSlug(entityDefinitionId)
    const canonicalDefinitionId = toDefinitionId(entityDefinitionId)
    const keys = new Set<string>([entityDefinitionId, canonicalDefinitionId, slug])

    for (const resource of resources) {
      const sameHost =
        slug === 'thread'
          ? toSlug(resource.entityDefinitionId) === 'thread'
          : toDefinitionId(resource.entityDefinitionId) === canonicalDefinitionId
      if (!sameHost) continue
      keys.add(resource.id)
      keys.add(resource.apiSlug)
      keys.add(resource.entityDefinitionId)
      if (resource.entityType) keys.add(resource.entityType)
    }

    return [...keys]
  }

  /** Resolve stable fallback copy for a comment notification. */
  private async getNotificationCopy(recordId: RecordId): Promise<{
    actorName: string
    recordName: string
  }> {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const toSlug = buildDefIdToSlug(await getCachedResources(this.organizationId))
    const [actor, recordName] = await Promise.all([
      this.db.query.User.findFirst({
        where: eq(schema.User.id, this.userId),
        columns: { name: true },
      }),
      toSlug(entityDefinitionId) === 'thread'
        ? this.db.query.Thread.findFirst({
            where: eq(schema.Thread.id, entityInstanceId),
            columns: { subject: true },
          }).then((thread) => thread?.subject)
        : this.db.query.EntityInstance.findFirst({
            where: eq(schema.EntityInstance.id, entityInstanceId),
            columns: { displayName: true },
          }).then((record) => record?.displayName),
    ])

    return {
      actorName: actor?.name ?? 'A teammate',
      recordName: recordName || 'this record',
    }
  }

  /** Resolve a comment host and prove organization ownership plus parent visibility. */
  private async assertCanAccessRecord(
    recordId: RecordId,
    message: string,
    options: { allowUnsupportedParent?: boolean } = {}
  ): Promise<ResolvedCommentParent> {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const resources = await getCachedResources(this.organizationId)
    const toSlug = buildDefIdToSlug(resources)
    const toDefinitionId = buildDefIdToDefinitionId(resources)
    const slug = toSlug(entityDefinitionId)
    const canonicalDefinitionId = toDefinitionId(entityDefinitionId)

    if ((slug === 'inbox' || slug === 'personal_inbox') && !options.allowUnsupportedParent) {
      throw new BadRequestError('Comments are not supported on inboxes.')
    }

    if (this.capabilities) {
      if (slug === 'thread') {
        // The mail front door answers before any thread row is read.
        this.capabilities.assert(PermissionKey.inboxesView)
      } else if (!this.capabilities.canViewEntity(canonicalDefinitionId)) {
        throw new ForbiddenError(message)
      }
    }

    let recordOrgId: string | undefined
    let recordDefinitionId: string | undefined
    let inboxId: string | null = null
    if (slug === 'thread') {
      const t = await this.db.query.Thread.findFirst({
        where: eq(schema.Thread.id, entityInstanceId),
        columns: { organizationId: true, inboxId: true },
      })
      recordOrgId = t?.organizationId
      inboxId = t?.inboxId ?? null
    } else {
      const i = await this.db.query.EntityInstance.findFirst({
        where: eq(schema.EntityInstance.id, entityInstanceId),
        columns: { organizationId: true, entityDefinitionId: true },
      })
      recordOrgId = i?.organizationId
      recordDefinitionId = i?.entityDefinitionId
    }

    if (!recordOrgId) {
      throw new NotFoundError('Record not found')
    }
    if (recordOrgId !== this.organizationId) {
      throw new ForbiddenError(message)
    }
    if (slug !== 'thread' && toDefinitionId(recordDefinitionId ?? '') !== canonicalDefinitionId) {
      throw new NotFoundError('Record not found')
    }

    if (this.capabilities) {
      if (slug === 'thread') {
        const viewer = await getCachedUserInstanceGrants(this.userId, this.organizationId)
        const lens = await getThreadLens(this.db, this.organizationId, viewer, entityInstanceId)
        if (lens === 'none') throw new ForbiddenError(message)
      }
    }

    return {
      entityDefinitionId,
      entityInstanceId,
      canonicalDefinitionId,
      slug,
      inboxId,
    }
  }

  /**
   * Verify update/delete authority after the area and parent gates.
   */
  private async assertCanModifyComment(
    commentId: string,
    message: string
  ): Promise<{
    createdById: string
    entityId: string
    entityDefinitionId: string
    organizationId: string
  }> {
    this.capabilities?.assert(PermissionKey.commentsManage)
    const comment = await this.db.query.Comment.findFirst({
      where: eq(schema.Comment.id, commentId),
      columns: {
        createdById: true,
        entityId: true,
        entityDefinitionId: true,
        organizationId: true,
      },
    })
    if (!comment) {
      throw new NotFoundError('Comment not found')
    }
    if (comment.organizationId !== this.organizationId) {
      throw new ForbiddenError(message)
    }

    const parent = await this.assertCanAccessRecord(
      toRecordId(comment.entityDefinitionId, comment.entityId),
      message
    )
    if (!this.capabilities || comment.createdById === this.userId) return comment

    if (parent.slug === 'thread') {
      const viewer = await getCachedUserInstanceGrants(this.userId, this.organizationId)
      await assertCanActOnThreads(this.db, this.organizationId, viewer, [parent.entityInstanceId])
      if (viewer.isAdmin) return comment
      if (parent.inboxId) {
        const { entityDefinitionId, entityInstanceId } = parseRecordId(
          await inboxAccessRecordId(this.organizationId, parent.inboxId)
        )
        if (
          (entityDefinitionId === 'inbox' || entityDefinitionId === 'personal_inbox') &&
          this.capabilities.canAdminInstance(entityDefinitionId, entityInstanceId)
        ) {
          return comment
        }
      }
      throw new ForbiddenError('Only admins or inbox managers can moderate this note.')
    }

    if (this.capabilities.canAdministerDef(parent.canonicalDefinitionId)) return comment
    throw new ForbiddenError(message)
  }

  /**
   * Create a new comment
   */
  async createComment(data: CreateCommentInput): Promise<Comment> {
    try {
      this.capabilities?.assert(PermissionKey.commentsManage)
      data.organizationId = this.organizationId

      // Parse recordId to get components
      const { entityDefinitionId, entityInstanceId } = parseRecordId(data.recordId)
      const entityId = entityInstanceId
      const entityType = entityDefinitionId

      const resolvedParent = await this.assertCanAccessRecord(
        data.recordId,
        `You don't have access to this record`
      )

      let replyParent:
        | {
            createdById: string
            entityId: string
            entityDefinitionId: string
          }
        | undefined
      if (data.parentId) {
        replyParent = await this.db.query.Comment.findFirst({
          where: and(
            eq(schema.Comment.id, data.parentId),
            eq(schema.Comment.organizationId, this.organizationId),
            isNull(schema.Comment.deletedAt)
          ),
          columns: {
            createdById: true,
            entityId: true,
            entityDefinitionId: true,
          },
        })

        if (replyParent) {
          const resources = await getCachedResources(this.organizationId)
          const toSlug = buildDefIdToSlug(resources)
          const toDefinitionId = buildDefIdToDefinitionId(resources)
          const replySlug = toSlug(replyParent.entityDefinitionId)
          const sameDefinition =
            resolvedParent.slug === 'thread'
              ? replySlug === 'thread'
              : toDefinitionId(replyParent.entityDefinitionId) ===
                resolvedParent.canonicalDefinitionId
          if (replyParent.entityId !== entityId || !sameDefinition) replyParent = undefined
        }

        if (!replyParent) {
          throw new NotFoundError('Parent comment not found')
        }
      }

      // Verify file access if provided
      if (data.fileAttachments && data.fileAttachments.length > 0) {
        await this.verifyFileAttachments(data.fileAttachments)
      }
      const { contentJson, createdById, organizationId, parentId, fileAttachments } = data

      // Extract inline references from the Tiptap doc — drives both notifications
      // (for user references) and agent mention triggers (for agent references).
      const recordIds = collectReferenceIds(contentJson)

      // Use transaction to ensure data consistency
      const result = await this.db.transaction(async (tx) => {
        // First create the comment
        const [comment] = await tx
          .insert(schema.Comment)
          .values({
            contentJson,
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
        // Persist references
        if (recordIds.length > 0) {
          await tx.insert(schema.CommentReference).values(
            recordIds.map((recordId) => {
              const { entityDefinitionId: defId, entityInstanceId: instId } =
                parseRecordId(recordId)
              return {
                commentId: comment!.id,
                entityDefinitionId: defId,
                entityInstanceId: instId,
              }
            })
          )
        }

        // Update Thread.latestCommentId if this is a thread comment
        if (resolvedParent.slug === 'thread') {
          await tx
            .update(schema.Thread)
            .set({ latestCommentId: comment!.id })
            .where(eq(schema.Thread.id, entityId))
          // Comment on a thread = activity on whatever entities are linked.
          await touchActivityForThreadLinks(entityId, this.organizationId, new Date(), tx)
        } else {
          // Comment directly on an entity (deal, ticket, lead, contact, custom).
          await touchEntityActivity([entityId], this.organizationId, new Date(), tx)
        }

        return comment
      })

      if (!result) {
        throw new Error('Failed to create comment')
      }

      const previewText = docToText(contentJson).slice(0, 150)
      const { actorName, recordName } = await this.getNotificationCopy(data.recordId)

      // Trigger reply notification outside the transaction
      if (data.parentId && replyParent) {
        if (replyParent.createdById !== this.userId) {
          await this.notificationService.sendNotification({
            type: 'COMMENT_REPLY',
            userId: replyParent.createdById,
            organizationId: this.organizationId,
            targetType: 'COMMENT',
            targetIds: { commentId: result.id, recordId: data.recordId },
            message: `${actorName} replied to your comment on ${recordName}`,
            actorId: this.userId,
            metadata: { kind: 'COMMENT_REPLY', recordName, snippet: previewText },
          })
        }
      }

      // Notify mentioned users — agents fire triggers, not notifications.
      for (const recordId of recordIds) {
        const { entityDefinitionId: defId, entityInstanceId: instId } = parseRecordId(recordId)
        if (defId === 'user' && instId !== this.userId) {
          await this.notificationService.sendNotification({
            type: 'COMMENT_MENTION',
            userId: instId,
            organizationId: this.organizationId,
            targetType: 'COMMENT',
            targetIds: { commentId: result.id, recordId: data.recordId },
            message: `${actorName} mentioned you on ${recordName}`,
            actorId: this.userId,
            metadata: { kind: 'COMMENT_MENTION', recordName, snippet: previewText },
          })
        }
      }

      // Publish timeline event for whichever entity the comment is attached
      // to (thread / ticket / contact / custom entity).
      await publisher.publishLater({
        type: 'comment:created',
        data: {
          commentId: result.id,
          organizationId: this.organizationId,
          createdById: this.userId,
          recordId: data.recordId,
          content: previewText,
          hasAttachments: (data.fileAttachments?.length || 0) > 0,
        },
      } as CommentCreatedEvent)

      if (data.parentId) {
        await publisher.publishLater({
          type: 'comment:replied',
          data: {
            commentId: result.id,
            organizationId: this.organizationId,
            createdById: this.userId,
            recordId: data.recordId,
            parentCommentId: data.parentId,
            content: previewText,
          },
        } as CommentRepliedEvent)
      }

      // Fan out one comment:referenced event per reference row so the agent
      // dispatcher can route each (def, inst) pair independently.
      for (const recordId of recordIds) {
        await publisher.publishLater({
          type: 'comment:referenced',
          data: {
            commentId: result.id,
            organizationId: this.organizationId,
            mentionerUserId: this.userId,
            parentRecordId: data.recordId,
            referencedRecordId: recordId,
            siblingReferences: recordIds.filter((r) => r !== recordId),
          },
        } as CommentReferencedEvent)
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
      const { id, contentJson, fileAttachments } = data
      await this.assertCanModifyComment(id, `You don't have permission to update this comment`)
      // Verify file access if provided
      if (fileAttachments && fileAttachments.length > 0) {
        await this.verifyFileAttachments(fileAttachments)
      }

      // Diff references for newly-mentioned users (notification fan-out).
      let newUserMentions: string[] = []
      if (contentJson) {
        const recordIds = collectReferenceIds(contentJson)
        const existing = await this.db
          .select({
            entityDefinitionId: schema.CommentReference.entityDefinitionId,
            entityInstanceId: schema.CommentReference.entityInstanceId,
          })
          .from(schema.CommentReference)
          .where(eq(schema.CommentReference.commentId, id))
        const existingKeys = new Set(
          existing.map((r) => `${r.entityDefinitionId}:${r.entityInstanceId}`)
        )
        newUserMentions = recordIds
          .filter((rid) => !existingKeys.has(rid))
          .map((rid) => parseRecordId(rid))
          .filter((p) => p.entityDefinitionId === 'user')
          .map((p) => p.entityInstanceId)
      }

      // Use transaction for data consistency
      const result = await this.db.transaction(async (tx) => {
        // Update the comment body
        const [comment] = await tx
          .update(schema.Comment)
          .set({
            ...(contentJson ? { contentJson } : {}),
            updatedAt: new Date(),
          })
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
        // Replace references when contentJson changes.
        if (contentJson) {
          const recordIds = collectReferenceIds(contentJson)
          await tx.delete(schema.CommentReference).where(eq(schema.CommentReference.commentId, id))
          if (recordIds.length > 0) {
            await tx.insert(schema.CommentReference).values(
              recordIds.map((recordId) => {
                const { entityDefinitionId: defId, entityInstanceId: instId } =
                  parseRecordId(recordId)
                return {
                  commentId: id,
                  entityDefinitionId: defId,
                  entityInstanceId: instId,
                }
              })
            )
          }
        }
        return { comment }
      })

      const comment = result.comment
      if (!comment) {
        throw new Error('Failed to update comment')
      }
      const recordId = toRecordId(comment.entityDefinitionId, comment.entityId)
      const previewText = docToText(contentJson ?? comment.contentJson).slice(0, 150)
      const { actorName, recordName } = await this.getNotificationCopy(recordId)

      // Notify newly mentioned users
      if (newUserMentions.length > 0) {
        await Promise.all(
          newUserMentions.map((userId) => {
            if (userId !== this.userId) {
              return this.notificationService.sendNotification({
                type: 'COMMENT_MENTION',
                userId,
                organizationId: this.organizationId,
                targetType: 'COMMENT',
                targetIds: { commentId: id, recordId },
                message: `${actorName} mentioned you on ${recordName}`,
                actorId: this.userId,
                metadata: { kind: 'COMMENT_MENTION', recordName, snippet: previewText },
              })
            }
          })
        )
      }

      if (comment) {
        await publisher.publishLater({
          type: 'comment:updated',
          data: {
            commentId: id,
            organizationId: this.organizationId,
            createdById: this.userId,
            recordId: toRecordId(comment.entityDefinitionId, comment.entityId),
            content: previewText,
          },
        } as CommentUpdatedEvent)
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
   * This is a parent-delete cascade and intentionally skips per-comment moderation.
   */
  async deleteCommentsByRecordId(recordId: RecordId): Promise<void> {
    try {
      // Parse recordId to get components
      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      const entityId = entityInstanceId
      const entityType = entityDefinitionId

      await this.assertCanAccessRecord(recordId, `You don't have access to this record`, {
        // Parent deletion must not be blocked by unreachable historical inbox comments.
        // The explicit null mode still proves organization and exact host identity.
        allowUnsupportedParent: this.capabilities === null,
      })
      const equivalentDefinitionKeys = await this.equivalentDefinitionKeys(entityType)

      await this.db
        .delete(schema.Comment)
        .where(
          and(
            eq(schema.Comment.entityId, entityId),
            inArray(schema.Comment.entityDefinitionId, equivalentDefinitionKeys),
            eq(schema.Comment.organizationId, this.organizationId)
          )
        )

      // Set Thread.latestCommentId to null if deleting all thread comments
      if (equivalentDefinitionKeys.includes('thread')) {
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
      const comment = await this.assertCanModifyComment(
        id,
        `You don't have permission to delete this comment`
      )

      // Soft delete by setting deletedAt
      await this.db
        .update(schema.Comment)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.Comment.id, id))

      // Recalculate Thread.latestCommentId if this was a thread comment
      const toSlug = buildDefIdToSlug(await getCachedResources(this.organizationId))
      if (comment && toSlug(comment.entityDefinitionId) === 'thread') {
        await this.recalculateLatestCommentId(comment.entityId)
      }

      if (comment) {
        await publisher.publishLater({
          type: 'comment:deleted',
          data: {
            commentId: id,
            organizationId: this.organizationId,
            createdById: this.userId,
            recordId: toRecordId(comment.entityDefinitionId, comment.entityId),
          },
        } as CommentDeletedEvent)
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
      this.capabilities?.assert(PermissionKey.commentsView)
      await this.assertCanAccessRecord(recordId, `You don't have access to this record`)

      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      const entityId = entityInstanceId
      const entityType = entityDefinitionId
      const equivalentDefinitionKeys = await this.equivalentDefinitionKeys(entityType)

      const { includeReplies = true, page = 1, limit = 20 } = options
      // Calculate skip value for pagination
      const skip = (page - 1) * limit
      // Get top-level comments
      // Note: createdBy/pinnedBy removed - frontend uses useActor hook to resolve user info
      const comments = await this.db.query.Comment.findMany({
        where: and(
          eq(schema.Comment.entityId, entityId),
          inArray(schema.Comment.entityDefinitionId, equivalentDefinitionKeys),
          eq(schema.Comment.organizationId, this.organizationId),
          isNull(schema.Comment.parentId), // Only get top-level comments (replies are nested)
          isNull(schema.Comment.deletedAt) // Exclude soft-deleted comments
        ),
        with: {
          references: true,
          reactions: true, // Include all reactions for processing
          ...(includeReplies
            ? {
                replies: {
                  where: and(
                    eq(schema.Comment.organizationId, this.organizationId),
                    isNull(schema.Comment.deletedAt)
                  ),
                  with: {
                    references: true,
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
      this.capabilities?.assert(PermissionKey.commentsView)
      // Get the comment with all related data
      // Note: createdBy/pinnedBy removed - frontend uses useActor hook to resolve user info
      const comment = await this.db.query.Comment.findFirst({
        where: and(
          eq(schema.Comment.id, id),
          eq(schema.Comment.organizationId, this.organizationId),
          isNull(schema.Comment.deletedAt) // Exclude soft-deleted comments
        ),
        with: {
          references: true,
          reactions: true, // Include all reactions for processing
          replies: {
            where: and(
              eq(schema.Comment.organizationId, this.organizationId),
              isNull(schema.Comment.deletedAt)
            ),
            with: {
              references: true,
              reactions: true, // Include all reactions for processing
            },
          },
        },
      })
      if (!comment) {
        throw new NotFoundError('Comment not found')
      }
      await this.assertCanAccessRecord(
        toRecordId(comment.entityDefinitionId, comment.entityId),
        `You don't have access to this comment`
      )
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
      this.capabilities?.assert(PermissionKey.commentsManage)
      const comment = await this.db.query.Comment.findFirst({
        where: eq(schema.Comment.id, commentId),
        columns: { entityId: true, entityDefinitionId: true, organizationId: true },
      })
      if (!comment) {
        throw new NotFoundError('Comment not found')
      }
      if (comment.organizationId !== this.organizationId) {
        throw new ForbiddenError(`You don't have permission to pin this comment`)
      }
      const parent = await this.assertCanAccessRecord(
        toRecordId(comment.entityDefinitionId, comment.entityId),
        `You don't have permission to pin this comment`
      )
      if (this.capabilities && parent.slug === 'thread') {
        const viewer = await getCachedUserInstanceGrants(this.userId, this.organizationId)
        await assertCanActOnThreads(this.db, this.organizationId, viewer, [parent.entityInstanceId])
      }
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
      this.capabilities?.assert(PermissionKey.commentsView)
      const { commentId, userId, type, emoji } = data
      const comment = await this.db.query.Comment.findFirst({
        where: eq(schema.Comment.id, commentId),
        columns: {
          entityId: true,
          entityDefinitionId: true,
          createdById: true,
          organizationId: true,
        },
      })
      if (!comment) {
        throw new NotFoundError('Comment not found')
      }
      if (comment.organizationId !== this.organizationId) {
        throw new ForbiddenError(`You don't have access to this comment`)
      }
      await this.assertCanAccessRecord(
        toRecordId(comment.entityDefinitionId, comment.entityId),
        `You don't have access to this comment`
      )
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
        const recordId = toRecordId(comment.entityDefinitionId, comment.entityId)
        const { actorName, recordName } = await this.getNotificationCopy(recordId)
        const reactionLabel = type === 'like' ? 'a like' : (emoji ?? 'an emoji')
        await this.notificationService.sendNotification({
          type: 'COMMENT_REACTION',
          userId: comment.createdById,
          organizationId: this.organizationId,
          targetType: 'COMMENT',
          targetIds: { commentId, recordId },
          message: `${actorName} reacted to your comment on ${recordName} with ${reactionLabel}`,
          actorId: userId,
          metadata: { kind: 'COMMENT_REACTION', recordName, reaction: reactionLabel },
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
      this.capabilities?.assert(PermissionKey.commentsView)
      const comment = await this.db.query.Comment.findFirst({
        where: eq(schema.Comment.id, commentId),
        columns: { entityId: true, entityDefinitionId: true, organizationId: true },
      })
      if (!comment) {
        throw new NotFoundError('Comment not found')
      }
      if (comment.organizationId !== this.organizationId) {
        throw new ForbiddenError(`You don't have access to this comment`)
      }
      await this.assertCanAccessRecord(
        toRecordId(comment.entityDefinitionId, comment.entityId),
        `You don't have access to this comment`
      )
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
    logger.info('Fetching comment with attachments', {
      commentId,
      organizationId: this.organizationId,
    })
    this.capabilities?.assert(PermissionKey.commentsView)
    // Get the comment with all related data including reactions and references.
    // Note: createdBy/pinnedBy removed - frontend uses useActor hook to resolve user info
    const comment = await this.db.query.Comment.findFirst({
      where: and(
        eq(schema.Comment.id, commentId),
        eq(schema.Comment.organizationId, this.organizationId),
        isNull(schema.Comment.deletedAt)
      ),
      with: {
        references: true,
        reactions: true, // Include all reactions for processing
      },
    })
    if (!comment) {
      return null
    }
    await this.assertCanAccessRecord(
      toRecordId(comment.entityDefinitionId, comment.entityId),
      `You don't have access to this comment`
    )
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
  }
  /**
   * Verify access to file attachments
   */
  private async verifyFileAttachments(fileAttachments: FileAttachment[]): Promise<void> {
    for (const attachment of fileAttachments) {
      if (attachment.type === 'asset') {
        const asset = await this.db.query.MediaAsset.findFirst({
          where: and(
            eq(schema.MediaAsset.id, attachment.id),
            eq(schema.MediaAsset.organizationId, this.organizationId)
          ),
          columns: { id: true },
        })
        if (!asset) {
          throw new ForbiddenError(`MediaAsset not found or you don't have access to it`)
        }
      } else if (attachment.type === 'file') {
        const folderFile = await this.db.query.FolderFile.findFirst({
          where: and(
            eq(schema.FolderFile.id, attachment.id),
            eq(schema.FolderFile.organizationId, this.organizationId)
          ),
          columns: { id: true },
        })
        if (!folderFile) {
          throw new ForbiddenError(`FolderFile not found or access denied: ${attachment.id}`)
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
          // Handle MediaAsset - convert temp to permanent first.
          // Pass `tx` so the read+update inside convertTempToPermanent share
          // this tx's connection instead of reaching into the pool.
          await this.mediaAssetService.convertTempToPermanent(
            attachment.id,
            'EMAIL_ATTACHMENT',
            this.organizationId,
            tx
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
      const threadDefinitionKeys = await this.equivalentDefinitionKeys('thread')
      const latest = await this.db.query.Comment.findFirst({
        where: and(
          eq(schema.Comment.entityId, threadId),
          inArray(schema.Comment.entityDefinitionId, threadDefinitionKeys),
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
