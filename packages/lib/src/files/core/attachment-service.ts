// packages/lib/src/files/core/attachment-service.ts
import { database as db, schema, type Database, type Transaction } from '@auxx/database'
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
  count as dCount,
  or,
  ilike,
  isNull,
  isNotNull,
  gte,
} from 'drizzle-orm'
import type {
  CreateAttachmentRequest,
  UpdateAttachmentRequest,
  EntityType,
  AttachmentRole,
  AttachmentWithRelations,
  BulkOperationResult,
  BulkOperationOptions,
  FileDownloadInfo,
  SearchOptions,
  AttachmentSearchResult,
} from './types'
import { BaseService } from './base-service'
import { createScopedLogger } from '@auxx/logger'
import type { DownloadRef } from '../adapters/base-adapter'
import type { AttachmentEntity as Attachment } from '@auxx/database/models'
const logger = createScopedLogger('attachment-service')
/**
 * Grouped attachment information for display
 */
export interface GroupedAttachmentInfo {
  id: string
  role: string
  title?: string | null
  sort: number
  createdAt: Date
  type: 'file' | 'asset'
  fileId: string
  name: string
  mimeType?: string | null
  size?: bigint | null
}
/**
 * Authorization callback for entity access control
 */
type Authorizer = (args: {
  organizationId: string
  entityType: EntityType
  entityId: string
  userId?: string
}) => Promise<boolean> | boolean
/**
 * Download descriptor for content access
 */
export interface AttachmentDownloadDescriptor {
  url?: string
  stream?: NodeJS.ReadableStream
  filename: string
  mimeType?: string
  size?: bigint
  expiresAt?: Date
}
/**
 * Service for unified attachment system handling both FolderFile and MediaAsset
 * Manages attachment CRUD operations, entity relationships, and bulk operations
 */
export class AttachmentService extends BaseService<
  Attachment,
  AttachmentWithRelations,
  CreateAttachmentRequest,
  UpdateAttachmentRequest,
  AttachmentSearchResult
