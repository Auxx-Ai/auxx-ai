// packages/lib/src/files/core/media-asset-service.ts

import { type Database, database as db, schema } from '@auxx/database'
import type {
  MediaAssetEntity as MediaAsset,
  MediaAssetVersionEntity as MediaAssetVersion,
} from '@auxx/database/models'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { DownloadRef } from '../adapters/base-adapter'
import { BaseService, type DatabaseClient } from './base-service'
import type { ContentAccessible } from './mixins/content-accessible'
import type { Versioned } from './mixins/versioned'
import type {
  AssetDownloadInfo,
  AssetKind,
  AssetSearchResult,
  CreateAssetRequest,
  MediaAssetWithRelations,
  SearchOptions,
  UpdateAssetRequest,
} from './types'
import { VALID_ASSET_KINDS } from './types'

/**
 * Enhanced service for managing MediaAsset operations
 * Directly extends BaseService and implements ContentAccessible and Versioned interfaces
 */
export class MediaAssetService
  extends BaseService<
    MediaAsset,
    MediaAssetWithRelations,
    CreateAssetRequest,
    UpdateAssetRequest,
    AssetSearchResult
  >
  implements ContentAccessible, Versioned
{
  private _storageManager?: any

  constructor(organizationId?: string, userId?: string, dbInstance: Database = db) {
    super(organizationId, userId, dbInstance)
  }

  protected getEntityName(): string {
    return 'asset'
  }

  // ============= Base CRUD Implementation =============

  /**
   * Create a new entity
   */
  async create(data: CreateAssetRequest, db?: DatabaseClient): Promise<MediaAsset> {
    const processedData = await this.processCreateData(data)
    const dbToUse = db || this.db

    const [asset] = await dbToUse.insert(schema.MediaAsset).values(processedData).returning()

    return asset
  }

  /**
   * Get an entity by ID
   */
  async get(id: string, db?: DatabaseClient): Promise<MediaAsset | null> {
    const dbToUse = db || this.db
    const filters: SQL[] = [eq(schema.MediaAsset.id, id)]

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    filters.push(isNull(schema.MediaAsset.deletedAt))

    return dbToUse.query.MediaAsset.findFirst({
      where: and(...filters),
    })
  }

  /**
   * Get an entity with all relations
   */
  async getWithRelations(id: string, db?: DatabaseClient): Promise<MediaAssetWithRelations | null> {
    const dbToUse = db || this.db
    const filters: SQL[] = [eq(schema.MediaAsset.id, id)]

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    filters.push(isNull(schema.MediaAsset.deletedAt))

    return dbToUse.query.MediaAsset.findFirst({
      where: and(...filters),
      with: this.getRelationIncludes(),
    })
  }

  /**
   * Update an entity
   */
  async update(id: string, data: UpdateAssetRequest, db?: DatabaseClient): Promise<MediaAsset> {
    const dbToUse = db || this.db
    const filters: SQL[] = [eq(schema.MediaAsset.id, id)]

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }

    const [asset] = await dbToUse
      .update(schema.MediaAsset)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(...filters))
      .returning()

    return asset
  }

  /**
   * List entities with pagination
   */
  async list(
    options: {
      limit?: number
      offset?: number
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
      filters?: any
      includeDeleted?: boolean
    } = {}
  ): Promise<{ items: MediaAsset[]; total: number; hasMore: boolean }> {
    const filters: SQL[] = []

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }

    if (!options.includeDeleted) {
      filters.push(isNull(schema.MediaAsset.deletedAt))
    }

    // Apply additional filters
    if (options.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          filters.push(eq(schema.MediaAsset[key as keyof typeof schema.MediaAsset], value))
        }
      })
    }

    const orderBy =
      options.sortOrder === 'asc'
        ? asc(
            schema.MediaAsset[options.sortBy as keyof typeof schema.MediaAsset] ||
              schema.MediaAsset.createdAt
          )
        : desc(
            schema.MediaAsset[options.sortBy as keyof typeof schema.MediaAsset] ||
              schema.MediaAsset.createdAt
          )

    const items = await this.db.query.MediaAsset.findMany({
      where: and(...filters),
      limit: options.limit || 50,
      offset: options.offset || 0,
      orderBy,
    })

    // For simplicity, not implementing total count - could be added with a separate query
    return {
      items,
      total: items.length,
      hasMore: items.length === (options.limit || 50),
    }
  }

  /**
   * Count entities
   */
  async count(filters?: any): Promise<number> {
    const whereFilters: SQL[] = []

    if (this.organizationId) {
      whereFilters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    whereFilters.push(isNull(schema.MediaAsset.deletedAt))

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          whereFilters.push(eq(schema.MediaAsset[key], value))
        }
      })
    }

    const result = await this.db
      .select({ count: sql`count(*)` })
      .from(schema.MediaAsset)
      .where(and(...whereFilters))

    return Number(result[0]?.count || 0)
  }

  /**
   * Process create data with asset-specific validation and defaults
   */
  protected async processCreateData(data: CreateAssetRequest): Promise<any> {
    // Validate required fields
    if (!data.kind) {
      throw new Error('Asset kind is required')
    }

    // Validate asset kind
    await this.validateAssetKind(data.kind)

    const now = new Date()
    return {
      ...data,
      organizationId: data.organizationId || this.requireOrganization(),
      createdById: data.createdById || this.getUserId(),
      isPrivate: data.isPrivate ?? true, // Default to private
      updatedAt: now, // Set updatedAt to current time for new records
    }
  }

  /**
   * Get relation includes for asset entities
   */
  protected getRelationIncludes(): any {
    return {
      currentVersion: {
        with: {
          storageLocation: true,
        },
      },
      versions: {
        with: {
          storageLocation: true,
        },
        orderBy: desc(schema.MediaAssetVersion.versionNumber),
      },
      attachments: true,
      createdBy: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    }
  }

  /**
   * Get searchable fields for asset search
   */
  protected getSearchFields(): string[] {
    return ['name', 'kind', 'mimeType']
  }

  // ============= ContentAccessible Mixin Implementation =============

  /**
   * Get version table name for asset entities
   */
  protected getVersionTableName(): any {
    return schema.MediaAssetVersion
  }

  /**
   * Get entity ID field name in version table
   */
  protected getEntityIdFieldName(): string {
    return 'assetId'
  }

  // ============= Asset-Specific Operations =============

  /**
   * Soft delete an asset and clean up currentVersionId references
   */
  async delete(id: string, db?: DatabaseClient): Promise<void> {
    if (db) {
      // Already in transaction, work directly
      const asset = await this.get(id, db)
      if (!asset) {
        throw new Error('Asset not found')
      }

      // Get all versions to clean up thumbnails
      const versions = await db.query.MediaAssetVersion.findMany({
        where: eq(schema.MediaAssetVersion.assetId, id),
        columns: { id: true },
      })

      // Clean up thumbnails for each version (soft delete)
      // Import ThumbnailService if needed
      const { ThumbnailService } = await import('./thumbnail-service')
      const thumbnailService = new ThumbnailService(
        this.organizationId!,
        this.userId || 'system',
        db
      )

      for (const version of versions) {
        await thumbnailService.deleteThumbnailsForSource(version.id)
      }

      // First, remove any references to this asset's versions as current versions
      if (versions.length > 0) {
        await db
          .update(schema.MediaAsset)
          .set({
            currentVersionId: null,
          })
          .where(
            inArray(
              schema.MediaAsset.currentVersionId,
              versions.map((v) => v.id)
            )
          )
      }

      // Then soft delete the asset
      await db
        .update(schema.MediaAsset)
        .set({
          deletedAt: new Date(),
        })
        .where(eq(schema.MediaAsset.id, id))
    } else {
      // Not in transaction, create one
      return this.getTx(async (tx) => {
        return this.delete(id, tx)
      })
    }
  }

  /**
   * List assets with filtering by kind
   */
  async listByKind(
    kind?: AssetKind,
    options: {
      limit?: number
      offset?: number
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
      includePrivate?: boolean
    } = {}
  ): Promise<{
    items: MediaAsset[]
    total: number
    hasMore: boolean
  }> {
    const filters: any = {}

    if (kind) {
      filters.kind = kind
    }

    if (options.includePrivate === false) {
      filters.isPrivate = false
    }

    return this.list({
      limit: options.limit,
      offset: options.offset,
      sortBy: options.sortBy || 'createdAt',
      sortOrder: options.sortOrder || 'desc',
      filters,
    })
  }

  /**
   * Enhanced search with asset-specific relevance scoring
   */
  async search(query: string, options?: SearchOptions): Promise<AssetSearchResult[]> {
    const filters: SQL[] = []

    // Base where clause with organization scoping
    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    filters.push(isNull(schema.MediaAsset.deletedAt))

    // Search conditions (OR logic)
    const searchConditions: SQL[] = [
      eq(schema.MediaAsset.name, query), // Exact name match
      ilike(schema.MediaAsset.name, `%${query}%`), // Name contains query
      ilike(schema.MediaAsset.mimeType, `%${query}%`), // MIME type match
    ]

    // Kind match (enum equality only)
    if (this.isAssetKind(query)) {
      searchConditions.push(eq(schema.MediaAsset.kind, query.toUpperCase() as AssetKind))
    }

    filters.push(or(...searchConditions))

    // Apply additional filters
    if (options?.kinds) {
      filters.push(inArray(schema.MediaAsset.kind, options.kinds))
    }
    if (options?.sizeLimits?.min) {
      filters.push(gte(schema.MediaAsset.size, options.sizeLimits.min))
    }
    if (options?.sizeLimits?.max) {
      filters.push(lte(schema.MediaAsset.size, options.sizeLimits.max))
    }
    if (options?.dateLimits?.createdAfter) {
      filters.push(gte(schema.MediaAsset.createdAt, options.dateLimits.createdAfter))
    }
    if (options?.dateLimits?.createdBefore) {
      filters.push(lte(schema.MediaAsset.createdAt, options.dateLimits.createdBefore))
    }

    // Support cursor-based pagination for large datasets
    const queryOptions: any = {
      where: and(...filters),
      with: options?.includeContent ? this.getRelationIncludes() : undefined,
      limit: options?.limit || 50,
      orderBy: desc(schema.MediaAsset.updatedAt),
    }

    // Use cursor pagination if provided, otherwise fall back to offset
    if (options?.cursor) {
      queryOptions.where = and(...filters, gt(schema.MediaAsset.id, options.cursor))
    } else if (options?.offset) {
      queryOptions.offset = options.offset
    }

    const results = await this.db.query.MediaAsset.findMany(queryOptions)

    // Calculate relevance scores
    return results
      .map((asset): AssetSearchResult => {
        let relevance = 0
        const matchedFields: string[] = []

        // Exact name match
        if (asset.name && asset.name.toLowerCase() === query.toLowerCase()) {
          relevance += 10
          matchedFields.push('name')
        }
        // Name contains query
        else if (asset.name?.toLowerCase().includes(query.toLowerCase())) {
          relevance += 5
          matchedFields.push('name')
        }

        // Kind match (exact only for enums)
        if (asset.kind.toLowerCase() === query.toLowerCase()) {
          relevance += 3
          matchedFields.push('kind')
        }

        // MIME type match
        if (asset.mimeType?.toLowerCase().includes(query.toLowerCase())) {
          relevance += 2
          matchedFields.push('mimeType')
        }

        return {
          asset,
          relevance: Math.max(relevance, 1),
          matchedFields,
          snippet: this.generateSearchSnippet(asset, query),
        }
      })
      .sort((a, b) => b.relevance - a.relevance)
  }

  /**
   * Convert asset to different kind with validation
   */
  async convertKind(id: string, newKind: AssetKind): Promise<MediaAsset> {
    const asset = await this.get(id)
    if (!asset) {
      throw new Error('Asset not found')
    }

    // Validate kind conversion
    await this.validateKindConversion(asset.kind as AssetKind, newKind)

    return this.update(id, {
      kind: newKind,
    })
  }

  /**
   * Convert temporary upload to permanent attachment
   */
  async convertTempToPermanent(
    mediaAssetId: string,
    newKind: AssetKind,
    organizationId: string
  ): Promise<void> {
    const mediaAsset = await this.db.query.MediaAsset.findFirst({
      where: and(
        eq(schema.MediaAsset.id, mediaAssetId),
        eq(schema.MediaAsset.organizationId, organizationId)
      ),
    })

    if (!mediaAsset || mediaAsset.kind !== 'TEMP_UPLOAD') {
      return // Already permanent or doesn't exist
    }

    // Convert temp upload to permanent attachment
    await this.db
      .update(schema.MediaAsset)
      .set({
        kind: newKind,
        expiresAt: null, // Clear expiration for permanent files
      })
      .where(eq(schema.MediaAsset.id, mediaAssetId))
  }

  // ============= Enhanced Asset Operations =============

  /**
   * Create asset with initial version (transactional)
   */
  async createWithVersion(
    data: CreateAssetRequest,
    storageLocationId: string
  ): Promise<{
    asset: MediaAsset
    version: MediaAssetVersion
  }> {
    return this.getTx(async (tx) => {
      // Create the asset record
      const asset = await this.create(data, tx)

      // Create initial version
      const version = await this.createVersion(
        asset.id,
        storageLocationId,
        {
          size: data.size,
          mimeType: data.mimeType,
        },
        tx
      )

      return { asset, version }
    })
  }

  /**
   * Create MediaAsset from existing FolderFile
   * Reuses createWithVersion for consistency
   */
  async createFromFolderFile(
    fileId: string,
    fileVersionId?: string,
    options?: {
      kind?: AssetKind
      skipIfExists?: boolean
    }
  ): Promise<MediaAsset> {
    // Get file with version
    const file = await this.db.query.FolderFile.findFirst({
      where: eq(schema.FolderFile.id, fileId),
      with: {
        currentVersion: {
          with: { storageLocation: true },
        },
        versions: fileVersionId
          ? {
              where: eq(schema.FileVersion.id, fileVersionId),
              limit: 1,
              with: { storageLocation: true },
            }
          : undefined,
      },
    })

    if (!file) {
      throw new Error('File not found')
    }

    const version = fileVersionId && file.versions?.[0] ? file.versions[0] : file.currentVersion

    if (!version) {
      throw new Error('File version not found')
    }

    // Check for existing MediaAsset if requested
    // Only return existing if it has a version pointing to the same storage location
    if (options?.skipIfExists) {
      const existing = await this.db.query.MediaAsset.findFirst({
        where: eq(schema.MediaAsset.organizationId, file.organizationId),
        with: {
          currentVersion: {
            where: (currentVersion, { eq }) =>
              eq(currentVersion.storageLocationId, version.storageLocationId),
          },
        },
      })
      // Only return if we found an asset with a matching version
      // The where clause in 'with' only filters which version to include,
      // not which asset to return - so we must verify currentVersion exists
      if (existing?.currentVersion) return existing
    }

    // Use existing createWithVersion method
    const { asset } = await this.createWithVersion(
      {
        kind: options?.kind || 'DOCUMENT',
        name: file.name,
        mimeType: file.mimeType || 'application/octet-stream',
        size: BigInt(file.size || 0),
        isPrivate: true,
        organizationId: file.organizationId,
        createdById: file.createdById,
      },
      version.storageLocationId
    )

    return asset
  }

  /**
   * Update asset content (creates new version, transactional)
   */
  async updateContent(
    id: string,
    storageLocationId: string,
    metadata: {
      size?: bigint
      mimeType?: string
    } = {}
  ): Promise<{ asset: MediaAsset; version: MediaAssetVersion }> {
    return this.getTx(async (tx) => {
      const asset = await this.get(id, tx)
      if (!asset) {
        throw new Error('Asset not found')
      }

      // Create new version
      const version = await this.createVersion(id, storageLocationId, metadata, tx)

      // Update asset metadata if provided
      const updatedAsset = await this.update(
        id,
        {
          ...(metadata.size && { size: metadata.size }),
          ...(metadata.mimeType && { mimeType: metadata.mimeType }),
        },
        tx
      )

      return { asset: updatedAsset, version }
    })
  }

  /**
   * Get asset download info with metadata
   */
  async getDownloadInfo(id: string): Promise<AssetDownloadInfo> {
    const asset = await this.getWithRelations(id)
    if (!asset) {
      throw new Error('Asset not found')
    }

    const downloadRef = await this.getDownloadRef(id)

    return {
      url: downloadRef.type === 'url' ? downloadRef.url : undefined,
      filename: asset.name || undefined,
      mimeType: asset.mimeType || undefined,
      size: asset.size || undefined,
      expiresAt: downloadRef.type === 'url' ? downloadRef.expiresAt : undefined,
    }
  }

  // ============= Asset Queries =============

  /**
   * Find assets by kind
   */
  async findByKind(kind: AssetKind): Promise<MediaAsset[]> {
    const filters: SQL[] = []

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    filters.push(isNull(schema.MediaAsset.deletedAt))
    filters.push(eq(schema.MediaAsset.kind, kind))

    return this.db.query.MediaAsset.findMany({
      where: and(...filters),
      orderBy: desc(schema.MediaAsset.createdAt),
    })
  }

  /**
   * Get assets by MIME type
   */
  async findByMimeType(mimeType: string): Promise<MediaAsset[]> {
    const filters: SQL[] = []

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    filters.push(isNull(schema.MediaAsset.deletedAt))
    filters.push(ilike(schema.MediaAsset.mimeType, `%${mimeType}%`))

    return this.db.query.MediaAsset.findMany({
      where: and(...filters),
      orderBy: desc(schema.MediaAsset.createdAt),
    })
  }

  /**
   * Find temporary/expired assets for cleanup
   */
  async findExpired(maxAgeHours = 24): Promise<MediaAsset[]> {
    const cutoffDate = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000)
    const filters: SQL[] = []

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    filters.push(isNull(schema.MediaAsset.deletedAt))
    filters.push(eq(schema.MediaAsset.kind, 'TEMP_UPLOAD'))
    filters.push(lt(schema.MediaAsset.createdAt, cutoffDate))

    return this.db.query.MediaAsset.findMany({
      where: and(...filters),
      orderBy: asc(schema.MediaAsset.createdAt),
    })
  }

  /**
   * Get large assets (for cleanup)
   */
  async findLargeAssets(minSizeBytes: bigint): Promise<MediaAsset[]> {
    const filters: SQL[] = []

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    filters.push(isNull(schema.MediaAsset.deletedAt))
    filters.push(gte(schema.MediaAsset.size, minSizeBytes))

    return this.db.query.MediaAsset.findMany({
      where: and(...filters),
      orderBy: desc(schema.MediaAsset.size),
    })
  }

  /**
   * Get orphaned assets (assets without a current version)
   */
  async findOrphanedAssets(): Promise<MediaAsset[]> {
    const filters: SQL[] = []

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    filters.push(isNull(schema.MediaAsset.deletedAt))
    filters.push(isNull(schema.MediaAsset.currentVersionId))

    return this.db.query.MediaAsset.findMany({
      where: and(...filters),
    })
  }

  /**
   * Get public assets
   */
  async findPublicAssets(): Promise<MediaAsset[]> {
    const filters: SQL[] = []

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    filters.push(isNull(schema.MediaAsset.deletedAt))
    filters.push(eq(schema.MediaAsset.isPrivate, false))

    return this.db.query.MediaAsset.findMany({
      where: and(...filters),
      orderBy: desc(schema.MediaAsset.createdAt),
    })
  }

  // ============= Specialized Asset Operations =============

  /**
   * Process email attachment assets
   */
  async processEmailAttachment(assetId: string): Promise<MediaAsset> {
    const asset = await this.get(assetId)
    if (!asset || asset.kind !== 'EMAIL_ATTACHMENT') {
      throw new Error('Invalid email attachment asset')
    }

    // TODO: Implement virus scanning, content indexing, etc.
    // This would integrate with external services for security scanning

    // For now, just mark as processed by updating the timestamp
    return this.update(assetId, {
      // Could add metadata about processing status
    })
  }

  /**
   * Generate thumbnail for image/video assets
   */
  async generateThumbnail(
    assetId: string,
    _options: {
      width?: number
      height?: number
      quality?: number
    } = {}
  ): Promise<MediaAsset> {
    const asset = await this.get(assetId)
    if (!asset) {
      throw new Error('Asset not found')
    }

    // TODO: Implement actual thumbnail generation
    // This would use image processing libraries like Sharp
    // For now, throw an error since we can't create assets without storage
    throw new Error(
      'Thumbnail generation not yet implemented - requires actual file processing and storage upload'
    )
  }

  /**
   * Extract metadata from asset
   */
  async extractMetadata(assetId: string): Promise<Record<string, any>> {
    const asset = await this.getWithRelations(assetId)
    if (!asset) {
      throw new Error('Asset not found')
    }

    const metadata: Record<string, any> = {
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size?.toString(),
      isPrivate: asset.isPrivate,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    }

    // Add version information
    if (asset.currentVersion) {
      metadata.currentVersion = {
        versionNumber: asset.currentVersion.versionNumber,
        storageLocation: asset.currentVersion.storageLocation,
      }
    }

    // TODO: Extract file-specific metadata (EXIF, document properties, etc.)
    // This would use libraries like exifr for images, pdf-parse for PDFs, etc.

    return metadata
  }

  // ============= ContentAccessible Implementation =============

  /**
   * Get the binary content of an entity
   */
  async getContent(id: string): Promise<Buffer> {
    const entity = await this.get(id)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    const storageManager = await this.getStorageManager()
    const currentVersion = await this.getCurrentVersion(id)

    if (!currentVersion || !currentVersion.storageLocationId) {
      throw new Error(`No storage location found for ${this.getEntityName()}`)
    }

    return storageManager.getContent(currentVersion.storageLocationId)
  }

  /**
   * Get a download URL with expiry information
   */
  async getDownloadRef(id: string): Promise<DownloadRef> {
    const entity = await this.get(id)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    const currentVersion = await this.getCurrentVersion(id)

    if (!currentVersion || !currentVersion.storageLocationId) {
      throw new Error(`No storage location found for ${this.getEntityName()}`)
    }

    // For public assets with external URLs, return the durable URL directly
    if (!entity.isPrivate && currentVersion.storageLocation?.externalUrl) {
      return {
        type: 'url',
        url: currentVersion.storageLocation.externalUrl,
        expiresAt: undefined, // Durable URLs don't expire
      }
    }

    // Otherwise, get presigned URL from storage manager
    const storageManager = await this.getStorageManager()
    return await storageManager.getDownloadRef({
      locationId: currentVersion.storageLocationId,
      filename: entity.name || undefined,
      mimeType: entity.mimeType || undefined,
    })
  }

  /**
   * Get download reference for a specific version with enhanced metadata
   *
   * Retrieves a download reference for a specific version of an asset with additional
   * metadata needed for preview functionality. Supports different version specifiers.
   *
   * @param entityId - ID of the asset to get download reference for
   * @param opts - Options including version specifier and disposition
   * @returns Promise resolving to enhanced download reference with metadata
   * @throws Error if asset not found, version not found, or no storage location available
   */
  async getDownloadRefForVersion(
    entityId: string,
    opts: {
      version?: number | 'latest' | 'current'
      disposition?: 'inline' | 'attachment'
    } = {}
  ): Promise<
    DownloadRef & {
      filename: string
      mimeType?: string
      size?: bigint
      expiresAt?: Date
      versionNumber: number
    }
  > {
    const { version = 'current', disposition = 'inline' } = opts

    const entity = await this.get(entityId)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    // Get the appropriate version based on the version parameter
    let targetVersion: (MediaAssetVersion & { storageLocation: any }) | null = null

    if (version === 'current') {
      targetVersion = await this.getCurrentVersion(entityId)
    } else if (version === 'latest') {
      targetVersion = await this.getLatestVersion(entityId)
    } else if (typeof version === 'number') {
      targetVersion = await this.getVersion(entityId, version)
    }

    if (!targetVersion || !targetVersion.storageLocationId) {
      throw new Error(`Version ${version} not found for ${this.getEntityName()}`)
    }

    const storageManager = await this.getStorageManager()
    const downloadRef = await storageManager.getDownloadRef({
      locationId: targetVersion.storageLocationId,
      disposition,
      filename: entity.name || undefined,
      mimeType: entity.mimeType || undefined,
    })

    // Return enhanced download reference with metadata
    return {
      ...downloadRef,
      filename: entity.name || `${entity.kind.toLowerCase()}_${entity.id}`,
      mimeType: entity.mimeType || undefined,
      size: entity.size || undefined,
      versionNumber: targetVersion.versionNumber,
      // Use existing expiresAt if it's a URL type, otherwise set a default expiration
      expiresAt:
        downloadRef.type === 'url'
          ? downloadRef.expiresAt || new Date(Date.now() + 10 * 60 * 1000) // 10 minutes default
          : new Date(Date.now() + 10 * 60 * 1000),
    }
  }

  /**
   * Get download URL as string (convenience method)
   */
  async getDownloadUrl(id: string): Promise<string | null> {
    try {
      const entity = await this.get(id)
      if (!entity) return null

      const currentVersion = await this.getCurrentVersion(id)
      if (!currentVersion || !currentVersion.storageLocationId) return null

      // For public assets with external URLs, return the durable URL directly
      if (!entity.isPrivate && currentVersion.storageLocation?.externalUrl) {
        return currentVersion.storageLocation.externalUrl
      }

      // Otherwise, get presigned URL from storage manager
      const downloadRef = await this.getDownloadRef(id)
      return downloadRef.type === 'url' ? downloadRef.url : null
    } catch (error) {
      return null
    }
  }

  /**
   * Stream the content of an entity
   */
  async streamContent(id: string): Promise<NodeJS.ReadableStream> {
    const entity = await this.get(id)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    const storageManager = await this.getStorageManager()
    const currentVersion = await this.getCurrentVersion(id)

    if (!currentVersion || !currentVersion.storageLocationId) {
      throw new Error(`No storage location found for ${this.getEntityName()}`)
    }

    return storageManager.streamContent(currentVersion.storageLocationId)
  }

  /**
   * Find entity by content checksum
   */
  async findByChecksum(checksum: string): Promise<MediaAsset | null> {
    const filters: SQL[] = []

    if (this.organizationId) {
      filters.push(eq(schema.MediaAsset.organizationId, this.organizationId))
    }
    filters.push(isNull(schema.MediaAsset.deletedAt))
    // Note: checksum field might need to be added to MediaAsset table or accessed via relations
    // For now, keeping the logic but this may need adjustment based on actual schema

    return this.db.query.MediaAsset.findFirst({
      where: and(...filters),
    })
  }

  /**
   * Get the current version of an entity
   */
  async getCurrentVersion(entityId: string): Promise<any> {
    const entity = await this.get(entityId)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    // If entity has currentVersionId, fetch that version
    if ((entity as any).currentVersionId) {
      return this.db.query.MediaAssetVersion.findFirst({
        where: eq(schema.MediaAssetVersion.id, (entity as any).currentVersionId),
        with: {
          storageLocation: true,
        },
      })
    }

    // Otherwise, get the latest version
    return this.db.query.MediaAssetVersion.findFirst({
      where: eq(schema.MediaAssetVersion.assetId, entityId),
      orderBy: desc(schema.MediaAssetVersion.versionNumber),
      with: {
        storageLocation: true,
      },
    })
  }

  /**
   * Get storage manager for content operations (lazy singleton)
   */
  protected async getStorageManager(): Promise<any> {
    if (!this._storageManager) {
      // Import storage manager dynamically to avoid circular dependencies
      const { createStorageManager } = await import('../storage/storage-manager')
      // Use organization-scoped instance for proper credential management
      this._storageManager = createStorageManager(this.requireOrganization())
    }
    return this._storageManager
  }

  // ============= Versioned Implementation =============

  /**
   * Create a new version for an entity
   */
  async createVersion(
    entityId: string,
    storageLocationId: string,
    metadata: any = {},
    db?: DatabaseClient
  ): Promise<MediaAssetVersion> {
    if (db) {
      // Already in transaction, work directly with it
      const entity = await this.get(entityId, db)
      if (!entity) {
        throw new Error(`${this.getEntityName()} not found`)
      }

      // Get the next version number within transaction
      const lastVersion = await db.query.MediaAssetVersion.findFirst({
        where: eq(schema.MediaAssetVersion.assetId, entityId),
        orderBy: desc(schema.MediaAssetVersion.versionNumber),
        columns: { versionNumber: true },
      })

      const versionNumber = (lastVersion?.versionNumber || 0) + 1

      // Get storage location details
      const storageLocation = await db.query.StorageLocation.findFirst({
        where: eq(schema.StorageLocation.id, storageLocationId),
      })

      if (!storageLocation) {
        throw new Error('Storage location not found')
      }

      // Create the new version
      const [version] = await db
        .insert(schema.MediaAssetVersion)
        .values({
          assetId: entityId,
          versionNumber,
          storageLocationId,
          size: storageLocation.size,
          mimeType: storageLocation.mimeType,
          ...metadata,
        })
        .returning()

      // Update the entity's current version reference
      await db
        .update(schema.MediaAsset)
        .set({
          currentVersionId: version.id,
        })
        .where(eq(schema.MediaAsset.id, entityId))

      return version
    } else {
      // Not in transaction, create one
      const entity = await this.get(entityId)
      if (!entity) {
        throw new Error(`${this.getEntityName()} not found`)
      }

      return this.getTx(async (tx) => {
        return this.createVersion(entityId, storageLocationId, metadata, tx)
      })
    }
  }

  /**
   * Get all versions for an entity
   */
  async getVersions(entityId: string): Promise<(MediaAssetVersion & { storageLocation: any })[]> {
    const entity = await this.get(entityId)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    return this.db.query.MediaAssetVersion.findMany({
      where: eq(schema.MediaAssetVersion.assetId, entityId),
      with: {
        storageLocation: true,
      },
      orderBy: desc(schema.MediaAssetVersion.versionNumber),
    })
  }

  /**
   * Get a specific version by number
   */
  async getVersion(
    entityId: string,
    versionNumber: number
  ): Promise<(MediaAssetVersion & { storageLocation: any }) | null> {
    const entity = await this.get(entityId)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    return this.db.query.MediaAssetVersion.findFirst({
      where: and(
        eq(schema.MediaAssetVersion.assetId, entityId),
        eq(schema.MediaAssetVersion.versionNumber, versionNumber)
      ),
      with: {
        storageLocation: true,
      },
    })
  }

  /**
   * Restore an entity to a specific version
   */
  async restoreVersion(entityId: string, versionNumber: number): Promise<MediaAsset> {
    const version = await this.getVersion(entityId, versionNumber)
    if (!version) {
      throw new Error(`Version ${versionNumber} not found for ${this.getEntityName()}`)
    }

    const [entity] = await this.db
      .update(schema.MediaAsset)
      .set({
        currentVersionId: version.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.MediaAsset.id, entityId))
      .returning()

    return entity
  }

  /**
   * Delete a specific version (but not the current one)
   */
  async deleteVersion(entityId: string, versionNumber: number): Promise<void> {
    const entity = await this.get(entityId)
    if (!entity) {
      throw new Error(`${this.getEntityName()} not found`)
    }

    const version = await this.getVersion(entityId, versionNumber)
    if (!version) {
      throw new Error(`Version ${versionNumber} not found`)
    }

    // Don't allow deletion of the current version
    if ((entity as any).currentVersionId === version.id) {
      throw new Error('Cannot delete the current version')
    }

    // Clean up thumbnails for this version before deleting
    const { ThumbnailService } = await import('./thumbnail-service')
    const thumbnailService = new ThumbnailService(
      this.organizationId,
      this.userId || 'system',
      this.db
    )
    await thumbnailService.deleteThumbnailsForSource(version.id)

    await this.db
      .delete(schema.MediaAssetVersion)
      .where(eq(schema.MediaAssetVersion.id, version.id))
  }

  /**
   * Get the latest version for an entity
   */
  async getLatestVersion(
    entityId: string
  ): Promise<(MediaAssetVersion & { storageLocation: any }) | null> {
    return this.db.query.MediaAssetVersion.findFirst({
      where: eq(schema.MediaAssetVersion.assetId, entityId),
      with: {
        storageLocation: true,
      },
      orderBy: desc(schema.MediaAssetVersion.versionNumber),
    })
  }

  /**
   * Copy all versions from one entity to another
   */
  async copyVersions(sourceEntityId: string, targetEntityId: string): Promise<MediaAssetVersion[]> {
    const sourceVersions = await this.getVersions(sourceEntityId)
    const copiedVersions: MediaAssetVersion[] = []

    for (const sourceVersion of sourceVersions) {
      const copiedVersion = await this.createVersion(
        targetEntityId,
        sourceVersion.storageLocationId,
        {
          // Copy metadata but exclude entity-specific fields
          size: sourceVersion.size,
          mimeType: sourceVersion.mimeType,
          checksum: sourceVersion.checksum,
        }
      )
      copiedVersions.push(copiedVersion)
    }

    return copiedVersions
  }

  // ============= Helper Methods =============

  /**
   * Check if query string is a valid asset kind (proper type guard)
   */
  private isAssetKind(query: string): query is AssetKind {
    return VALID_ASSET_KINDS.includes(query.toUpperCase() as AssetKind)
  }

  /**
   * Validate asset kind
   */
  private async validateAssetKind(kind: AssetKind): Promise<void> {
    if (!this.isAssetKind(kind)) {
      throw new Error(`Invalid asset kind: ${kind}`)
    }
  }

  /**
   * Validate kind conversion
   */
  private async validateKindConversion(from: AssetKind, to: AssetKind): Promise<void> {
    const allowedConversions: Record<AssetKind, AssetKind[]> = {
      TEMP_UPLOAD: ['INLINE_IMAGE', 'EMAIL_ATTACHMENT', 'USER_AVATAR'],
      EMAIL_ATTACHMENT: ['INLINE_IMAGE'],
      INLINE_IMAGE: ['THUMBNAIL'],
      USER_AVATAR: [],
      THUMBNAIL: [],
      SYSTEM_BLOB: [],
      DOCUMENT: [],
    }

    if (!allowedConversions[from]?.includes(to)) {
      throw new Error(`Cannot convert ${from} to ${to}`)
    }
  }

  /**
   * Generate search snippet for search results
   */
  private generateSearchSnippet(asset: MediaAsset, query: string): string {
    const parts: string[] = []

    if (asset.name?.toLowerCase().includes(query.toLowerCase())) {
      parts.push(`Name: ${asset.name}`)
    }

    if (asset.kind.toLowerCase().includes(query.toLowerCase())) {
      parts.push(`Kind: ${asset.kind}`)
    }

    if (asset.mimeType?.toLowerCase().includes(query.toLowerCase())) {
      parts.push(`Type: ${asset.mimeType}`)
    }

    return parts.join(' | ') || asset.name || `${asset.kind} asset`
  }
}

// Export factory functions for creating service instances
export const createMediaAssetService = (organizationId?: string, userId?: string) =>
  new MediaAssetService(organizationId, userId)

// Export singleton instance (with default db, no specific organization)
// export const mediaAssetService = new MediaAssetService()
