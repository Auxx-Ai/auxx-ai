// packages/lib/src/jobs/maintenance/generate-thumbnail-job.ts

import { database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { and, eq, isNull } from 'drizzle-orm'
import {
  type AvatarResolution,
  applyAvatarThumbnailUrl,
  publishAvatarResolved,
} from '../../field-values/avatar-thumbnail'
import { MediaAssetService } from '../../files/core/media-asset-service'
import {
  getMimeTypeForFormat,
  normalizeImageSource,
  processImage,
  UnsupportedImageError,
  validateSource,
} from '../../files/core/thumbnail-processor.worker'
import { createStorageManager } from '../../files/storage/storage-manager'
import type { GenerateThumbnailPayload, PresetKey, ThumbnailMetadata } from '../../files/thumbnails'
import {
  assertPresetKey,
  generateThumbnailSchema,
  loadThumbnail,
  releaseThumbnailLatch,
} from '../../files/thumbnails'
import { createScopedLogger } from '../../logger'
import type { JobContext } from '../types'

/**
 * Schema for thumbnail generation job payload.
 *
 * Defined in `files/thumbnails/thumbnail-job.ts` — the job contract belongs with
 * the producer's key derivation, not with one of its two consumers — and
 * re-exported here because `jobs/index.ts` is where the worker registry looks.
 */
export { generateThumbnailSchema }

const logger = createScopedLogger('generate-thumbnail-job')

/**
 * Worker job for generating thumbnails in background
 */
export const generateThumbnailJob = async (ctx: JobContext): Promise<void> => {
  const job = ctx.job
  const payload = job.data as GenerateThumbnailPayload
  const startTime = Date.now()
  const { orgId, userId, versionId, preset, opts, key, visibility } = payload

  // Use org-scoped StorageManager for proper credential management
  const storageManager = createStorageManager(orgId)

  try {
    logger.info('Starting thumbnail generation', {
      versionId,
      preset,
      key,
      jobId: job.id,
    })

    // Check if already generated (race condition protection). Same lookup the
    // enqueuer runs, imported rather than restated so the two cannot diverge on
    // which index they probe.
    const existing = await loadThumbnail(
      { db, organizationId: orgId },
      versionId,
      assertPresetKey(preset)
    )

    if (existing) {
      logger.info('Thumbnail already exists, skipping', {
        versionId,
        preset,
        existingVersionId: existing.id,
      })
      return
    }

    // Get source version
    const [sourceVersion] = await db
      .select({
        id: schema.MediaAssetVersion.id,
        assetId: schema.MediaAssetVersion.assetId,
        storageLocationId: schema.MediaAssetVersion.storageLocationId,
        size: schema.MediaAssetVersion.size,
        metadata: schema.MediaAssetVersion.metadata,
        asset: {
          id: schema.MediaAsset.id,
          name: schema.MediaAsset.name,
          mimeType: schema.MediaAsset.mimeType,
        },
        storageLocation: {
          id: schema.StorageLocation.id,
        },
      })
      .from(schema.MediaAssetVersion)
      .leftJoin(schema.MediaAsset, eq(schema.MediaAssetVersion.assetId, schema.MediaAsset.id))
      .leftJoin(
        schema.StorageLocation,
        and(
          eq(schema.MediaAssetVersion.storageLocationId, schema.StorageLocation.id),
          isNull(schema.StorageLocation.deletedAt)
        )
      )
      .where(eq(schema.MediaAssetVersion.id, versionId))
      .limit(1)

    if (!sourceVersion) {
      throw new Error(`Source version not found: ${versionId}`)
    }

    if (!sourceVersion.storageLocation) {
      throw new Error(`Source version has no storage location: ${versionId}`)
    }

    // Download source file
    const sourceBuffer = await storageManager.getContent(sourceVersion.storageLocationId!)

    // Canonical decode/normalize: ICO → PNG, SVG → sanitized PNG, else passthrough.
    // Runs before validate/resize so the rest of the pipeline only sees formats
    // sharp can read.
    const normalized = await normalizeImageSource(sourceBuffer)
    if (normalized.normalizedFrom) {
      logger.info('Normalized source image before thumbnailing', {
        versionId,
        preset,
        normalizedFrom: normalized.normalizedFrom,
      })
    }

    // Validate source
    await validateSource(normalized.buffer, normalized.mime)

    // Process image
    const processed = await processImage(normalized.buffer, preset as PresetKey, opts)

    // Upload to storage using the new uploadContent method
    const storageKey = `thumbs/${orgId}/${versionId}/${preset}.${processed.format}`
    const storageLocation = await storageManager.uploadContent({
      provider: 'S3',
      key: storageKey,
      content: processed.buffer,
      mimeType: getMimeTypeForFormat(processed.format),
      size: processed.size,
      visibility: visibility ?? opts.visibility,
      metadata: {
        orgId,
        userId,
        versionId,
        preset,
      },
      organizationId: orgId,
    })

    // Create asset and version using MediaAssetService
    const mediaAssetService = new MediaAssetService(orgId, userId, db)

    // Returned OUT of the transaction rather than captured in an outer `let`:
    // TypeScript's control-flow analysis does not see assignments made inside a
    // callback, so a mutable capture narrows to `null` at the post-commit check.
    const avatarResolved = await db.transaction(async (tx): Promise<AvatarResolution | null> => {
      // Create thumbnail asset with version using the service
      const { asset, version } = await mediaAssetService.createWithVersion(
        {
          kind: 'THUMBNAIL',
          purpose: 'DERIVED',
          name: `${sourceVersion.asset?.name}-${preset}`,
          mimeType: getMimeTypeForFormat(processed.format),
          size: processed.size,
          isPrivate: visibility === 'PRIVATE',
          // parentAssetId: sourceVersion.assetId,
          // metadata: {
          //   sourceAssetId: sourceVersion.assetId,
          //   preset,
          // },
          organizationId: orgId,
          createdById: userId,
        },
        storageLocation.id
      )

      // Add thumbnail-specific metadata to version
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

      // Update version with additional metadata
      await tx
        .update(schema.MediaAssetVersion)
        .set({
          derivedFromVersionId: versionId,
          preset,
          metadata: metadata as any,
        })
        .where(eq(schema.MediaAssetVersion.id, version.id))

      logger.info('Thumbnail generated successfully', {
        assetId: asset.id,
        versionId: version.id,
        preset,
        processingTimeMs: Date.now() - startTime,
        sourceSize: Number(sourceVersion.size ?? 0),
        outputSize: processed.size,
      })

      // Update KnowledgeBase logos if applicable (kb-logo-lg)
      await updateKBLogoIfApplicable({
        tx,
        orgId,
        sourceVersion,
        derivedVersionId: version.id,
        preset,
      })

      // Update entity avatar URLs if applicable (avatar-128). Carried out of
      // the tx so we can fire realtime updates AFTER it commits — see the
      // docstring on updateEntityAvatarIfApplicable for why.
      const resolvedAvatar = await updateEntityAvatarIfApplicable({
        tx,
        orgId,
        sourceVersion,
        storageLocation,
        preset,
      })

      // Update user avatar if requested
      if (opts.updateUser) {
        await updateUserAvatarIfBeneficial({
          tx,
          sourceVersion,
          storageLocation,
          processed,
          preset,
        })
      }

      return resolvedAvatar
    })

    // Release the enqueue latch the production QueuePort took. The key shape is
    // derived once in `files/thumbnails/presets.ts`; it used to be spelled out
    // here and in `ThumbnailService`, and a third producer wrote a differently
    // shaped one that this delete never matched.
    const redis = await getRedisClient(false)
    if (redis) {
      await releaseThumbnailLatch(redis, key)
    }

    // Post-commit: push the resolved avatar CDN URL to any listening clients.
    if (avatarResolved) {
      await publishAvatarResolved({
        organizationId: orgId,
        cdnUrl: avatarResolved.cdnUrl,
        instances: avatarResolved.instances,
      })
    }
  } catch (error) {
    // Release the latch regardless of outcome — holding it for the full TTL
    // would delay the retry BullMQ has already scheduled.
    const redis = await getRedisClient(false)
    if (redis) {
      await releaseThumbnailLatch(redis, key)
    }

    // Unsupported / undetectable source types (e.g. `.ico` favicons captured
    // during company enrichment) can never succeed — treat as a soft skip so
    // BullMQ doesn't burn its retry budget on a deterministic failure.
    if (error instanceof UnsupportedImageError) {
      logger.warn('Skipping thumbnail — unsupported source image type', {
        versionId,
        preset,
        error: error.message,
      })
      return
    }

    logger.error('Failed to generate thumbnail', {
      versionId,
      preset,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    throw error
  }
}

/**
 * Updates user avatar if the thumbnail provides benefit over the original
 */
async function updateUserAvatarIfBeneficial(params: {
  tx: any
  sourceVersion: any
  storageLocation: any
  processed: any
  preset: string
}): Promise<void> {
  const { tx, sourceVersion, storageLocation, processed, preset } = params

  // Only update for avatar-64 preset
  if (preset !== 'avatar-64') return

  // Find user with this avatar
  const [user] = await tx
    .select()
    .from(schema.User)
    .where(eq(schema.User.avatarAssetId, sourceVersion.assetId))
    .limit(1)

  if (!user) return

  // Determine if thumbnail provides value
  const originalWidth =
    sourceVersion.metadata?.width ||
    sourceVersion.metadata?.originalWidth ||
    sourceVersion.metadata?.dimensions?.width

  const isOptimized =
    // Thumbnail is smaller than original (saves bandwidth)
    processed.actualDimensions.width < originalWidth ||
    // Format changed to more efficient one
    (processed.format === 'webp' && !sourceVersion.asset?.mimeType?.includes('webp'))

  if (!isOptimized) {
    logger.debug('Thumbnail provides no optimization benefit', {
      userId: user.id,
      originalWidth,
      thumbnailWidth: processed.actualDimensions.width,
    })
    return
  }

  // Update user with optimized thumbnail
  await tx
    .update(schema.User)
    .set({ image: storageLocation.externalUrl })
    .where(eq(schema.User.id, user.id))

  logger.info('Updated user avatar with optimized thumbnail', {
    userId: user.id,
    preset,
    originalWidth,
    thumbnailWidth: processed.actualDimensions.width,
    format: processed.format,
  })
}

/**
 * Updates KnowledgeBase.logoLight/logoDark when kb-logo-lg preset is generated.
 */
async function updateKBLogoIfApplicable(params: {
  tx: any
  orgId: string
  sourceVersion: any
  derivedVersionId: string
  preset: string
}): Promise<void> {
  const { tx, orgId, sourceVersion, derivedVersionId, preset } = params
  if (preset !== 'kb-logo-lg') return

  // Resolve derived URL
  const [derived] = await tx
    .select({
      id: schema.MediaAssetVersion.id,
      storageLocation: {
        externalUrl: schema.StorageLocation.externalUrl,
      },
    })
    .from(schema.MediaAssetVersion)
    .leftJoin(
      schema.StorageLocation,
      and(
        eq(schema.MediaAssetVersion.storageLocationId, schema.StorageLocation.id),
        isNull(schema.StorageLocation.deletedAt)
      )
    )
    .where(eq(schema.MediaAssetVersion.id, derivedVersionId))
    .limit(1)
  const url = derived?.storageLocation?.externalUrl
  if (!url) return

  // Find KB attachments for the source asset
  const attachments = await tx
    .select({
      entityId: schema.Attachment.entityId,
      title: schema.Attachment.title,
    })
    .from(schema.Attachment)
    .where(
      and(
        eq(schema.Attachment.organizationId, orgId),
        eq(schema.Attachment.entityType, 'KNOWLEDGE_BASE'),
        eq(schema.Attachment.role, 'KB_LOGO'),
        eq(schema.Attachment.assetId, sourceVersion.assetId)
      )
    )

  for (const a of attachments) {
    const variant = a.title === 'kb-logo-dark' ? 'dark' : 'light'
    const data = variant === 'dark' ? { logoDark: url } : { logoLight: url }
    await tx.update(schema.KnowledgeBase).set(data).where(eq(schema.KnowledgeBase.id, a.entityId))
  }
}

/**
 * Updates EntityInstance.avatarUrl when an avatar-128 preset thumbnail is generated.
 *
 * The lookup, the write and the realtime publish all live in
 * `field-values/avatar-thumbnail` because this job is NOT the only path that
 * resolves an avatar: `ThumbnailService.ensureThumbnail` answers `ready` without
 * queuing anything when the preset already exists, and the save path has to do the
 * same write itself in that case. Keeping one implementation is what stops the two
 * from drifting.
 *
 * Returns the affected pairs + cdnUrl so the caller can publish AFTER the
 * transaction commits — publishing inside it risks firing before the DB state is
 * durable, and a rollback would have announced state that was never saved.
 */
async function updateEntityAvatarIfApplicable(params: {
  tx: any
  orgId: string
  sourceVersion: any
  storageLocation: any
  preset: string
}): Promise<AvatarResolution | null> {
  const { tx, orgId, sourceVersion, storageLocation, preset } = params
  if (preset !== 'avatar-128') return null

  const cdnUrl = storageLocation?.externalUrl
  if (!cdnUrl) return null

  const assetId = sourceVersion.assetId
  if (!assetId) return null

  return applyAvatarThumbnailUrl(tx, orgId, assetId, cdnUrl)
}
