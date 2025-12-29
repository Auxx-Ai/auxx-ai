// packages/lib/src/jobs/maintenance/media-asset-cleanup-job.ts

import type { Job } from 'bullmq'
import { createScopedLogger } from '@auxx/logger'
import { MediaAssetService } from '../../files/core/media-asset-service'
import { StorageManager } from '../../files/storage/storage-manager'
import { database as db, schema } from '@auxx/database'
import { eq, and, isNull, isNotNull, lte, sql } from 'drizzle-orm'

const logger = createScopedLogger('media-asset-cleanup-job')

interface MediaAssetCleanupJobData {
  organizationId: string
  options?: {
    maxAgeHours?: number
    batchSize?: number
    dryRun?: boolean
  }
}

interface CleanupStats {
  assetsScanned: number
  assetsDeleted: number
  storageFreed: number // bytes
  errors: number
}

/**
 * Clean up expired MediaAssets based on metadata
 * This job handles temporary files created by WorkflowProcessor and other processors
 */
export const cleanupExpiredMediaAssetsJob = async (job: Job<MediaAssetCleanupJobData>) => {
  const { organizationId, options = {} } = job.data
  const { maxAgeHours = 24, batchSize = 100, dryRun = false } = options

  logger.info('Starting MediaAsset cleanup job', {
    organizationId,
    maxAgeHours,
    batchSize,
    dryRun,
    jobId: job.id,
  })

  const stats: CleanupStats = {
    assetsScanned: 0,
    assetsDeleted: 0,
    storageFreed: 0,
    errors: 0,
  }

  try {
    await job.updateProgress(10)

    // Initialize MediaAsset service
    const mediaAssetService = new MediaAssetService(organizationId)

    // Find expired assets using the new expiresAt field
    const currentTime = new Date()

    // Query database directly for expired MediaAssets using the expiresAt field
    const expiredAssets = await db.query.MediaAsset.findMany({
      columns: {
        id: true,
        name: true,
        expiresAt: true,
      },
      with: {
        currentVersion: {
          columns: {
            id: true,
          },
          with: {
            storageLocation: {
              columns: {
                id: true,
                size: true,
              },
            },
          },
        },
      },
      where: and(
        eq(schema.MediaAsset.organizationId, organizationId),
        isNull(schema.MediaAsset.deletedAt),
        lte(schema.MediaAsset.expiresAt, currentTime)
      ),
    })

    logger.info('Found expired MediaAssets', {
      expiredCount: expiredAssets.length,
      organizationId,
    })

    await job.updateProgress(30)

    // Process assets in batches
    for (let i = 0; i < expiredAssets.length; i += batchSize) {
      const batch = expiredAssets.slice(i, i + batchSize)
      stats.assetsScanned += batch.length

      for (const asset of batch) {
        try {
          const storageSize = asset.currentVersion?.storageLocation?.size || 0

          if (!dryRun) {
            // Delete from storage first if we have a storage location
            if (asset.currentVersion?.storageLocation) {
              try {
                const storageManager = new StorageManager(organizationId)
                await storageManager.deleteFile(asset.currentVersion.storageLocation.id)
                logger.debug('Deleted file from storage', {
                  assetId: asset.id,
                  storageLocationId: asset.currentVersion.storageLocation.id,
                })
              } catch (storageError) {
                logger.warn('Failed to delete from storage, continuing with database cleanup', {
                  assetId: asset.id,
                  error:
                    storageError instanceof Error ? storageError.message : String(storageError),
                })
              }
            }

            // Delete the MediaAsset from database (hard delete for expired temporary files)
            await mediaAssetService.delete(asset.id)
            stats.assetsDeleted++
            stats.storageFreed += storageSize

            logger.debug('Deleted expired MediaAsset', {
              assetId: asset.id,
              filename: asset.name,
              size: storageSize,
              expiresAt: asset.expiresAt,
            })
          } else {
            logger.info('Would delete expired MediaAsset (dry run)', {
              assetId: asset.id,
              filename: asset.name,
              size: storageSize,
              expiresAt: asset.expiresAt,
            })
            stats.assetsDeleted++ // Count for dry run
            stats.storageFreed += storageSize
          }
        } catch (error) {
          stats.errors++
          logger.error('Failed to delete MediaAsset', {
            assetId: asset.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Update progress
      const progress = Math.min(30 + (i / expiredAssets.length) * 60, 90)
      await job.updateProgress(progress)

      logger.info('Processed MediaAsset cleanup batch', {
        batchStart: i,
        batchSize: batch.length,
        totalProcessed: Math.min(i + batchSize, expiredAssets.length),
        totalFound: expiredAssets.length,
      })
    }

    await job.updateProgress(100)

    logger.info('MediaAsset cleanup job completed', {
      organizationId,
      stats,
      dryRun,
      jobId: job.id,
    })

    return {
      success: true,
      organizationId,
      stats,
      dryRun,
    }
  } catch (error) {
    logger.error('MediaAsset cleanup job failed', {
      error: error instanceof Error ? error.message : String(error),
      organizationId,
      stats,
      jobId: job.id,
    })

    throw error
  }
}

/**
 * Get cleanup statistics without performing actual cleanup
 */
export const getMediaAssetCleanupStats = async (organizationId: string, maxAgeHours = 24) => {
  const currentTime = new Date()

  try {
    // Count expired assets using the expiresAt field
    const [expiredCountResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.MediaAsset)
      .where(
        and(
          eq(schema.MediaAsset.organizationId, organizationId),
          isNull(schema.MediaAsset.deletedAt),
          lte(schema.MediaAsset.expiresAt, currentTime)
        )
      )

    const expiredCount = expiredCountResult.count

    // Count total assets with expiration set
    const [assetsWithExpirationResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.MediaAsset)
      .where(
        and(
          eq(schema.MediaAsset.organizationId, organizationId),
          isNull(schema.MediaAsset.deletedAt),
          isNotNull(schema.MediaAsset.expiresAt)
        )
      )

    const assetsWithExpirationCount = assetsWithExpirationResult.count

    return {
      expiredAssets: expiredCount,
      assetsWithExpiration: assetsWithExpirationCount,
      maxAgeHours,
      organizationId,
    }
  } catch (error) {
    logger.error('Failed to get MediaAsset cleanup stats', {
      error: error instanceof Error ? error.message : String(error),
      organizationId,
    })
    throw error
  }
}
