// packages/lib/src/files/core/thumbnail-service.ts

import { type Database, database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { createHash } from 'crypto'
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { getQueue, Queues } from '../../jobs/queues'
import { createScopedLogger } from '../../logger'
import { createStorageManager, type StorageManager } from '../storage/storage-manager'
import type {
  GenerateThumbnailPayload,
  PresetKey,
  ThumbnailMetadata,
  ThumbnailOptions,
  ThumbnailResult,
  ThumbnailSource,
} from './thumbnail-types'
import { THUMBNAIL_PRESETS } from './thumbnail-types'

const logger = createScopedLogger('thumbnail-service')

/**
 * Service for generating and managing image thumbnails
 */
export class ThumbnailService {
  private storageManager: StorageManager
  private logger = logger

  constructor(
    private organizationId: string,
    private userId: string,
    private dbClient: Database = db
  ) {
    // Use org-scoped StorageManager for proper credential management
    this.storageManager = createStorageManager(organizationId)
  }

  /**
   * Ensure a thumbnail exists for the given source
   */
  async ensureThumbnail(
    source: ThumbnailSource,
    opts: ThumbnailOptions = {}
  ): Promise<ThumbnailResult> {
    try {
      // Resolve source to version and visibility
      const { versionId, visibility } = await this.resolveVersion(source)
      const preset = opts.preset ?? 'avatar-64'
      const key = this.makeKey(versionId, preset, opts)

      // Check if thumbnail already exists
      const existing = await this.findByVersionAndPreset(versionId, preset)
      if (existing) {
        this.logger.debug('Thumbnail already exists', {
          versionId,
          preset,
          assetVersionId: existing.id,
        })

        return {
          status: 'ready',
          assetId: existing.assetId,
          assetVersionId: existing.id,
          storageLocationId: existing.storageLocationId!,
        }
      }

      // Default to queue-based generation
      // Only generate synchronously if explicitly requested with queue: false
      if (opts.queue === false) {
        // Generate synchronously - will use dynamic import of sharp
        const result = await this.generateNow({
          versionId,
          preset,
          opts,
          visibility: opts.visibility ?? visibility,
        })

        return {
          status: 'generated',
          assetId: result.assetId,
          assetVersionId: result.assetVersionId,
          storageLocationId: result.storageLocationId,
        }
      }

      // Default behavior: queue the job
      const jobId = await this.enqueueJob({
        orgId: this.organizationId,
        userId: this.userId,
        versionId,
        preset,
        opts,
        key,
        visibility: opts.visibility ?? visibility,
      })

      this.logger.info('Thumbnail generation queued', {
        jobId,
        versionId,
        preset,
      })

      return { status: 'queued', jobId }
    } catch (error) {
      this.logger.error('Failed to ensure thumbnail', {
        source,
        opts,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      throw error
    }
  }

  /**
   * Convert a FolderFile to MediaAsset for thumbnail generation
   */
  private async convertFileToAsset(
    fileVersion: any
  ): Promise<{ id: string; currentVersionId: string }> {
    // Check if already converted
    const [existing] = await this.dbClient
      .select()
      .from(schema.MediaAsset)
      .where(
        and(
          eq(schema.MediaAsset.organizationId, this.organizationId),
          eq(schema.MediaAsset.kind, 'FILE_CONVERSION')
          // sql`${schema.MediaAsset.metadata}->>'fileVersionId' = ${fileVersion.id}`
        )
      )
      .limit(1)

    if (existing) {
      return existing
    }

    // Create MediaAsset from FolderFile
    const [asset] = await this.dbClient
      .insert(schema.MediaAsset)
      .values({
        organizationId: this.organizationId,
        createdById: this.userId,
        kind: 'FILE_CONVERSION',
        purpose: 'ORIGINAL',
        mimeType: fileVersion.mimeType,
        size: fileVersion.size,
        isPrivate: true, // Files are always private
        // metadata: {
        //   fileVersionId: fileVersion.id,
        //   fileId: fileVersion.fileId,
        // },
        updatedAt: new Date(),
      })
      .returning()

    // Create MediaAssetVersion pointing to same storage
    const [version] = await this.dbClient
      .insert(schema.MediaAssetVersion)
      .values({
        assetId: asset.id,
        versionNumber: 1,
        size: fileVersion.size,
        mimeType: fileVersion.mimeType,
        storageLocationId: fileVersion.storageLocationId,
        status: 'READY',
      })
      .returning()

    // Update asset with current version
    const [updated] = await this.dbClient
      .update(schema.MediaAsset)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(schema.MediaAsset.id, asset.id))
      .returning()

    return updated
  }

  /**
   * Resolve source to version ID and visibility
   */
  private async resolveVersion(
    source: ThumbnailSource
  ): Promise<{ versionId: string; visibility: 'PUBLIC' | 'PRIVATE' }> {
    switch (source.type) {
      case 'asset': {
        const asset = await this.dbClient.query.MediaAsset.findFirst({
          where: (t, { and, eq }) =>
            and(eq(t.id, source.assetId), eq(t.organizationId, this.organizationId)),
          columns: {
            id: true,
            currentVersionId: true,
            isPrivate: true,
          },
          with: {
            currentVersion: {
              columns: { id: true },
            },
          },
        })
        if (!asset) throw new Error(`Asset not found: ${source.assetId}`)

        const versionId = source.assetVersionId ?? asset.currentVersionId
        if (!versionId) throw new Error('Asset has no current version')

        return {
          versionId,
          visibility: asset.isPrivate ? 'PRIVATE' : 'PUBLIC',
        }
      }

      case 'file': {
        const file = await this.dbClient.query.FolderFile.findFirst({
          where: (t, { and, eq }) =>
            and(eq(t.id, source.fileId), eq(t.organizationId, this.organizationId)),
          columns: { id: true, currentVersionId: true },
          with: {
            currentVersion: {
              columns: { id: true, mimeType: true, size: true, storageLocationId: true },
              with: { storageLocation: { columns: { id: true } } },
            },
          },
        })
        if (!file) throw new Error(`File not found: ${source.fileId}`)

        const fileVersion = source.fileVersionId
          ? await this.dbClient.query.FileVersion.findFirst({
              where: (t, { and, eq }) =>
                and(eq(t.id, source.fileVersionId!), eq(t.fileId, source.fileId)),
              with: { storageLocation: true },
            })
          : file.currentVersion

        if (!fileVersion) throw new Error('File has no version')

        // Convert file to MediaAsset for thumbnail generation
        const mediaAsset = await this.convertFileToAsset(fileVersion)

        return {
          versionId: mediaAsset.currentVersionId!,
          visibility: 'PRIVATE', // Files are always private
        }
      }

      case 'attachment': {
        const attachment = await this.dbClient.query.Attachment.findFirst({
          where: (t, { and, eq }) =>
            and(eq(t.id, source.attachmentId), eq(t.organizationId, this.organizationId)),
          with: {
            asset: {
              columns: { id: true, isPrivate: true, currentVersionId: true, name: true },
              with: {
                currentVersion: { columns: { id: true } },
              },
            },
            file: {
              columns: { id: true },
              with: {
                currentVersion: {
                  columns: { id: true, mimeType: true, size: true, storageLocationId: true },
                  with: { storageLocation: { columns: { id: true } } },
                },
              },
            },
            assetVersion: { columns: { id: true } },
            fileVersion: {
              columns: { id: true, mimeType: true, size: true, storageLocationId: true },
              with: { storageLocation: true },
            },
          },
        })

        if (!attachment) {
          throw new Error(`Attachment not found: ${source.attachmentId}`)
        }

        // Priority order for version resolution
        // 1. Pinned to specific asset version
        if (attachment.assetVersionId) {
          return {
            versionId: attachment.assetVersionId,
            visibility: attachment.asset?.isPrivate ? 'PRIVATE' : 'PUBLIC',
          }
        }

        // 2. Pinned to specific file version (convert to asset)
        if (attachment.fileVersionId) {
          const mediaAsset = await this.convertFileToAsset(attachment.fileVersion)
          return {
            versionId: mediaAsset.currentVersionId!,
            visibility: 'PRIVATE',
          }
        }

        // 3. Unpinned asset (use current version)
        if (attachment.assetId && attachment.asset?.currentVersionId) {
          return {
            versionId: attachment.asset.currentVersionId,
            visibility: attachment.asset.isPrivate ? 'PRIVATE' : 'PUBLIC',
          }
        }

        // 4. Unpinned file (convert current version to asset)
        if (attachment.fileId && attachment.file?.currentVersion) {
          const mediaAsset = await this.convertFileToAsset(attachment.file.currentVersion)
          return {
            versionId: mediaAsset.currentVersionId!,
            visibility: 'PRIVATE',
          }
        }

        throw new Error('Attachment has no resolvable version')
      }

      default:
        throw new Error('Invalid source type')
    }
  }

  /**
   * Get source data buffer
   */
  private async getSourceData(
    source: ThumbnailSource
  ): Promise<{ versionId: string; buffer: Buffer }> {
    const { versionId } = await this.resolveVersion(source)

    // Get storage location (resolve and verify org access)
    const version = await this.dbClient.query.MediaAssetVersion.findFirst({
      where: (t, { eq }) => eq(t.id, versionId),
      with: {
        storageLocation: true,
        asset: { columns: { id: true, organizationId: true } },
      },
    })

    if (!version?.storageLocation) {
      throw new Error('Version has no storage location')
    }
    if (!version.asset || version.asset.organizationId !== this.organizationId) {
      throw new Error('Unauthorized access to media asset version')
    }

    // Download from storage
    const buffer = await this.storageManager.getContent(version.storageLocation.id)

    return { versionId, buffer }
  }

  /**
   * Find existing thumbnail by version and preset
   */
  private async findByVersionAndPreset(versionId: string, preset: string) {
    return this.dbClient.query.MediaAssetVersion.findFirst({
      where: (t, { and, eq, isNull }) =>
        and(eq(t.derivedFromVersionId, versionId), eq(t.preset, preset), isNull(t.deletedAt)),
    })
  }

  /**
   * Generate deterministic key for deduplication
   */
  private makeKey(versionId: string, preset: string, opts: ThumbnailOptions): string {
    const params = JSON.stringify({
      versionId,
      preset,
      format: opts.format ?? THUMBNAIL_PRESETS[preset as PresetKey].format,
      quality: opts.quality ?? THUMBNAIL_PRESETS[preset as PresetKey].quality,
    })
    return createHash('sha256').update(params).digest('hex').slice(0, 16)
  }

  /**
   * Enqueue job for background processing
   */
  private async enqueueJob(payload: GenerateThumbnailPayload): Promise<string> {
    const jobId = `thumb-${payload.key}`
    const redis = await getRedisClient(true)

    // Check Redis cache first (prevents thundering herd)
    const cached = await redis.get(`processing:${jobId}`)
    if (cached) return cached

    // Get thumbnail queue
    const thumbnailQueue = getQueue(Queues.thumbnailQueue)

    // Add to queue with deterministic ID (prevents queue duplicates)
    const job = await thumbnailQueue.add('generateThumbnail', payload, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    })

    // Cache for 60 seconds
    await redis.setex(`processing:${jobId}`, 60, job.id!)

    return job.id!
  }

  /**
   * Generate thumbnail synchronously
   */
  private async generateNow(params: {
    versionId: string
    preset: string
    opts: ThumbnailOptions
    visibility: 'PUBLIC' | 'PRIVATE'
  }): Promise<{
    assetId: string
    assetVersionId: string
    storageLocationId: string
  }> {
    try {
      return await this.generateWithPlaceholder(params)
    } catch (error: any) {
      // Handle unique constraint violation
      if (error?.code === '23505') {
        // Someone else created it concurrently, fetch and return
        const existing = await this.findByVersionAndPreset(params.versionId, params.preset)
        if (existing) {
          return {
            assetId: existing.assetId,
            assetVersionId: existing.id,
            storageLocationId: existing.storageLocationId!,
          }
        }
      }
      throw error
    }
  }

  /**
   * Generate with placeholder to prevent race conditions
   */
  private async generateWithPlaceholder(params: {
    versionId: string
    preset: string
    opts: ThumbnailOptions
    visibility: 'PUBLIC' | 'PRIVATE'
  }): Promise<{
    assetId: string
    assetVersionId: string
    storageLocationId: string
  }> {
    const startTime = Date.now()

    // Step 1: Create placeholder (fast transaction)
    const placeholder = await this.dbClient.transaction(async (tx) => {
      const [asset] = await tx
        .insert(schema.MediaAsset)
        .values({
          organizationId: this.organizationId,
          createdById: this.userId,
          kind: 'THUMBNAIL',
          purpose: 'DERIVED',
          isPrivate: params.visibility === 'PRIVATE',
          mimeType: this.getMimeTypeForFormat(THUMBNAIL_PRESETS[params.preset as PresetKey].format),
          updatedAt: new Date(),
        })
        .returning({ id: schema.MediaAsset.id })

      const [version] = await tx
        .insert(schema.MediaAssetVersion)
        .values({
          assetId: asset.id,
          derivedFromVersionId: params.versionId,
          preset: params.preset,
          versionNumber: 1,
          status: 'PROCESSING',
        })
        .returning({ id: schema.MediaAssetVersion.id })

      return { assetId: asset.id, versionId: version.id }
    })

    try {
      // Step 2: Get source data (outside transaction)
      const sourceVersion = await this.dbClient.query.MediaAssetVersion.findFirst({
        where: (t, { eq }) => eq(t.id, params.versionId),
        with: { asset: true, storageLocation: true },
      })

      if (!sourceVersion || !sourceVersion.storageLocation) {
        throw new Error(`Source version not found or missing storage: ${params.versionId}`)
      }
      if (!sourceVersion.asset || sourceVersion.asset.organizationId !== this.organizationId) {
        throw new Error('Unauthorized access to media asset version')
      }

      // Step 3: Download and process image (outside transaction)
      const buffer = await this.storageManager.getContent(sourceVersion.storageLocation.id)

      const { processImage } = await import('./thumbnail-processor.worker')
      const processed = await processImage(buffer, params.preset as PresetKey, params.opts)

      // Step 4: Upload to storage (outside transaction)
      // Generate proper storage key following new architecture
      // Thumbnails use THUMBNAIL entity type, source asset ID as entityId
      const { deriveStorageKey } = await import('../upload/util')
      const format = THUMBNAIL_PRESETS[params.preset as PresetKey].format
      const storageKey = deriveStorageKey(this.organizationId, `${params.preset}.${format}`, {
        entityType: 'THUMBNAIL',
        entityId: sourceVersion.asset.id, // Use source asset ID for grouping
        keySeed: params.preset, // Include preset in filename
      })
      // Result: org123/thumbnail/asset456/1704124800000_avatar-64_avatar-64.webp

      const storageLocation = await this.storageManager.uploadContent({
        provider: 'S3',
        key: storageKey,
        content: processed.buffer,
        mimeType: this.getMimeTypeForFormat(format),
        size: processed.size,
        metadata: {
          organizationId: this.organizationId,
          visibility: params.visibility,
        },
        organizationId: this.organizationId,
        visibility: params.visibility, // Route to correct bucket
      })

      // Step 5: Update placeholder with success
      const metadata: ThumbnailMetadata = {
        dimensions: processed.dimensions,
        actualDimensions: processed.actualDimensions,
        format: processed.format,
        quality: processed.quality,
        fit: processed.fit,
        processedAt: new Date(),
        processingTimeMs: Date.now() - startTime,
        sourceSize: Number(sourceVersion.size ?? 0),
        outputSize: processed.size,
      }

      await this.dbClient.transaction(async (tx) => {
        await tx
          .update(schema.MediaAssetVersion)
          .set({
            storageLocationId: storageLocation.id,
            status: 'READY',
            size: processed.size,
            metadata: metadata,
          })
          .where(eq(schema.MediaAssetVersion.id, placeholder.versionId))

        await tx
          .update(schema.MediaAsset)
          .set({
            currentVersionId: placeholder.versionId,
            size: processed.size,
            name: `${sourceVersion.asset?.name}-${params.preset}`,
          })
          .where(eq(schema.MediaAsset.id, placeholder.assetId))
      })

      this.logger.info('Thumbnail generated', {
        assetId: placeholder.assetId,
        assetVersionId: placeholder.versionId,
        storageLocationId: storageLocation.id,
        preset: params.preset,
        processingTimeMs: Date.now() - startTime,
      })

      return {
        assetId: placeholder.assetId,
        assetVersionId: placeholder.versionId,
        storageLocationId: storageLocation.id,
      }
    } catch (error) {
      // Mark as failed on error
      await this.dbClient
        .update(schema.MediaAssetVersion)
        .set({
          status: 'FAILED',
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
            failedAt: new Date().toISOString(),
          },
        })
        .where(eq(schema.MediaAssetVersion.id, placeholder.versionId))
      throw error
    }
  }

  /**
   * Get MIME type for format
   */
  private getMimeTypeForFormat(format: string): string {
    switch (format) {
      case 'webp':
        return 'image/webp'
      case 'png':
        return 'image/png'
      case 'jpeg':
      default:
        return 'image/jpeg'
    }
  }

  /**
   * Delete thumbnails for a source
   */
  async deleteThumbnailsForSource(sourceVersionId: string): Promise<void> {
    const thumbnails = await this.dbClient.query.MediaAssetVersion.findMany({
      where: (t, { and, eq, isNull }) =>
        and(eq(t.derivedFromVersionId, sourceVersionId), isNull(t.deletedAt)),
      with: { storageLocation: true },
    })

    for (const thumb of thumbnails) {
      // Delete from storage
      if (thumb.storageLocation) {
        await this.storageManager.deleteFile(thumb.storageLocation.id)
      }

      // Soft delete the version
      await this.dbClient
        .update(schema.MediaAssetVersion)
        .set({ deletedAt: new Date() })
        .where(eq(schema.MediaAssetVersion.id, thumb.id))

      // Soft delete the asset
      await this.dbClient
        .update(schema.MediaAsset)
        .set({ deletedAt: new Date() })
        .where(eq(schema.MediaAsset.id, thumb.assetId))
    }

    this.logger.info('Deleted thumbnails for source', {
      sourceVersionId,
      count: thumbnails.length,
    })
  }

  /**
   * Clean up orphaned thumbnails (source no longer exists)
   */
  async cleanupOrphanedThumbnails(
    options: {
      batchSize?: number
      dryRun?: boolean
      organizationId?: string
      maxDeletesPerRun?: number
    } = {}
  ): Promise<CleanupResult> {
    const { batchSize = 100, dryRun = false, organizationId, maxDeletesPerRun = 5000 } = options

    // Find thumbnails where source version no longer exists
    const orgFilter = organizationId ? sql`AND ma."organizationId" = ${organizationId}` : sql``
    const orphanedQuery = sql<
      Array<{
        id: string
        assetId: string
        size: number | null
        storageLocationId: string | null
        preset: string | null
      }>
    >`
      SELECT mav.id, mav."assetId", mav.size, mav."storageLocationId", mav.preset
      FROM "MediaAssetVersion" mav
      INNER JOIN "MediaAsset" ma ON ma.id = mav."assetId"
      WHERE mav."derivedFromVersionId" IS NOT NULL
        AND mav."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "MediaAssetVersion" source
          WHERE source.id = mav."derivedFromVersionId"
            AND source."deletedAt" IS NULL
        )
        AND (ma.kind = 'THUMBNAIL' OR ma.purpose = 'DERIVED')
        ${orgFilter}
      LIMIT ${Math.min(batchSize, maxDeletesPerRun)}
    `
    const orphanedResult = await this.dbClient.execute(orphanedQuery)
    const orphaned = Array.isArray((orphanedResult as any).rows)
      ? ((orphanedResult as any).rows as any[])
      : (orphanedResult as any as any[])

    const items = await Promise.all(
      orphaned.map(async (item) => {
        const fullItem = await this.dbClient.query.MediaAssetVersion.findFirst({
          where: (t, { eq }) => eq(t.id, item.id),
          with: { asset: true, storageLocation: true },
        })
        return fullItem
      })
    )

    return this.processDeletions(items.filter(Boolean), { dryRun, permanent: false })
  }

  /**
   * Clean up thumbnails for outdated versions
   */
  async cleanupOutdatedVersionThumbnails(
    assetId: string,
    keepVersions: number = 3,
    options: { dryRun?: boolean; organizationId?: string } = {}
  ): Promise<CleanupResult> {
    // Get all versions for the asset, ordered by creation
    const versions = await this.dbClient
      .select({ id: schema.MediaAssetVersion.id, createdAt: schema.MediaAssetVersion.createdAt })
      .from(schema.MediaAssetVersion)
      .where(
        and(
          eq(schema.MediaAssetVersion.assetId, assetId),
          isNull(schema.MediaAssetVersion.deletedAt)
        )
      )
      .orderBy(desc(schema.MediaAssetVersion.createdAt))

    if (versions.length <= keepVersions) {
      return { deleted: 0, failed: 0, errors: [], storageFreed: 0 }
    }

    // Identify versions to clean
    const outdatedVersionIds = versions.slice(keepVersions).map((v) => v.id)

    // Find all thumbnails for outdated versions
    const thumbnails = await this.dbClient.query.MediaAssetVersion.findMany({
      where: (t, { and, isNull, inArray }) =>
        and(inArray(t.derivedFromVersionId, outdatedVersionIds), isNull(t.deletedAt)),
      with: { asset: true, storageLocation: true },
      limit: 100,
    })

    return this.processDeletions(thumbnails, {
      dryRun: options.dryRun,
      permanent: false,
    })
  }

  /**
   * Clean up failed thumbnail generation attempts
   */
  async cleanupFailedThumbnails(
    options: {
      maxAgeHours?: number
      batchSize?: number
      dryRun?: boolean
      organizationId?: string
    } = {}
  ): Promise<CleanupResult> {
    const { maxAgeHours = 24, batchSize = 100, dryRun = false, organizationId } = options

    const threshold = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000)

    const failed = await this.dbClient.query.MediaAssetVersion.findMany({
      where: (t, { and, isNull, or, lt, eq, isNotNull }) =>
        and(
          isNotNull(t.derivedFromVersionId),
          isNull(t.deletedAt),
          or(
            eq(t.status, 'FAILED' as any),
            and(eq(t.status, 'PROCESSING' as any), lt(t.createdAt, threshold))
          )
        ),
      with: { asset: true, storageLocation: true },
      limit: batchSize,
    })

    return this.processDeletions(failed, {
      dryRun,
      permanent: true, // Hard delete failed attempts
    })
  }

  /**
   * Clean up soft-deleted thumbnails past retention
   */
  async cleanupExpiredSoftDeletes(
    options: {
      retentionDays?: number
      batchSize?: number
      dryRun?: boolean
      organizationId?: string
    } = {}
  ): Promise<CleanupResult> {
    const { retentionDays = 30, batchSize = 100, dryRun = false, organizationId } = options

    const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

    const expired = await this.dbClient.query.MediaAssetVersion.findMany({
      where: (t, { and, isNotNull, lt }) =>
        and(isNotNull(t.derivedFromVersionId), lt(t.deletedAt, threshold)),
      with: { asset: true, storageLocation: true },
      limit: batchSize,
    })

    return this.processDeletions(expired, {
      dryRun,
      permanent: true,
    })
  }

  /**
   * Helper to process deletions with safety checks and transactions
   */
  private async processDeletions(
    items: any[],
    options: { dryRun?: boolean; permanent?: boolean }
  ): Promise<CleanupResult> {
    const result: CleanupResult = {
      deleted: 0,
      failed: 0,
      errors: [],
      storageFreed: 0,
      details: [], // For dry-run visibility
    }

    // Batch storage deletions for efficiency
    const storageKeysToDelete: string[] = []

    for (const item of items) {
      try {
        // CRITICAL SAFETY CHECK: Never delete original assets
        if (item.asset?.kind !== 'THUMBNAIL' && item.asset?.purpose !== 'DERIVED') {
          this.logger.warn('Refusing to delete non-thumbnail asset', {
            assetId: item.assetId,
            kind: item.asset?.kind,
            purpose: item.asset?.purpose,
          })
          continue
        }

        // Calculate size properly (handle BigInt)
        const sizeBytes = item.size ? Number(item.size) : 0

        if (options.dryRun) {
          // Collect details for dry-run output
          result.details?.push({
            assetId: item.assetId,
            versionId: item.id,
            bytes: sizeBytes,
            preset: item.preset || 'unknown',
          })
          result.deleted++
          result.storageFreed += sizeBytes
          continue
        }

        // Collect storage keys for batch deletion
        if (item.storageLocation?.id) {
          storageKeysToDelete.push(item.storageLocation.id)
        }

        if (options.permanent) {
          // Use transaction for race-safe deletion
          await this.dbClient.transaction(async (tx) => {
            // Delete the version
            await tx
              .delete(schema.MediaAssetVersion)
              .where(eq(schema.MediaAssetVersion.id, item.id))

            // Check if asset should be deleted
            const [remaining] = await tx
              .select({ cnt: count() })
              .from(schema.MediaAssetVersion)
              .where(
                and(
                  eq(schema.MediaAssetVersion.assetId, item.assetId),
                  isNull(schema.MediaAssetVersion.deletedAt)
                )
              )

            if ((remaining?.cnt ?? 0) === 0) {
              // Only delete if it's a thumbnail asset (double-check)
              const asset = await tx.query.MediaAsset.findFirst({
                where: (t, { eq }) => eq(t.id, item.assetId),
                columns: { kind: true, purpose: true },
              })

              if (asset?.kind === 'THUMBNAIL' || asset?.purpose === 'DERIVED') {
                await tx.delete(schema.MediaAsset).where(eq(schema.MediaAsset.id, item.assetId))
              }
            }
          })
        } else {
          // Soft delete
          await this.dbClient.transaction(async (tx) => {
            await tx
              .update(schema.MediaAssetVersion)
              .set({ deletedAt: new Date() })
              .where(eq(schema.MediaAssetVersion.id, item.id))

            // Check if all versions are soft deleted
            const [active] = await tx
              .select({ cnt: count() })
              .from(schema.MediaAssetVersion)
              .where(
                and(
                  eq(schema.MediaAssetVersion.assetId, item.assetId),
                  isNull(schema.MediaAssetVersion.deletedAt)
                )
              )

            if ((active?.cnt ?? 0) === 0) {
              // Only soft-delete asset if it's a thumbnail
              const asset = await tx.query.MediaAsset.findFirst({
                where: (t, { eq }) => eq(t.id, item.assetId),
                columns: { kind: true, purpose: true },
              })

              if (asset?.kind === 'THUMBNAIL' || asset?.purpose === 'DERIVED') {
                await tx
                  .update(schema.MediaAsset)
                  .set({ deletedAt: new Date() })
                  .where(eq(schema.MediaAsset.id, item.assetId))
              }
            }
          })
        }

        result.deleted++
        result.storageFreed += sizeBytes

        this.logger.debug('Processed thumbnail deletion', {
          versionId: item.id,
          assetId: item.assetId,
          permanent: options.permanent,
          sizeBytes,
        })
      } catch (error) {
        result.failed++
        result.errors.push(error as Error)

        this.logger.error('Failed to delete thumbnail', {
          versionId: item.id,
          error: error instanceof Error ? error.message : 'Unknown',
        })
      }
    }

    // Batch delete from storage (after DB operations succeed)
    if (storageKeysToDelete.length > 0 && !options.dryRun) {
      try {
        // Use batch deletion if available
        await this.batchDeleteFromStorage(storageKeysToDelete)
      } catch (error) {
        this.logger.error('Batch storage deletion failed', {
          count: storageKeysToDelete.length,
          error: error instanceof Error ? error.message : 'Unknown',
        })
      }
    }

    return result
  }

  /**
   * Batch delete files from storage
   */
  private async batchDeleteFromStorage(keys: string[]): Promise<void> {
    // Attempt to delete in parallel with error handling
    const results = await Promise.allSettled(
      keys.map((key) =>
        this.storageManager.deleteFile(key).catch((err) => {
          this.logger.warn('Storage deletion failed', { key, error: err.message })
          throw err
        })
      )
    )

    const failures = results.filter((r) => r.status === 'rejected')
    if (failures.length > 0) {
      this.logger.warn('Some storage deletions failed', {
        total: keys.length,
        failed: failures.length,
      })
    }
  }
}

/**
 * Cleanup result interface
 */
export interface CleanupResult {
  deleted: number
  failed: number
  errors: Error[]
  storageFreed: number
  details?: Array<{
    assetId: string
    versionId: string
    bytes: number
    preset: string
  }>
}
