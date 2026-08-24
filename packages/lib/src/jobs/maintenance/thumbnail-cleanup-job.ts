// packages/lib/src/jobs/maintenance/thumbnail-cleanup-job.ts

import { database as db, schema } from '@auxx/database'
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { createS3StoragePort } from '../../files/storage/ports'
import {
  type CleanupResult,
  cleanupExpiredSoftDeletes,
  cleanupFailedThumbnails,
  cleanupOrphanedThumbnails,
  cleanupOutdatedVersionThumbnails,
} from '../../files/thumbnails'
import { createScopedLogger } from '../../logger'
import type { JobContext } from '../types'

const logger = createScopedLogger('thumbnail-cleanup-job')

/**
 * Configuration for thumbnail cleanup job
 */
export interface ThumbnailCleanupJobData {
  organizationId?: string
  cleanupTypes?: Array<'orphaned' | 'outdated' | 'failed' | 'expired'>
  options?: {
    batchSize?: number
    dryRun?: boolean
    keepVersions?: number
    retentionDays?: number
    maxAgeHours?: number
    maxDeletesPerRun?: number
  }
}

/**
 * Cleanup statistics for each type
 */
interface CleanupStats {
  deleted: number
  failed: number
  storageFreed: number
}

/** Narrow a sweep's {@link CleanupResult} to the counters this job reports. */
function toStats(result: CleanupResult): CleanupStats {
  return {
    deleted: result.deleted,
    failed: result.failed,
    storageFreed: result.storageFreed,
  }
}

/**
 * Unwrap a sweep's `Result`, rethrowing so the per-type `try/catch` below still
 * records it as an error rather than silently reporting zeroes.
 */
async function unwrap(pending: Promise<Result<CleanupResult, AuxxError>>): Promise<CleanupResult> {
  const result = await pending
  if (result.isErr()) throw result.error
  return result.value
}

/**
 * Complete result of thumbnail cleanup job
 */
interface ThumbnailCleanupResult {
  organizationId?: string
  orphaned: CleanupStats
  outdated: CleanupStats
  failed: CleanupStats
  expired: CleanupStats
  totalDeleted: number
  totalStorageFreed: number
  errors: number
}

/**
 * Comprehensive thumbnail cleanup job
 * Handles orphaned, outdated, failed, and expired thumbnails
 */
