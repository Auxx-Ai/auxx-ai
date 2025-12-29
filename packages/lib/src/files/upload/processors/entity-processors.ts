// packages/lib/src/files/upload/processors/entity-processors.ts
import { database as db, schema } from '@auxx/database'
import { eq, and, desc } from 'drizzle-orm'
import { BaseAssetProcessor } from './base-asset-processor'
import { BaseAttachmentProcessor } from './base-attachment-processor'
import type { PresignedUploadSession } from '../session-types'
import type { AssetKind } from '../../core/types'
import type { UploadInitConfig, ProcessorConfigResult } from '../init-types'
import type { ProcessorResult } from './types'
import { MemberService } from '@auxx/lib/members'
import { ThumbnailService } from '../../core/thumbnail-service'
import type { ThumbnailSource } from '../../core/thumbnail-types'
import { ensureThumbnailPresets } from '../../core/thumbnail-batch'
import type { MediaAsset } from '@auxx/database/types'
// ============= Ticket Processor =============
export class TicketProcessor extends BaseAttachmentProcessor {
  protected readonly entityType = 'TICKET'
  protected readonly fileVisibility = 'PRIVATE'
  protected readonly preferredProvider = 'S3'
  protected readonly maxFileSize = 25 * 1024 * 1024 // 25MB
  protected readonly allowedMimeTypes = [
    'image/*',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/x-zip-compressed',
  ]
  protected readonly assetKind: AssetKind = 'EMAIL_ATTACHMENT'
  /**
   * Override processConfig for ticket-specific validation and policies
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    const base = await super.processConfig(init)
    const warnings = [...base.warnings]
    // Ticket-specific validations and warnings
    if (init.expectedSize > this.maxFileSize) {
      throw new Error(
        `File size exceeds maximum allowed for ticket attachments (${this.maxFileSize / 1024 / 1024}MB)`
      )
    }
    return {
      config: base.config,
      warnings,
    }
  }
  protected async validateEntityAccess(
    entityId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    const [ticket] = await db
      .select({ id: schema.Ticket.id })
      .from(schema.Ticket)
      .where(
        and(
          eq(schema.Ticket.id, entityId),
          eq(schema.Ticket.organizationId, organizationId)
          // Add user access validation based on your business rules
        )
      )
      .limit(1)
    if (!ticket) {
      throw new Error('Ticket not found or access denied')
    }
  }
}
// ============= User Profile Processor =============
export class UserProfileProcessor extends BaseAssetProcessor {
  protected readonly entityType = 'USER_PROFILE'
  protected readonly fileVisibility = 'PUBLIC'
  protected readonly preferredProvider = 'S3'
  protected readonly maxFileSize = 5 * 1024 * 1024 // 5MB
  protected readonly allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  protected readonly assetKind: AssetKind = 'USER_AVATAR'
  /**
   * Override executeProcess to implement versioning for user profiles
   * Wraps the entire operation in a transaction to ensure consistency
   */
  protected async executeProcess(
    session: PresignedUploadSession,
    storageLocationId: string
  ): Promise<ProcessorResult> {
    let assetId: string
    // Wrap database operations in a transaction
    const result = await this.mediaAssetService.getTx(async (tx) => {
      // Try to find existing user avatar (use transaction)
      const existingAsset = await this.findExistingAsset(session, tx)
      if (existingAsset) {
        // Update existing asset with new version (use transaction)
        assetId = await this.createNewVersion(existingAsset.id, session, storageLocationId, tx)
      } else {
        // Create new asset (use transaction)
        assetId = await this.createAsset(session, storageLocationId, tx)
      }
      // Update user avatar within the same transaction
      const userId = session.entityId || session.userId
      if (!userId) {
        throw new Error('Cannot determine user ID for avatar update')
      }
      await this.updateUserAvatar(userId, assetId, tx)
      return {
        assetId,
        storageLocationId,
      }
    })
    // Generate thumbnails AFTER transaction commits
    try {
      await this.generateAvatarThumbnails(session, result.assetId)
    } catch (error) {
      // Log error but don't fail the upload
      this.logger.error('Failed to generate avatar thumbnails', {
        assetId: result.assetId,
        userId: session.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
    return result
  }
  /**
   * Override processConfig for user profile-specific logic
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    // Automatically set entityId to userId for user profile uploads
    const enhancedInit: UploadInitConfig = {
      ...init,
      entityId: init.entityId || init.userId, // Use userId if entityId not provided
    }
    const base = await super.processConfig(enhancedInit)
    const warnings = [...base.warnings]
    // User profile specific validations
    if (init.expectedSize > this.maxFileSize) {
      throw new Error(
        `File size exceeds maximum allowed for user profile images (${this.maxFileSize / 1024 / 1024}MB)`
      )
    }
    // Warn if entityId was auto-set
    if (!init.entityId) {
      warnings.push(
        'EntityId was automatically set to the authenticated user ID for user profile upload'
      )
    }
    // Ensure the config has the correct entityId for session metadata
    const enhancedConfig = {
      ...base.config,
      entityId: enhancedInit.entityId, // Ensure entityId is in the config
    }
    return {
      config: enhancedConfig,
      warnings,
    }
  }
  protected async validateEntityAccess(
    entityId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    // Users can only upload to their own profile
    if (entityId !== userId) {
      throw new Error("Cannot upload to another user's profile")
    }
    // MemberService
    const isMember = await MemberService.isMember(userId, organizationId)
    if (!isMember) {
      throw new Error('User not found in organization')
    }
  }
  protected async postCreateAsset(
    session: PresignedUploadSession,
    storageLocationId: string,
    assetId: string,
    tx?: any
  ): Promise<void> {
    // This method is not used for UserProfileProcessor since we handle everything in executeProcess
    // The base class calls this, but we've overridden executeProcess to handle it differently
  }
  /**
   * Find existing user avatar asset
   */
  private async findExistingAsset(
    session: PresignedUploadSession,
    tx: any
  ): Promise<MediaAsset | null> {
    if (!session.entityId) return null // entityId = userId for user profiles
    return tx
      .select()
      .from(schema.MediaAsset)
      .where(
        and(
          eq(schema.MediaAsset.kind, this.assetKind),
          eq(schema.MediaAsset.createdById, session.entityId), // For user profiles, entityId is the userId
          eq(schema.MediaAsset.organizationId, session.organizationId),
          eq(schema.MediaAsset.deletedAt, null)
        )
      )
      .orderBy(desc(schema.MediaAsset.createdAt)) // Get most recent
      .limit(1)
      .then((results) => results[0] || null)
  }
  /**
   * Create new version for existing asset
   */
  private async createNewVersion(
    existingAssetId: string,
    session: PresignedUploadSession,
    storageLocationId: string,
    tx: any
  ): Promise<string> {
    // Use the service with transaction to create version + update asset metadata
    const assetService = this.mediaAssetService.withTx(tx)
    const { asset } = await assetService.updateContent(existingAssetId, storageLocationId, {
      size: BigInt(session.expectedSize),
      mimeType: session.mimeType,
    })
    this.logger.info('Created new user avatar version', {
      assetId: asset.id,
      userId: session.entityId,
      sessionId: session.id,
    })
    return asset.id
  }
  private async updateUserAvatar(userId: string, assetId: string, tx?: any): Promise<void> {
    const dbClient = tx || db
    // Get the original asset to get its URL
    const [asset] = await dbClient
      .select({
        id: schema.MediaAsset.id,
        currentVersion: {
          id: schema.MediaAssetVersion.id,
          storageLocation: {
            externalUrl: schema.StorageLocation.externalUrl,
          },
        },
      })
      .from(schema.MediaAsset)
      .leftJoin(
        schema.MediaAssetVersion,
        eq(schema.MediaAsset.currentVersionId, schema.MediaAssetVersion.id)
      )
      .leftJoin(
        schema.StorageLocation,
        eq(schema.MediaAssetVersion.storageLocationId, schema.StorageLocation.id)
      )
      .where(eq(schema.MediaAsset.id, assetId))
      .limit(1)
    // Update user with original image URL immediately
    const originalUrl = asset?.currentVersion?.storageLocation?.externalUrl || null
    await dbClient
      .update(schema.User)
      .set({
        avatarAssetId: assetId,
        // Set user.image to original URL immediately (users see image right away)
        image: originalUrl,
      })
      .where(eq(schema.User.id, userId))
    this.logger.info('Updated user avatar with original image', {
      userId,
      assetId,
      originalUrl,
    })
  }
  /**
   * Generate multiple thumbnail sizes for user avatar
   * All thumbnails are queued for async processing
   */
  private async generateAvatarThumbnails(
    session: PresignedUploadSession,
    assetId: string
  ): Promise<void> {
    this.logger.info('Queueing avatar thumbnails for background processing', {
      assetId,
      organizationId: session.organizationId,
      userId: session.userId,
    })
    const source: ThumbnailSource = { type: 'asset', assetId }
    const results = await ensureThumbnailPresets({
      organizationId: session.organizationId,
      userId: session.userId,
      source,
      presets: ['avatar-32', 'avatar-64', 'avatar-128', 'avatar-256'],
      defaultOptions: { queue: true, visibility: 'PUBLIC' },
      perPreset: { 'avatar-64': { updateUser: true } },
    })
    this.logger.info('Avatar thumbnails queued for background processing', {
      userId: session.userId,
      assetId,
      queuedJobs: results.map((r) => (r.status === 'queued' ? r.jobId : 'already-exists')),
    })
  }
}
// ============= Article Processor =============
export class ArticleProcessor extends BaseAttachmentProcessor {
  protected readonly entityType = 'ARTICLE'
  protected readonly fileVisibility = 'PRIVATE'
  protected readonly preferredProvider = 'S3'
  protected readonly maxFileSize = 10 * 1024 * 1024 // 10MB
  protected readonly allowedMimeTypes = [
    'image/*',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/html',
  ]
  protected readonly assetKind: AssetKind = 'INLINE_IMAGE'
  /**
   * Override processConfig for article-specific validation and policies
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    const base = await super.processConfig(init)
    const warnings = [...base.warnings]
    // Article-specific validations
    if (init.expectedSize > this.maxFileSize) {
      throw new Error(
        `File size exceeds maximum allowed for article attachments (${this.maxFileSize / 1024 / 1024}MB)`
      )
    }
    return {
      config: base.config,
      warnings,
    }
  }
  protected async validateEntityAccess(
    entityId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    const [article] = await db
      .select({ id: schema.Article.id })
      .from(schema.Article)
      .where(
        and(
          eq(schema.Article.id, entityId),
          eq(schema.Article.organizationId, organizationId)
          // Add authorship or permission checks based on your business rules
        )
      )
      .limit(1)
    if (!article) {
      throw new Error('Article not found or access denied')
    }
  }
  protected getAssetKind(session: PresignedUploadSession): AssetKind {
    // Special handling for different attachment roles
    if (session.metadata?.role === 'COVER') return 'THUMBNAIL'
    if (session.metadata?.role === 'THUMBNAIL') return 'THUMBNAIL'
    return this.assetKind
  }
}
// ============= Workflow Run Processor =============
export class WorkflowRunProcessor extends BaseAttachmentProcessor {
  protected readonly entityType = 'WORKFLOW_RUN'
  protected readonly fileVisibility = 'PRIVATE'
  protected readonly preferredProvider = 'S3'
  protected readonly maxFileSize = 50 * 1024 * 1024 // 50MB
  protected readonly allowedMimeTypes = [
    '*/*', // Workflow can accept any file type
  ]
  protected readonly assetKind: AssetKind = 'TEMP_UPLOAD'
  /**
   * Override processConfig for workflow attachment-specific policies
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    const base = await super.processConfig(init)
    const warnings = [...base.warnings]
    // Workflow files can be large - use multipart for files > 25MB
    const uploadPlan =
      init.expectedSize >= 25 * 1024 * 1024
        ? { strategy: 'multipart' as const }
        : { strategy: 'single' as const }
    return {
      config: Object.freeze({
        ...base.config,
        uploadPlan,
      }),
      warnings,
    }
  }
  protected async validateEntityAccess(
    entityId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    // const workflowRun = await db.workflowRun.findFirst({
    //   where: {
    //     id: entityId,
    //     organizationId,
    //     // Add user access validation based on your business rules
    //   },
    //   select: { id: true },
    // })
    // if (!workflowRun) {
    //   throw new Error('Workflow run not found or access denied')
    // }
  }
  protected async postCreateAsset(
    session: PresignedUploadSession,
    storageLocationId: string,
    assetId: string,
    tx?: any
  ): Promise<void> {
    // Schedule cleanup if temporary
    if (session.metadata?.isTemporary) {
      const expiresAt = session.metadata.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000)
      // Use transaction if provided, otherwise fall back to global db
      const dbClient = tx || db
      // Update the asset to mark as temporary with expiry
      await dbClient
        .update(schema.MediaAsset)
        .set({
          kind: 'TEMP_UPLOAD',
          expiresAt: expiresAt,
        })
        .where(eq(schema.MediaAsset.id, assetId))
      await this.scheduleCleanup(assetId, expiresAt)
    }
  }
  private async scheduleCleanup(assetId: string, expiresAt?: Date): Promise<void> {
    // Schedule background job to cleanup temporary workflow files
    // This would integrate with your job queue system
    this.logger.info('Scheduled asset cleanup', {
      assetId,
      expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
  }
}
// ============= Message Processor =============
export class MessageProcessor extends BaseAttachmentProcessor {
  protected readonly entityType = 'MESSAGE'
  protected readonly fileVisibility = 'PRIVATE'
  protected readonly preferredProvider = 'S3'
  protected readonly maxFileSize = 25 * 1024 * 1024 // 25MB (Gmail standard)
  protected readonly allowedMimeTypes = [
    '*/*', // Email messages can have any file type
  ]
  protected readonly assetKind: AssetKind = 'EMAIL_ATTACHMENT'
  /**
   * Override processConfig for message-specific validation and policies
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    const base = await super.processConfig(init)
    const warnings = [...base.warnings]
    // Message-specific validations
    if (init.expectedSize > this.maxFileSize) {
      throw new Error(
        `File size exceeds maximum allowed for email attachments (${this.maxFileSize / 1024 / 1024}MB)`
      )
    }
    return {
      config: base.config,
      warnings,
    }
  }
  protected async validateEntityAccess(
    entityId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    // For temporary uploads (before draft exists), skip validation
    if (entityId.startsWith('temp-message-')) {
      return
    }
    // For actual messages/drafts, verify the message exists and user has access
    // Use direct organizationId field instead of joining through thread
    const [message] = await db
      .select({ id: schema.Message.id })
      .from(schema.Message)
      .where(
        and(
          eq(schema.Message.id, entityId),
          eq(schema.Message.organizationId, organizationId)
        )
      )
      .limit(1)
    if (!message) {
      throw new Error('Message not found or access denied')
    }
  }
  protected async postCreateAsset(
    session: PresignedUploadSession,
    storageLocationId: string,
    assetId: string,
    tx?: any
  ): Promise<void> {
    // For temporary uploads, set expiry metadata
    if (session.entityId?.startsWith('temp-message-')) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h expiry
      // Use transaction if provided, otherwise fall back to global db
      const dbClient = tx || db
      // Update the asset using existing schema fields
      await dbClient
        .update(schema.MediaAsset)
        .set({
          kind: 'TEMP_UPLOAD', // Use kind field to indicate temporary
          expiresAt: expiresAt, // Use existing expiresAt field directly
        })
        .where(eq(schema.MediaAsset.id, assetId))
      await this.scheduleCleanup(assetId, expiresAt)
    }
  }
  private async scheduleCleanup(assetId: string, expiresAt: Date): Promise<void> {
    // Schedule background job to cleanup temporary message files
    // This would integrate with your job queue system
    this.logger.info('Scheduled message asset cleanup', {
      assetId,
      expiresAt,
    })
  }
  protected getAssetKind(session: PresignedUploadSession): AssetKind {
    // Support inline attachments for emails
    if (session.metadata?.attachmentType === 'inline') {
      return 'INLINE_IMAGE'
    }
    // Temporary uploads that haven't been attached to a draft yet
    if (session.entityId?.startsWith('temp-message-')) {
      return 'TEMP_UPLOAD'
    }
    return this.assetKind
  }
}
// ============= Comment Processor =============
export class CommentProcessor extends BaseAttachmentProcessor {
  protected readonly entityType = 'COMMENT'
  protected readonly fileVisibility = 'PRIVATE'
  protected readonly preferredProvider = 'S3'
  protected readonly maxFileSize = 25 * 1024 * 1024 // 25MB
  protected readonly allowedMimeTypes = [
    'image/*',
    'text/*',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]
  protected readonly assetKind: AssetKind = 'TEMP_UPLOAD'
  /**
   * Override processConfig for comment-specific validation and policies
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    const base = await super.processConfig(init)
    const warnings = [...base.warnings]
    // Comment-specific validations
    if (init.expectedSize > this.maxFileSize) {
      throw new Error(
        `File size exceeds maximum allowed for comment attachments (${this.maxFileSize / 1024 / 1024}MB)`
      )
    }
    return {
      config: base.config,
      warnings,
    }
  }
  protected async validateEntityAccess(
    entityId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    // For temporary uploads (before comment exists), skip validation
    if (entityId.startsWith('temp-comment-')) {
      return
    }
    // For actual comments, verify the comment exists and user has access
    const [comment] = await db
      .select({ id: schema.Comment.id })
      .from(schema.Comment)
      .where(
        and(
          eq(schema.Comment.id, entityId),
          eq(schema.Comment.organizationId, organizationId)
          // Add user access validation based on your business rules
        )
      )
      .limit(1)
    if (!comment) {
      throw new Error('Comment not found or access denied')
    }
  }
  protected async postCreateAsset(
    session: PresignedUploadSession,
    storageLocationId: string,
    assetId: string,
    tx?: any
  ): Promise<void> {
    // For temporary uploads, schedule cleanup
    if (session.entityId?.startsWith('temp-comment-')) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h expiry
      // Use transaction if provided, otherwise fall back to global db
      const dbClient = tx || db
      // Update the asset to mark as temporary with expiry
      await dbClient
        .update(schema.MediaAsset)
        .set({
          kind: 'TEMP_UPLOAD',
          expiresAt: expiresAt,
        })
        .where(eq(schema.MediaAsset.id, assetId))
      await this.scheduleCleanup(assetId, expiresAt)
    }
  }
  private async scheduleCleanup(assetId: string, expiresAt: Date): Promise<void> {
    // Schedule background job to cleanup temporary comment files
    // This would integrate with your job queue system
    this.logger.info('Scheduled comment asset cleanup', {
      assetId,
      expiresAt,
    })
  }
}
// ============= Knowledge Base Processor =============
export class KnowledgeBaseProcessor extends BaseAttachmentProcessor {
  protected readonly entityType = 'KNOWLEDGE_BASE'
  protected readonly fileVisibility = 'PUBLIC'
  protected readonly preferredProvider = 'S3'
  protected readonly maxFileSize = 10 * 1024 * 1024 // 10MB
  protected readonly allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
  protected readonly assetKind: AssetKind = 'THUMBNAIL'
  /**
   * Ensure the knowledge base exists and belongs to the organization
   */
  protected async validateEntityAccess(
    entityId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    const [kb] = await db
      .select({ id: schema.KnowledgeBase.id })
      .from(schema.KnowledgeBase)
      .where(
        and(
          eq(schema.KnowledgeBase.id, entityId),
          eq(schema.KnowledgeBase.organizationId, organizationId)
        )
      )
      .limit(1)
    if (!kb) {
      throw new Error('Knowledge base not found or access denied')
    }
  }
  /**
   * Override to ensure thumbnails are enqueued only after DB commit
   */
  protected async executeProcess(
    session: PresignedUploadSession,
    storageLocationId: string
  ): Promise<ProcessorResult> {
    let assetId = ''
    // Create asset and attachment within a transaction for consistency
    const result = await this.mediaAssetService.getTx(async (tx) => {
      assetId = await this.createAsset(session, storageLocationId, tx)
      await this.createAttachment(assetId, session, tx)
      // Fetch original URL from asset's current version storage location
      const [asset] = await tx
        .select({
          id: schema.MediaAsset.id,
          currentVersion: {
            id: schema.MediaAssetVersion.id,
            storageLocation: {
              externalUrl: schema.StorageLocation.externalUrl,
            },
          },
        })
        .from(schema.MediaAsset)
        .leftJoin(
          schema.MediaAssetVersion,
          eq(schema.MediaAsset.currentVersionId, schema.MediaAssetVersion.id)
        )
        .leftJoin(
          schema.StorageLocation,
          eq(schema.MediaAssetVersion.storageLocationId, schema.StorageLocation.id)
        )
        .where(eq(schema.MediaAsset.id, assetId))
        .limit(1)

      const originalUrl = asset?.currentVersion?.storageLocation?.externalUrl || null
      // Update KnowledgeBase.logoLight/logoDark immediately to original URL
      if (session.entityId && originalUrl) {
        const variant = (session.metadata?.variant as string) || 'light'
        const updateData = variant === 'dark' ? { logoDark: originalUrl } : { logoLight: originalUrl }
        await tx
          .update(schema.KnowledgeBase)
          .set(updateData)
          .where(eq(schema.KnowledgeBase.id, session.entityId))
        this.logger.info('Updated KB logo URL (original)', {
          knowledgeBaseId: session.entityId,
          variant,
          url: originalUrl,
        })
      }
      return { assetId, storageLocationId }
    })
    // After commit, enqueue KB logo thumbnails
    try {
      const source: ThumbnailSource = { type: 'asset', assetId: result.assetId }
      await ensureThumbnailPresets({
        organizationId: session.organizationId,
        userId: session.userId,
        source,
        presets: ['kb-logo-sm', 'kb-logo-lg'],
        defaultOptions: { queue: true, visibility: 'PUBLIC' },
      })
    } catch (error) {
      this.logger.error('Failed to enqueue KB logo thumbnails', {
        assetId: result.assetId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
    return result
  }
}