> {
  private readonly logger = createScopedLogger('attachment-service')
  constructor(
    organizationId?: string,
    userId?: string,
    dbInstance: Database | Transaction = db,
    private authorize?: Authorizer
  ) {
    super(organizationId, userId, dbInstance)
  }
  protected getEntityName(): string {
    return 'attachment'
  }
  /**
   * Get relation includes for attachment entities
   */
  protected getRelationIncludes(): any {
    return {
      // Drizzle path uses explicit joins in callers; includes retained for compatibility
    }
  }
  /**
   * Get searchable fields for attachment search
   */
  protected getSearchFields(): string[] {
    return ['title', 'caption']
  }
  protected async processCreateData(data: CreateAttachmentRequest): Promise<any> {
    const orgId = data.organizationId || this.requireOrganization()
    const userId = data.createdById || this.requireUserId()
    this.validateTarget(data)
    await this.ensureAuth(data.entityType, data.entityId)
    const sort = data.sort ?? (await this.nextSort(data.entityType, data.entityId))
    return {
      organizationId: orgId,
      entityType: data.entityType,
      entityId: data.entityId,
      role: data.role || 'ATTACHMENT',
      title: data.title,
      caption: data.caption,
      sort,
      fileId: data.fileId,
      fileVersionId: data.fileVersionId,
      assetId: data.assetId,
      assetVersionId: data.assetVersionId,
      createdById: userId,
    }
  }
  // ============= Private Helper Methods =============
  /**
   * Ensure user has access to the target entity
   */
  private async ensureAuth(entityType: EntityType, entityId: string): Promise<void> {
    if (!this.authorize) return
    const ok = await this.authorize({
      organizationId: this.requireOrganization(),
      entityType,
      entityId,
      userId: this.userId,
    })
    if (!ok) {
      throw new Error('Forbidden: Access denied to entity')
    }
  }
  /**
   * Validate XOR constraint: exactly one of fileId or assetId
   */
  private validateTarget(data: CreateAttachmentRequest): void {
    const fileSide = !!(data.fileId || data.fileVersionId)
    const assetSide = !!(data.assetId || data.assetVersionId)
    if (fileSide === assetSide) {
      throw new Error('Provide exactly one of file* or asset*')
    }
    if (data.fileVersionId && !data.fileId) {
      throw new Error('fileVersionId requires fileId')
    }
    if (data.assetVersionId && !data.assetId) {
      throw new Error('assetVersionId requires assetId')
    }
  }
  /**
   * Resolve the effective version for content access: pinned → current
   */
  private async resolveVersion(attachmentId: string): Promise<{
    attachment: AttachmentWithRelations
    version: any
    storageLocationId: string
    side: 'file' | 'asset'
    isPinned: boolean
  }> {
    const orgId = this.requireOrganization()
    // Fetch attachment core fields
    const [attachment] = await this.db
      .select({
        id: schema.Attachment.id,
        organizationId: schema.Attachment.organizationId,
        entityType: schema.Attachment.entityType,
        entityId: schema.Attachment.entityId,
        role: schema.Attachment.role,
        title: schema.Attachment.title,
        caption: schema.Attachment.caption,
        sort: schema.Attachment.sort,
        fileId: schema.Attachment.fileId,
        fileVersionId: schema.Attachment.fileVersionId,
        assetId: schema.Attachment.assetId,
        assetVersionId: schema.Attachment.assetVersionId,
        createdById: schema.Attachment.createdById,
        createdAt: schema.Attachment.createdAt,
      })
      .from(schema.Attachment)
      .where(
        and(eq(schema.Attachment.id, attachmentId), eq(schema.Attachment.organizationId, orgId))
      )
      .limit(1)
    // const attachment = attRow as unknown as AttachmentWithRelations | null
    if (!attachment) {
      throw new Error('Attachment not found')
    }
    // Determine which side (file or asset) and if pinned
    let side: 'file' | 'asset'
    let isPinned: boolean
    let version: any
    if (attachment.fileId) {
      side = 'file'
      isPinned = !!attachment.fileVersionId
      if (attachment.fileVersionId) {
        const [fv] = await this.db
          .select({
            id: schema.FileVersion.id,
            mimeType: schema.FileVersion.mimeType,
            size: schema.FileVersion.size,
            storageLocationId: schema.FileVersion.storageLocationId,
          })
          .from(schema.FileVersion)
          .where(eq(schema.FileVersion.id, attachment.fileVersionId as string))
          .limit(1)
        version = fv
      } else {
        const [row] = await this.db
          .select({
            mimeType: schema.FileVersion.mimeType,
            size: schema.FileVersion.size,
            storageLocationId: schema.FileVersion.storageLocationId,
          })
          .from(schema.FolderFile)
          .innerJoin(
            schema.FileVersion,
            eq(schema.FolderFile.currentVersionId, schema.FileVersion.id)
          )
          .where(eq(schema.FolderFile.id, attachment.fileId as string))
          .limit(1)
        version = row
      }
    } else if (attachment.assetId) {
      side = 'asset'
      isPinned = !!attachment.assetVersionId
      if (attachment.assetVersionId) {
        const [av] = await this.db
          .select({
            id: schema.MediaAssetVersion.id,
            mimeType: schema.MediaAssetVersion.mimeType,
            size: schema.MediaAssetVersion.size,
            storageLocationId: schema.MediaAssetVersion.storageLocationId,
          })
          .from(schema.MediaAssetVersion)
          .where(eq(schema.MediaAssetVersion.id, attachment.assetVersionId as string))
          .limit(1)
        version = av
      } else {
        const [row] = await this.db
          .select({
            mimeType: schema.MediaAssetVersion.mimeType,
            size: schema.MediaAssetVersion.size,
            storageLocationId: schema.MediaAssetVersion.storageLocationId,
          })
          .from(schema.MediaAsset)
          .innerJoin(
            schema.MediaAssetVersion,
            eq(schema.MediaAsset.currentVersionId, schema.MediaAssetVersion.id)
          )
          .where(eq(schema.MediaAsset.id, attachment.assetId as string))
          .limit(1)
        version = row
      }
    } else {
      throw new Error('Attachment has no valid file or asset reference')
    }
    if (!version || !(version as any).storageLocationId) {
      throw new Error('No storage location available for attachment')
    }
    return {
      attachment,
      version,
      storageLocationId: (version as any).storageLocationId,
      side,
      isPinned,
    }
  }
  /**
   * Calculate next sort order for entity attachments
   */
  private async nextSort(entityType: EntityType, entityId: string): Promise<number> {
    const orgId = this.requireOrganization()
    const [row] = await this.db
      .select({ sort: schema.Attachment.sort })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, orgId),
          eq(schema.Attachment.entityType, entityType),
          eq(schema.Attachment.entityId, entityId)
        )
      )
      .orderBy(desc(schema.Attachment.sort))
      .limit(1)
    return ((row?.sort as number | undefined) ?? 0) + 1
  }
  // ============= Attachment CRUD Operations =============
  /**
   * Create a new attachment with idempotency support
   */
  async create(data: CreateAttachmentRequest): Promise<Attachment> {
    const orgId = data.organizationId || this.requireOrganization()
    // Check for existing attachment if idempotency key provided
    if (data.idempotencyKey) {
      const [existing] = await this.db
        .select({
          id: schema.Attachment.id,
          role: schema.Attachment.role,
          title: schema.Attachment.title,
          caption: schema.Attachment.caption,
          sort: schema.Attachment.sort,
          fileId: schema.Attachment.fileId,
          fileVersionId: schema.Attachment.fileVersionId,
          assetId: schema.Attachment.assetId,
          assetVersionId: schema.Attachment.assetVersionId,
          entityId: schema.Attachment.entityId,
          entityType: schema.Attachment.entityType,
          createdAt: schema.Attachment.createdAt,
          createdById: schema.Attachment.createdById,
        })
        .from(schema.Attachment)
        .where(
          and(
            eq(schema.Attachment.organizationId, orgId),
            eq(schema.Attachment.entityType, data.entityType),
            eq(schema.Attachment.entityId, data.entityId),
            sql`coalesce(${schema.Attachment.title}, '') = ${data.title ?? ''}`,
            sql`coalesce(${schema.Attachment.fileId}, '') = ${data.fileId ?? ''}`,
            sql`coalesce(${schema.Attachment.assetId}, '') = ${data.assetId ?? ''}`
          )
        )
        .limit(1)
      if (existing) {
        this.logger.info('Returning existing attachment for idempotency key', {
          attachmentId: (existing as any).id,
          idempotencyKey: data.idempotencyKey,
        })
        return existing as unknown as Attachment
      }
    }
    const processed = await this.processCreateData(data)
    const [created] = await this.db.insert(schema.Attachment).values(processed).returning()

    // Safety check: If insert fails, provide clear error
    if (!created) {
      const target = data.fileId
        ? `FolderFile '${data.fileId}'`
        : data.assetId
          ? `MediaAsset '${data.assetId}'`
          : 'unknown target'
      throw new Error(
        `Failed to create attachment: Database insert returned no data. ` +
          `This usually indicates a foreign key constraint violation. ` +
          `Please verify that ${target} exists and belongs to organization '${orgId}'.`
      )
    }

    return created as unknown as Attachment
  }
  /**
   * Get an attachment by ID with organization scoping
   */
  async get(id: string): Promise<Attachment | null> {
    const [row] = await this.db
      .select()
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.id, id),
          eq(schema.Attachment.organizationId, this.requireOrganization())
        )
      )
      .limit(1)
    return (row as unknown as Attachment) || null
  }
  /**
   * Get an attachment with all populated relations
   */
  async getWithRelations(id: string): Promise<AttachmentWithRelations | null> {
    // Minimal implementation returns base row; callers should join explicitly if needed
    const base = await this.get(id)
    return (base as unknown as AttachmentWithRelations) || null
  }
  /**
   * Update an existing attachment
   */
  async update(id: string, data: UpdateAttachmentRequest): Promise<Attachment> {
    const orgId = this.requireOrganization()
    // Ensure attachment exists and is accessible
    const existing = await this.get(id)
    if (!existing) {
      throw new Error('Attachment not found')
    }
    await this.ensureAuth(existing.entityType as EntityType, existing.entityId)
    const [updated] = await this.db
      .update(schema.Attachment)
      .set({ ...(data as any) })
      .where(and(eq(schema.Attachment.id, id), eq(schema.Attachment.organizationId, orgId)))
      .returning()
    return updated as unknown as Attachment
  }
  /**
   * Delete an attachment
   */
  async delete(id: string): Promise<void> {
    const orgId = this.requireOrganization()
    // Get attachment to check authorization
    const attachment = await this.get(id)
    if (!attachment) {
      throw new Error('Attachment not found')
    }
    await this.ensureAuth(attachment.entityType as EntityType, attachment.entityId)
    await this.db
      .delete(schema.Attachment)
      .where(and(eq(schema.Attachment.id, id), eq(schema.Attachment.organizationId, orgId)))
  }
  // ============= Entity Attachment Management =============
  /**
   * Get all attachments for a specific entity
   */
  async getEntityAttachments(entityType: EntityType, entityId: string): Promise<Attachment[]> {
    await this.ensureAuth(entityType, entityId)
    const rows = await this.db
      .select()
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, this.requireOrganization()),
          eq(schema.Attachment.entityType, entityType),
          eq(schema.Attachment.entityId, entityId)
        )
      )
      .orderBy(asc(schema.Attachment.sort), asc(schema.Attachment.createdAt))
    return rows as unknown as Attachment[]
  }
  /**
   * Get attachments for entity with specific role
   */
  async getEntityAttachmentsByRole(
    entityType: EntityType,
    entityId: string,
    role: AttachmentRole
  ): Promise<Attachment[]> {
    await this.ensureAuth(entityType, entityId)
    const rows = await this.db
      .select()
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, this.requireOrganization()),
          eq(schema.Attachment.entityType, entityType),
          eq(schema.Attachment.entityId, entityId),
          eq(schema.Attachment.role, role)
        )
      )
      .orderBy(asc(schema.Attachment.sort), asc(schema.Attachment.createdAt))
    return rows as unknown as Attachment[]
  }
  /**
   * Attach a file to an entity
   */
  async attachFileToEntity(
    fileId: string,
    entityType: EntityType,
    entityId: string,
    createdById: string,
    role: AttachmentRole = 'ATTACHMENT',
    options?: {
      title?: string
      caption?: string
      sort?: number
    }
  ) {
    return this.create({
      entityType,
      entityId,
      role,
      title: options?.title,
      caption: options?.caption,
      fileId,
      createdById,
      sort: options?.sort,
    })
  }
  /**
   * Attach a specific file version to an entity
   */
  async attachFileVersionToEntity(
    fileId: string,
    fileVersionId: string,
    entityType: EntityType,
    entityId: string,
    createdById: string,
    role: AttachmentRole = 'ATTACHMENT',
    options?: {
      title?: string
      caption?: string
      sort?: number
    }
  ) {
    return this.create({
      entityType,
      entityId,
      role,
      title: options?.title,
      caption: options?.caption,
      fileId,
      fileVersionId,
      createdById,
      sort: options?.sort,
    })
  }
  /**
   * Attach a media asset to an entity
   */
  async attachAssetToEntity(
    assetId: string,
    entityType: EntityType,
    entityId: string,
    createdById: string,
    role?: AttachmentRole,
    options?: {
      title?: string
      caption?: string
      sort?: number
    }
  ): Promise<Attachment> {
    // TODO: Implement asset attachment to entity
    throw new Error('Not implemented')
  }
  /**
   * Attach a specific asset version to an entity
   */
  async attachAssetVersionToEntity(
    assetId: string,
    assetVersionId: string,
    entityType: EntityType,
    entityId: string,
    createdById: string,
    role?: AttachmentRole,
    options?: {
      title?: string
      caption?: string
      sort?: number
    }
  ): Promise<Attachment> {
    // TODO: Implement asset version attachment to entity
    throw new Error('Not implemented')
  }
  /**
   * Detach a specific attachment from an entity
   */
  async detachFromEntity(
    entityType: EntityType,
    entityId: string,
    attachmentId: string
  ): Promise<void> {
    await this.ensureAuth(entityType, entityId)
    await this.db.delete(schema.Attachment).where(eq(schema.Attachment.id, attachmentId))
  }
  // ============= Bulk Operations =============
  /**
   * Attach multiple files to an entity
   */
  async bulkAttachFiles(
    fileIds: string[],
    entityType: EntityType,
    entityId: string,
    createdById: string,
    role?: AttachmentRole,
    options?: BulkOperationOptions
  ): Promise<BulkOperationResult<Attachment>> {
    // TODO: Implement bulk file attachment
    throw new Error('Not implemented')
  }
  /**
   * Attach multiple assets to an entity
   */
  async bulkAttachAssets(
    assetIds: string[],
    entityType: EntityType,
    entityId: string,
    createdById: string,
    role?: AttachmentRole,
    options?: BulkOperationOptions
  ): Promise<BulkOperationResult<Attachment>> {
    // TODO: Implement bulk asset attachment
    throw new Error('Not implemented')
  }
  /**
   * Remove all attachments from an entity
   */
  async bulkDetachFromEntity(entityType: EntityType, entityId: string): Promise<void> {
    // TODO: Implement bulk attachment removal
    throw new Error('Not implemented')
  }
  /**
   * Reorder attachments for an entity
   */
  async reorderAttachments(
    entityType: EntityType,
    entityId: string,
    attachmentIds: string[]
  ): Promise<void> {
    await this.ensureAuth(entityType, entityId)
    const orgId = this.requireOrganization()

    // Update each attachment's sort order
    for (let idx = 0; idx < attachmentIds.length; idx++) {
      await this.db
        .update(schema.Attachment)
        .set({ sort: idx + 1 })
        .where(eq(schema.Attachment.id, attachmentIds[idx]))
    }

    logger.info('Reordered attachments', {
      entityType,
      entityId,
      count: attachmentIds.length,
      organizationId: orgId,
    })
  }
  /**
   * Update attachment roles in bulk
   */
  async bulkUpdateRoles(
    attachmentIds: string[],
    newRole: AttachmentRole,
    options?: BulkOperationOptions
  ): Promise<BulkOperationResult<Attachment>> {
    // TODO: Implement bulk role updates
    throw new Error('Not implemented')
  }
  // ============= Attachment Content & Access =============
  /**
   * Get download reference for an attachment
   */
  async getDownloadRef(id: string): Promise<DownloadRef> {
    const { attachment, storageLocationId, version } = await this.resolveVersion(id)
    // If attachment is pinned to a specific version, get download ref directly from storage
    if (attachment.fileVersionId || attachment.assetVersionId) {
      const { createStorageManager } = await import('../storage/storage-manager')
      const storageManager = createStorageManager(this.requireOrganization())
      return await storageManager.getDownloadRef({
        locationId: storageLocationId,
        filename: attachment.title || undefined,
        mimeType: (version as any)?.mimeType || undefined,
      })
    }
    // Otherwise delegate to appropriate service for current version
    if (attachment.fileId) {
      const { FileService } = await import('./file-service')
      const fileService = new FileService(this.requireOrganization(), this.userId, this.db)
      return await fileService.getDownloadRef(attachment.fileId)
    }
    if (attachment.assetId) {
      const { MediaAssetService } = await import('./media-asset-service')
      const assetService = new MediaAssetService(this.requireOrganization(), this.userId, this.db)
      return await assetService.getDownloadRef(attachment.assetId)
    }
    throw new Error('Attachment has no valid file or asset reference')
  }
  /**
   * Get download URL for an attachment (legacy method)
   */
  async getDownloadUrl(id: string): Promise<string> {
    const downloadRef = await this.getDownloadRef(id)
    if (downloadRef.type === 'url') {
      return downloadRef.url
    }
    throw new Error('Attachment content is not available via URL')
  }
  /**
   * Get detailed download information for an attachment
   */
  async getDownloadInfo(id: string): Promise<FileDownloadInfo> {
    const { attachment, version } = await this.resolveVersion(id)
    const downloadRef = await this.getDownloadRef(id)
    return {
      kind: downloadRef.type,
      url: downloadRef.type === 'url' ? downloadRef.url : undefined,
      filename: attachment.title || version.name || 'attachment',
      mimeType: version.mimeType || undefined,
      size: version.size || undefined,
      expiresAt: downloadRef.type === 'url' ? downloadRef.expiresAt : undefined,
    }
  }
  /**
   * Get attachment content as Buffer
   */
  async getContent(id: string): Promise<Buffer> {
    const { attachment, storageLocationId } = await this.resolveVersion(id)
    // If attachment is pinned to a specific version, get content directly from storage
    if (attachment.fileVersionId || attachment.assetVersionId) {
      const { createStorageManager } = await import('../storage/storage-manager')
      const storageManager = createStorageManager(this.requireOrganization())
      return storageManager.getContent(storageLocationId)
    }
    // Otherwise delegate to appropriate service for current version
    if (attachment.fileId) {
      const { FileService } = await import('./file-service')
      const fileService = new FileService(this.requireOrganization(), this.userId, this.db)
      return fileService.getContent(attachment.fileId)
    }
    if (attachment.assetId) {
      const { MediaAssetService } = await import('./media-asset-service')
      const assetService = new MediaAssetService(this.requireOrganization(), this.userId, this.db)
      return assetService.getContent(attachment.assetId)
    }
    throw new Error('Attachment has no valid file or asset reference')
  }
  /**
   * Stream attachment content
   */
  async streamContent(id: string): Promise<NodeJS.ReadableStream> {
    const { attachment, storageLocationId } = await this.resolveVersion(id)
    // If attachment is pinned to a specific version, stream content directly from storage
    if (attachment.fileVersionId || attachment.assetVersionId) {
      const { createStorageManager } = await import('../storage/storage-manager')
      const storageManager = createStorageManager(this.requireOrganization())
      return storageManager.streamContent(storageLocationId)
    }
    // Otherwise delegate to appropriate service for current version
    if (attachment.fileId) {
      const { FileService } = await import('./file-service')
      const fileService = new FileService(this.requireOrganization(), this.userId, this.db)
      return fileService.streamContent(attachment.fileId)
    }
    if (attachment.assetId) {
      const { MediaAssetService } = await import('./media-asset-service')
      const assetService = new MediaAssetService(this.requireOrganization(), this.userId, this.db)
      return assetService.streamContent(attachment.assetId)
    }
    throw new Error('Attachment has no valid file or asset reference')
  }
  // ============= Entity Operations =============
  /**
   * Copy all attachments from one entity to another
   */
  async copyAttachmentsToEntity(
    sourceEntityType: EntityType,
    sourceEntityId: string,
    targetEntityType: EntityType,
    targetEntityId: string,
    createdById: string
  ): Promise<Attachment[]> {
    await this.ensureAuth(sourceEntityType, sourceEntityId)
    await this.ensureAuth(targetEntityType, targetEntityId)
    const sourceAttachments = await this.getEntityAttachments(sourceEntityType, sourceEntityId)
    const copiedAttachments: Attachment[] = []
    for (const sourceAttachment of sourceAttachments) {
      const newAttachment = await this.create({
        entityType: targetEntityType,
        entityId: targetEntityId,
        role: sourceAttachment.role as AttachmentRole,
        title: sourceAttachment.title || undefined,
        caption: sourceAttachment.caption || undefined,
        fileId: sourceAttachment.fileId || undefined,
        fileVersionId: sourceAttachment.fileVersionId || undefined,
        assetId: sourceAttachment.assetId || undefined,
        assetVersionId: sourceAttachment.assetVersionId || undefined,
        createdById,
      })
      copiedAttachments.push(newAttachment)
    }
    return copiedAttachments
  }
  /**
   * Move all attachments from one entity to another
   */
  async moveAttachmentsToEntity(
    sourceEntityType: EntityType,
    sourceEntityId: string,
    targetEntityType: EntityType,
    targetEntityId: string
  ): Promise<Attachment[]> {
    await this.ensureAuth(sourceEntityType, sourceEntityId)
    await this.ensureAuth(targetEntityType, targetEntityId)
    const orgId = this.requireOrganization()

    // Get all attachments for the source entity
    const attachments = await this.db
      .select()
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, orgId),
          eq(schema.Attachment.entityType, sourceEntityType),
          eq(schema.Attachment.entityId, sourceEntityId)
        )
      )

    // Update all attachments to the target entity
    const updatedAttachments: Attachment[] = []
    for (const attachment of attachments) {
      const [updated] = await this.db
        .update(schema.Attachment)
        .set({
          entityType: targetEntityType,
          entityId: targetEntityId,
        })
        .where(eq(schema.Attachment.id, attachment.id))
        .returning()

      if (updated) {
        updatedAttachments.push(updated as unknown as Attachment)
      }
    }

    return updatedAttachments
  }
  /**
   * Get attachment statistics for an entity (uses exact resolved versions for accurate sizes)
   */
  async getEntityAttachmentStats(
    entityType: EntityType,
    entityId: string
  ): Promise<{
    totalAttachments: number
    totalSize: bigint
    attachmentsByRole: Record<string, number>
    fileAttachments: number
    assetAttachments: number
  }> {
    await this.ensureAuth(entityType, entityId)
    const orgId = this.requireOrganization()
    const attachments = await this.db
      .select()
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, orgId),
          eq(schema.Attachment.entityType, entityType),
          eq(schema.Attachment.entityId, entityId)
        )
      )
    let totalSize = BigInt(0)
    const attachmentsByRole: Record<string, number> = {}
    let fileAttachments = 0
    let assetAttachments = 0
    // Process attachments in batches to avoid overwhelming the system
    const batchSize = 10
    for (let i = 0; i < attachments.length; i += batchSize) {
      const batch = attachments.slice(i, i + batchSize)
      // Process batch in parallel
      const resolvedVersions = await Promise.all(
        batch.map(async (attachment) => {
          try {
            const { version, side } = await this.resolveVersion(attachment.id)
            return { attachment, version, side }
          } catch {
            // Handle cases where attachment might be broken/orphaned
            return { attachment, version: null, side: null }
          }
        })
      )
      for (const { attachment, version, side } of resolvedVersions) {
        // Count by role
        attachmentsByRole[attachment.role] = (attachmentsByRole[attachment.role] || 0) + 1
        // Count by type and accumulate exact size
        if (side === 'file') {
          fileAttachments++
        } else if (side === 'asset') {
          assetAttachments++
        }
        if (version?.size) {
          totalSize += BigInt(version.size)
        }
      }
    }
    return {
      totalAttachments: attachments.length,
      totalSize,
      attachmentsByRole,
      fileAttachments,
      assetAttachments,
    }
  }
  // ============= Search & Query =============
  /**
   * Search attachments by title or caption
   */
  async search(query: string, options?: SearchOptions): Promise<AttachmentSearchResult[]> {
    const orgId = this.requireOrganization()
    const limit = options?.limit || 50
    const offset = options?.offset || 0

    const results = await this.db
      .select({
        id: schema.Attachment.id,
        organizationId: schema.Attachment.organizationId,
        entityType: schema.Attachment.entityType,
        entityId: schema.Attachment.entityId,
        role: schema.Attachment.role,
        title: schema.Attachment.title,
        caption: schema.Attachment.caption,
        sort: schema.Attachment.sort,
        fileId: schema.Attachment.fileId,
        fileVersionId: schema.Attachment.fileVersionId,
        assetId: schema.Attachment.assetId,
        assetVersionId: schema.Attachment.assetVersionId,
        createdById: schema.Attachment.createdById,
        createdAt: schema.Attachment.createdAt,
      })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, orgId),
          or(
            ilike(schema.Attachment.title, `%${query}%`),
            ilike(schema.Attachment.caption, `%${query}%`)
          )
        )
      )
      .orderBy(desc(schema.Attachment.createdAt))
      .limit(limit)
      .offset(offset)

    return results
      .map((attachment): AttachmentSearchResult => {
        let relevance = 0
        const matchedFields: string[] = []
        if (attachment.title?.toLowerCase().includes(query.toLowerCase())) {
          relevance += attachment.title.toLowerCase() === query.toLowerCase() ? 10 : 5
          matchedFields.push('title')
        }
        if (attachment.caption?.toLowerCase().includes(query.toLowerCase())) {
          relevance += attachment.caption.toLowerCase() === query.toLowerCase() ? 8 : 3
          matchedFields.push('caption')
        }
        return {
          attachment: attachment as unknown as Attachment,
          relevance: Math.max(relevance, 1),
          matchedFields,
          snippet:
            [attachment.title, attachment.caption].filter(Boolean).join(' | ') || 'Attachment',
        }
      })
      .sort((a, b) => b.relevance - a.relevance)
  }
  /**
   * Get attachments by role across organization
   */
  async getAttachmentsByRole(role: AttachmentRole): Promise<Attachment[]> {
    const results = await this.db
      .select()
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, this.requireOrganization()),
          eq(schema.Attachment.role, role)
        )
      )
      .orderBy(desc(schema.Attachment.createdAt))

    return results as unknown as Attachment[]
  }
  /**
   * Get recent attachments for organization
   */
  async getRecentAttachments(limit = 50): Promise<Attachment[]> {
    const results = await this.db
      .select()
      .from(schema.Attachment)
      .where(eq(schema.Attachment.organizationId, this.requireOrganization()))
      .orderBy(desc(schema.Attachment.createdAt))
      .limit(limit)

    return results as unknown as Attachment[]
  }
  /**
   * Get attachments by creator
   */
  async getAttachmentsByCreator(userId: string): Promise<Attachment[]> {
    const results = await this.db
      .select()
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, this.requireOrganization()),
          eq(schema.Attachment.createdById, userId)
        )
      )
      .orderBy(desc(schema.Attachment.createdAt))

    return results as unknown as Attachment[]
  }
  // ============= Maintenance Operations =============
  /**
   * Clean up orphaned attachments (no valid entity reference)
   */
  async cleanupOrphanedAttachments(): Promise<number> {
    const orgId = this.requireOrganization()

    // Find attachments with file references but no corresponding file
    const orphanedFileAttachments = await this.db
      .select({ id: schema.Attachment.id })
      .from(schema.Attachment)
      .leftJoin(schema.FolderFile, eq(schema.Attachment.fileId, schema.FolderFile.id))
      .where(
        and(
          eq(schema.Attachment.organizationId, orgId),
          isNotNull(schema.Attachment.fileId),
          isNull(schema.FolderFile.id)
        )
      )

    // Find attachments with asset references but no corresponding asset
    const orphanedAssetAttachments = await this.db
      .select({ id: schema.Attachment.id })
      .from(schema.Attachment)
      .leftJoin(schema.MediaAsset, eq(schema.Attachment.assetId, schema.MediaAsset.id))
      .where(
        and(
          eq(schema.Attachment.organizationId, orgId),
          isNotNull(schema.Attachment.assetId),
          isNull(schema.MediaAsset.id)
        )
      )

    const allOrphanedIds = [
      ...orphanedFileAttachments.map((a) => a.id),
      ...orphanedAssetAttachments.map((a) => a.id),
    ]

    if (allOrphanedIds.length === 0) {
      return 0
    }

    // Delete orphaned attachments
    await this.db.delete(schema.Attachment).where(inArray(schema.Attachment.id, allOrphanedIds))

    this.logger.info('Cleaned up orphaned attachments', {
      count: allOrphanedIds.length,
      organizationId: orgId,
    })
    return allOrphanedIds.length
  }
  /**
   * Fix attachment sort orders
   */
  async fixAttachmentSortOrders(entityType: EntityType, entityId: string): Promise<number> {
    await this.ensureAuth(entityType, entityId)
    const orgId = this.requireOrganization()

    const attachments = await this.db
      .select({
        id: schema.Attachment.id,
        sort: schema.Attachment.sort,
      })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, orgId),
          eq(schema.Attachment.entityType, entityType),
          eq(schema.Attachment.entityId, entityId)
        )
      )
      .orderBy(asc(schema.Attachment.sort), asc(schema.Attachment.createdAt))

    if (attachments.length === 0) {
      return 0
    }

    // Check if reordering is needed
    const needsReordering = attachments.some((attachment, index) => attachment.sort !== index + 1)
    if (!needsReordering) {
      return 0
    }

    // Fix sort orders
    for (let index = 0; index < attachments.length; index++) {
      await this.db
        .update(schema.Attachment)
        .set({ sort: index + 1 })
        .where(eq(schema.Attachment.id, attachments[index].id))
    }

    this.logger.info('Fixed attachment sort orders', {
      entityType,
      entityId,
      count: attachments.length,
      organizationId: orgId,
    })
    return attachments.length
  }
  /**
   * Validate attachment integrity
   */
  async validateAttachmentIntegrity(): Promise<{
    validAttachments: number
    invalidAttachments: number
    errors: string[]
  }> {
    const orgId = this.requireOrganization()
    const errors: string[] = []

    // Get all attachments with their related entities
    const attachments = await this.db
      .select({
        id: schema.Attachment.id,
        fileId: schema.Attachment.fileId,
        fileVersionId: schema.Attachment.fileVersionId,
        assetId: schema.Attachment.assetId,
        assetVersionId: schema.Attachment.assetVersionId,
        fileExists: schema.FolderFile.id,
        assetExists: schema.MediaAsset.id,
        fileVersionExists: schema.FileVersion.id,
        assetVersionExists: schema.MediaAssetVersion.id,
      })
      .from(schema.Attachment)
      .leftJoin(schema.FolderFile, eq(schema.Attachment.fileId, schema.FolderFile.id))
      .leftJoin(schema.MediaAsset, eq(schema.Attachment.assetId, schema.MediaAsset.id))
      .leftJoin(schema.FileVersion, eq(schema.Attachment.fileVersionId, schema.FileVersion.id))
      .leftJoin(
        schema.MediaAssetVersion,
        eq(schema.Attachment.assetVersionId, schema.MediaAssetVersion.id)
      )
      .where(eq(schema.Attachment.organizationId, orgId))

    let validAttachments = 0
    let invalidAttachments = 0

    for (const attachment of attachments) {
      let isValid = true

      // Check XOR constraint
      const hasFile = !!(attachment.fileId || attachment.fileVersionId)
      const hasAsset = !!(attachment.assetId || attachment.assetVersionId)
      if (hasFile === hasAsset) {
        errors.push(`Attachment ${attachment.id}: Must have exactly one of file or asset reference`)
        isValid = false
      }

      // Check file version consistency
      if (attachment.fileVersionId && !attachment.fileId) {
        errors.push(`Attachment ${attachment.id}: fileVersionId requires fileId`)
        isValid = false
      }

      // Check asset version consistency
      if (attachment.assetVersionId && !attachment.assetId) {
        errors.push(`Attachment ${attachment.id}: assetVersionId requires assetId`)
        isValid = false
      }

      // Check if referenced entities exist
      if (attachment.fileId && !attachment.fileExists) {
        errors.push(`Attachment ${attachment.id}: Referenced file ${attachment.fileId} not found`)
        isValid = false
      }
      if (attachment.assetId && !attachment.assetExists) {
        errors.push(`Attachment ${attachment.id}: Referenced asset ${attachment.assetId} not found`)
        isValid = false
      }
      if (attachment.fileVersionId && !attachment.fileVersionExists) {
        errors.push(
          `Attachment ${attachment.id}: Referenced file version ${attachment.fileVersionId} not found`
        )
        isValid = false
      }
      if (attachment.assetVersionId && !attachment.assetVersionExists) {
        errors.push(
          `Attachment ${attachment.id}: Referenced asset version ${attachment.assetVersionId} not found`
        )
        isValid = false
      }

      if (isValid) {
        validAttachments++
      } else {
        invalidAttachments++
      }
    }

    return {
      validAttachments,
      invalidAttachments,
      errors,
    }
  }
  // ============= Batch Operations for Entities =============
  /**
   * Fetch and group attachments for multiple entities using efficient query
   * Replaces the specific fetchAttachmentsForComments method from CommentService
   */
  async fetchAttachmentsForEntities(
    entityType: EntityType,
    entityIds: string[]
  ): Promise<Map<string, GroupedAttachmentInfo[]>> {
    if (entityIds.length === 0) return new Map()
    const orgId = this.requireOrganization()

    // Use Drizzle query with joins to get all attachment data efficiently
    const attachments = await this.db
      .select({
        id: schema.Attachment.id,
        entityId: schema.Attachment.entityId,
        role: schema.Attachment.role,
        title: schema.Attachment.title,
        sort: schema.Attachment.sort,
        createdAt: schema.Attachment.createdAt,
        assetId: schema.Attachment.assetId,
        fileId: schema.Attachment.fileId,
        // Asset info
        assetName: schema.MediaAsset.name,
        assetMimeType: schema.MediaAsset.mimeType,
        assetSize: schema.MediaAsset.size,
        // File info
        fileName: schema.FolderFile.name,
        fileMimeType: schema.FolderFile.mimeType,
        fileSize: schema.FolderFile.size,
      })
      .from(schema.Attachment)
      .leftJoin(schema.MediaAsset, eq(schema.Attachment.assetId, schema.MediaAsset.id))
      .leftJoin(schema.FolderFile, eq(schema.Attachment.fileId, schema.FolderFile.id))
      .where(
        and(
          eq(schema.Attachment.entityType, entityType),
          inArray(schema.Attachment.entityId, entityIds),
          eq(schema.Attachment.organizationId, orgId)
        )
      )
      .orderBy(asc(schema.Attachment.sort), asc(schema.Attachment.createdAt))

    // Group by entity ID and transform to GroupedAttachmentInfo
    const attachmentMap = new Map<string, GroupedAttachmentInfo[]>()
    for (const attachment of attachments) {
      if (!attachmentMap.has(attachment.entityId)) {
        attachmentMap.set(attachment.entityId, [])
      }
      const info: GroupedAttachmentInfo = {
        id: attachment.id,
        role: attachment.role,
        title: attachment.title,
        sort: attachment.sort,
        createdAt: attachment.createdAt,
        type: attachment.assetId ? 'asset' : 'file',
        fileId: attachment.assetId || attachment.fileId!,
        name: attachment.assetName || attachment.fileName || 'Untitled',
        mimeType: attachment.assetMimeType || attachment.fileMimeType,
        size: attachment.assetSize || attachment.fileSize,
      }
      attachmentMap.get(attachment.entityId)!.push(info)
    }
    return attachmentMap
  }
  // ============= Statistics & Analytics =============
  /**
   * Get attachment statistics for organization
   */
  async getAttachmentStats(): Promise<{
    totalAttachments: number
    attachmentsByEntityType: Record<string, number>
    attachmentsByRole: Record<string, number>
    fileAttachments: number
    assetAttachments: number
    averageAttachmentsPerEntity: number
  }> {
    const orgId = this.requireOrganization()
    const attachments = await this.db
      .select()
      .from(schema.Attachment)
      .where(eq(schema.Attachment.organizationId, orgId))
    const attachmentsByEntityType: Record<string, number> = {}
    const attachmentsByRole: Record<string, number> = {}
    let fileAttachments = 0
    let assetAttachments = 0
    const entityIds = new Set<string>()
    for (const attachment of attachments) {
      // Count by entity type
      attachmentsByEntityType[attachment.entityType] =
        (attachmentsByEntityType[attachment.entityType] || 0) + 1
      // Count by role
      attachmentsByRole[attachment.role] = (attachmentsByRole[attachment.role] || 0) + 1
      // Count by type
      if (attachment.fileId) fileAttachments++
      if (attachment.assetId) assetAttachments++
      // Track unique entities
      entityIds.add(`${attachment.entityType}:${attachment.entityId}`)
    }
    return {
      totalAttachments: attachments.length,
      attachmentsByEntityType,
      attachmentsByRole,
      fileAttachments,
      assetAttachments,
      averageAttachmentsPerEntity: entityIds.size > 0 ? attachments.length / entityIds.size : 0,
    }
  }
  /**
   * Get attachment usage analytics
   */
  async getAttachmentUsage(days = 30): Promise<{
    newAttachments: number
    deletedAttachments: number
    mostUsedEntityTypes: Array<{
      entityType: string
      count: number
    }>
    mostUsedRoles: Array<{
      role: string
      count: number
    }>
  }> {
    const orgId = this.requireOrganization()
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    // Count new attachments
    const [newAttachmentsResult] = await this.db
      .select({ count: dCount() })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, orgId),
          gte(schema.Attachment.createdAt, cutoffDate)
        )
      )
    const newAttachments = newAttachmentsResult?.count || 0

    // Note: We can't easily track deletions without audit logs
    // This would require a separate deletion tracking system
    const deletedAttachments = 0

    // Get usage by entity type
    const entityTypeUsage = await this.db
      .select({
        entityType: schema.Attachment.entityType,
        count: dCount(),
      })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, orgId),
          gte(schema.Attachment.createdAt, cutoffDate)
        )
      )
      .groupBy(schema.Attachment.entityType)
      .orderBy(desc(dCount()))
      .limit(10)

    // Get usage by role
    const roleUsage = await this.db
      .select({
        role: schema.Attachment.role,
        count: dCount(),
      })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, orgId),
          gte(schema.Attachment.createdAt, cutoffDate)
        )
      )
      .groupBy(schema.Attachment.role)
      .orderBy(desc(dCount()))
      .limit(10)
    return {
      newAttachments,
      deletedAttachments,
      mostUsedEntityTypes: entityTypeUsage.map((item) => ({
        entityType: item.entityType,
        count: item.count,
      })),
      mostUsedRoles: roleUsage.map((item) => ({
        role: item.role,
        count: item.count,
      })),
    }
  }
}
// Export factory functions for creating service instances
export const createAttachmentService = (
  organizationId?: string,
  userId?: string,
  authorize?: (args: {
    organizationId: string
    entityType: EntityType
    entityId: string
    userId?: string
  }) => Promise<boolean> | boolean
) => new AttachmentService(organizationId, userId, db, authorize)
// Export singleton instance (with default db, no specific organization)
// export const attachmentService = new AttachmentService()