export async function thumbnailCleanupJob(
  ctx: JobContext<ThumbnailCleanupJobData>
): Promise<ThumbnailCleanupResult> {
  const job = ctx.job
  const {
    organizationId,
    cleanupTypes = ['orphaned', 'failed', 'expired'],
    options = {},
  } = job.data

  const {
    batchSize = 100,
    dryRun = false,
    keepVersions = 3,
    retentionDays = 30,
    maxAgeHours = 24,
    maxDeletesPerRun = 5000,
  } = options

  logger.info('Starting thumbnail cleanup job', {
    organizationId,
    cleanupTypes,
    options,
    jobId: job.id,
  })

  const result: ThumbnailCleanupResult = {
    organizationId,
    orphaned: { deleted: 0, failed: 0, storageFreed: 0 },
    outdated: { deleted: 0, failed: 0, storageFreed: 0 },
    failed: { deleted: 0, failed: 0, storageFreed: 0 },
    expired: { deleted: 0, failed: 0, storageFreed: 0 },
    totalDeleted: 0,
    totalStorageFreed: 0,
    errors: 0,
  }

  try {
    // PR 5f: four free functions over a `Database` + a `StoragePort`, not a
    // service constructed with a fabricated `'system'` organization id. The
    // organization is what it always was here — an optional *filter* — and it is
    // now actually applied (three of the four legacy methods destructured it and
    // ignored it, so a per-org invocation swept every tenant).
    const deps = {
      storage: createS3StoragePort(organizationId),
      now: () => new Date(),
    }

    let progress = 0
    const progressStep = 100 / cleanupTypes.length

    // Process each cleanup type
    for (const cleanupType of cleanupTypes) {
      logger.info(`Processing ${cleanupType} thumbnails`)

      try {
        switch (cleanupType) {
          case 'orphaned':
            result.orphaned = toStats(
              await unwrap(
                cleanupOrphanedThumbnails(db, deps, {
                  batchSize,
                  dryRun,
                  organizationId,
                  maxDeletesPerRun,
                })
              )
            )
            break

          case 'outdated':
            if (organizationId) {
              // Get all assets for the organization
              const assets = await db
                .select({ id: schema.MediaAsset.id })
                .from(schema.MediaAsset)
                .where(
                  and(
                    eq(schema.MediaAsset.organizationId, organizationId),
                    isNull(schema.MediaAsset.deletedAt),
                    eq(schema.MediaAsset.purpose, 'ORIGINAL')
                  )
                )
                .limit(100)

              for (const asset of assets) {
                const assetResult = await unwrap(
                  cleanupOutdatedVersionThumbnails(db, deps, asset.id, {
                    keepVersions,
                    batchSize,
                    dryRun,
                    organizationId,
                  })
                )
                result.outdated.deleted += assetResult.deleted
                result.outdated.failed += assetResult.failed
                result.outdated.storageFreed += assetResult.storageFreed
              }
            } else {
              logger.info('Skipping outdated cleanup - requires organizationId')
            }
            break

          case 'failed':
            result.failed = toStats(
              await unwrap(
                cleanupFailedThumbnails(db, deps, {
                  maxAgeHours,
                  batchSize,
                  dryRun,
                  organizationId,
                })
              )
            )
            break

          case 'expired':
            result.expired = toStats(
              await unwrap(
                cleanupExpiredSoftDeletes(db, deps, {
                  retentionDays,
                  batchSize,
                  dryRun,
                  organizationId,
                })
              )
            )
            break
        }

        logger.info(`Completed ${cleanupType} cleanup`, {
          deleted: result[cleanupType].deleted,
          failed: result[cleanupType].failed,
          storageFreed: result[cleanupType].storageFreed,
        })
      } catch (error) {
        logger.error(`Failed to process ${cleanupType} cleanup`, {
          error: error instanceof Error ? error.message : String(error),
        })
        result.errors++
      }

      progress += progressStep
      await job.updateProgress(Math.min(progress, 99))
    }

    // Calculate totals
    result.totalDeleted =
      result.orphaned.deleted +
      result.outdated.deleted +
      result.failed.deleted +
      result.expired.deleted

    result.totalStorageFreed =
      result.orphaned.storageFreed +
      result.outdated.storageFreed +
      result.failed.storageFreed +
      result.expired.storageFreed

    await job.updateProgress(100)

    logger.info('Thumbnail cleanup job completed', {
      result,
      dryRun,
      jobId: job.id,
    })

    return result
  } catch (error) {
    logger.error('Thumbnail cleanup job failed', {
      error: error instanceof Error ? error.message : String(error),
      organizationId,
      jobId: job.id,
    })
    throw error
  }
}

/**
 * Get thumbnail cleanup statistics for monitoring
 */
