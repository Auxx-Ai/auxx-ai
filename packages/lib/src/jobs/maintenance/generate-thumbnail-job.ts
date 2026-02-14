// packages/lib/src/jobs/maintenance/generate-thumbnail-job.ts

import { database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { MediaAssetService } from '../../files/core/media-asset-service'
import {
  getMimeTypeForFormat,
  processImage,
  validateSource,
} from '../../files/core/thumbnail-processor.worker'
import type {
  GenerateThumbnailPayload,
  PresetKey,
  ThumbnailMetadata,
} from '../../files/core/thumbnail-types'
import { createStorageManager } from '../../files/storage/storage-manager'
import { createScopedLogger } from '../../logger'

/**
 * Schema for thumbnail generation job payload
 */
export const generateThumbnailSchema = z.object({
  orgId: z.string(),
  userId: z.string(),
  versionId: z.string(),
  preset: z.string(),
  opts: z.object({
    preset: z.string().optional(),
    queue: z.boolean().optional(),
    format: z.enum(['webp', 'jpeg', 'png']).optional(),
    quality: z.number().optional(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    updateUser: z.boolean().optional(),
  }),
  key: z.string(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
})

const logger = createScopedLogger('generate-thumbnail-job')

/**
 * Worker job for generating thumbnails in background
 */
export const generateThumbnailJob = async (job: any): Promise<void> => {
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

    // Check if already generated (race condition protection)
    const [existing] = await db
      .select()
      .from(schema.MediaAssetVersion)
      .where(
        and(
          eq(schema.MediaAssetVersion.derivedFromVersionId, versionId),
          eq(schema.MediaAssetVersion.preset, preset),
          isNull(schema.MediaAssetVersion.deletedAt)
        )
      )
      .limit(1)

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
        eq(schema.MediaAssetVersion.storageLocationId, schema.StorageLocation.id)
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

    // Validate source
    await validateSource(sourceBuffer, sourceVersion.asset?.mimeType)

    // Process image
    const processed = await processImage(sourceBuffer, preset as PresetKey, opts)

    // Upload to storage using the new uploadContent method
    const storageKey = `/thumbs/${orgId}/${versionId}/${preset}.${processed.format}`
    const storageLocation = await storageManager.uploadContent({
      provider: 'S3',
      key: storageKey,
      content: processed.buffer,
      mimeType: getMimeTypeForFormat(processed.format),
      size: processed.size,
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

    await db.transaction(async (tx) => {
      // Create thumbnail asset with version using the service
      const { asset, version } = await mediaAssetService.createWithVersion(
        {
          kind: 'THUMBNAIL',
          purpose: 'DERIVED',
          name: `${sourceVersion.asset?.name}-${preset}`,
          mimeType: getMimeTypeForFormat(processed.format),
          size: BigInt(processed.size),
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
    })

    // Clear processing cache
    const redis = await getRedisClient()
    if (redis) {
      await redis.del(`processing:thumb:${key}`)
    }
  } catch (error) {
    logger.error('Failed to generate thumbnail', {
      versionId,
      preset,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Clear processing cache on error
    const redis = await getRedisClient()
    if (redis) {
      await redis.del(`processing:thumb:${key}`)
    }

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
      eq(schema.MediaAssetVersion.storageLocationId, schema.StorageLocation.id)
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