export async function getThumbnailCleanupStats(organizationId?: string): Promise<{
  orphaned: number
  failed: number
  expired: number
  totalThumbnails: number
  totalStorageSize: number
}> {
  try {
    // Count orphaned (source doesn't exist)
    const orphanedCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.MediaAssetVersion)
      .innerJoin(schema.MediaAsset, eq(schema.MediaAsset.id, schema.MediaAssetVersion.assetId))
      .where(
        and(
          isNotNull(schema.MediaAssetVersion.derivedFromVersionId),
          isNull(schema.MediaAssetVersion.deletedAt),
          // NOT EXISTS clause for orphaned check
          sql`NOT EXISTS (
            SELECT 1 FROM ${schema.MediaAssetVersion} source
            WHERE source.id = ${schema.MediaAssetVersion.derivedFromVersionId}
              AND source."deletedAt" IS NULL
          )`,
          or(eq(schema.MediaAsset.kind, 'THUMBNAIL'), eq(schema.MediaAsset.purpose, 'DERIVED')),
          organizationId ? eq(schema.MediaAsset.organizationId, organizationId) : sql`1=1`
        )
      )

    const orphanedCount = orphanedCountResult[0]?.count || 0

    // Count failed
    const failedCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.MediaAssetVersion)
      .innerJoin(schema.MediaAsset, eq(schema.MediaAsset.id, schema.MediaAssetVersion.assetId))
      .where(
        and(
          isNotNull(schema.MediaAssetVersion.derivedFromVersionId),
          isNull(schema.MediaAssetVersion.deletedAt),
          or(
            eq(schema.MediaAssetVersion.status, 'FAILED'),
            and(
              eq(schema.MediaAssetVersion.status, 'PROCESSING'),
              lt(schema.MediaAssetVersion.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
            )
          ),
          organizationId ? eq(schema.MediaAsset.organizationId, organizationId) : sql`1=1`,
          or(eq(schema.MediaAsset.kind, 'THUMBNAIL'), eq(schema.MediaAsset.purpose, 'DERIVED'))
        )
      )

    const failedCount = failedCountResult[0]?.count || 0

    // Count expired soft-deletes
    const expiredCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.MediaAssetVersion)
      .innerJoin(schema.MediaAsset, eq(schema.MediaAsset.id, schema.MediaAssetVersion.assetId))
      .where(
        and(
          isNotNull(schema.MediaAssetVersion.derivedFromVersionId),
          lt(schema.MediaAssetVersion.deletedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
          organizationId ? eq(schema.MediaAsset.organizationId, organizationId) : sql`1=1`,
          or(eq(schema.MediaAsset.kind, 'THUMBNAIL'), eq(schema.MediaAsset.purpose, 'DERIVED'))
        )
      )

    const expiredCount = expiredCountResult[0]?.count || 0

    // Total thumbnails
    const totalThumbnailsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.MediaAssetVersion)
      .innerJoin(schema.MediaAsset, eq(schema.MediaAsset.id, schema.MediaAssetVersion.assetId))
      .where(
        and(
          isNotNull(schema.MediaAssetVersion.derivedFromVersionId),
          organizationId ? eq(schema.MediaAsset.organizationId, organizationId) : sql`1=1`,
          or(eq(schema.MediaAsset.kind, 'THUMBNAIL'), eq(schema.MediaAsset.purpose, 'DERIVED'))
        )
      )

    const totalThumbnails = totalThumbnailsResult[0]?.count || 0

    // Total storage size
    const storageStatsResult = await db
      .select({ totalSize: sql<number>`sum(${schema.MediaAssetVersion.size})` })
      .from(schema.MediaAssetVersion)
      .innerJoin(schema.MediaAsset, eq(schema.MediaAsset.id, schema.MediaAssetVersion.assetId))
      .where(
        and(
          isNotNull(schema.MediaAssetVersion.derivedFromVersionId),
          isNull(schema.MediaAssetVersion.deletedAt),
          organizationId ? eq(schema.MediaAsset.organizationId, organizationId) : sql`1=1`,
          or(eq(schema.MediaAsset.kind, 'THUMBNAIL'), eq(schema.MediaAsset.purpose, 'DERIVED'))
        )
      )

    const totalStorageSize = storageStatsResult[0]?.totalSize || 0

    return {
      orphaned: orphanedCount,
      failed: failedCount,
      expired: expiredCount,
      totalThumbnails,
      totalStorageSize: totalStorageSize,
    }
  } catch (error) {
    logger.error('Failed to get thumbnail cleanup stats', {
      error: error instanceof Error ? error.message : String(error),
      organizationId,
    })
    throw error
  }
}
