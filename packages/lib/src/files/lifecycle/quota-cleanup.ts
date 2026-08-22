// packages/lib/src/files/lifecycle/quota-cleanup.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, asc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { JobContext } from '../../jobs/types'
import type { StorageQuota } from './types'

const logger = createScopedLogger('quota-cleanup')

// Default storage quotas by organization type (in bytes)
const DEFAULT_QUOTAS = {
  free: 1 * 1024 * 1024 * 1024, // 1 GB
  starter: 10 * 1024 * 1024 * 1024, // 10 GB
  professional: 50 * 1024 * 1024 * 1024, // 50 GB
  enterprise: 500 * 1024 * 1024 * 1024, // 500 GB
}

/** Aggregate of stored bytes and stored objects for one storage lane. */
type LaneUsage = { totalSize: number; count: number }

/** `sum()`/`count()` over bigint come back from node-postgres as strings. */
function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Bytes and object count for files living in folders (`FolderFile` → `FileVersion`).
 *
 * Deduplicated by `storageLocationId`: two version rows pointing at the same
 * `StorageLocation` are one object in the bucket. Nothing in the current write
 * path shares a location between versions, but neither table constrains it, so
 * the grouping makes the invariant structural rather than assumed.
 */
async function sumFolderFileUsage(organizationId: string): Promise<LaneUsage> {
  const locations = db
    .select({
      locationId: schema.FileVersion.storageLocationId,
      size: sql<number>`max(${schema.FileVersion.size})`.as('size'),
    })
    .from(schema.FileVersion)
    .innerJoin(schema.FolderFile, eq(schema.FileVersion.fileId, schema.FolderFile.id))
    .where(
      and(eq(schema.FolderFile.organizationId, organizationId), isNull(schema.FolderFile.deletedAt))
    )
    .groupBy(schema.FileVersion.storageLocationId)
    .as('folder_file_locations')

  const [row] = await db
    .select({
      totalSize: sql<string>`coalesce(sum(${locations.size}), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(locations)

  return { totalSize: toNumber(row?.totalSize), count: toNumber(row?.count) }
}

/**
 * Bytes and object count for media assets (`MediaAsset` → `MediaAssetVersion`).
 *
 * This is where essentially all real usage lives: avatars, mail attachments,
 * comment attachments, custom-field files, KB logos and dataset documents are
 * all `MediaAsset` rows.
 *
 * Derived thumbnails are counted deliberately. They are separate
 * `MediaAssetVersion` rows (linked by `derivedFromVersionId`/`preset`) holding
 * real objects in the bucket that we really pay for, so excluding them would
 * under-report the quota. Same `storageLocationId` grouping as above, which is
 * what keeps a thumbnail and its source from ever being counted twice.
 */
async function sumMediaAssetUsage(organizationId: string): Promise<LaneUsage> {
  const locations = db
    .select({
      locationId: schema.MediaAssetVersion.storageLocationId,
      size: sql<number>`max(${schema.MediaAssetVersion.size})`.as('size'),
    })
    .from(schema.MediaAssetVersion)
    .innerJoin(schema.MediaAsset, eq(schema.MediaAssetVersion.assetId, schema.MediaAsset.id))
    .where(
      and(
        eq(schema.MediaAsset.organizationId, organizationId),
        isNull(schema.MediaAsset.deletedAt),
        isNull(schema.MediaAssetVersion.deletedAt),
        isNotNull(schema.MediaAssetVersion.storageLocationId)
      )
    )
    .groupBy(schema.MediaAssetVersion.storageLocationId)
    .as('media_asset_locations')

  const [row] = await db
    .select({
      totalSize: sql<string>`coalesce(sum(${locations.size}), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(locations)

  return { totalSize: toNumber(row?.totalSize), count: toNumber(row?.count) }
}

/**
 * Calculate storage usage for an organization.
 *
 * Sums both storage lanes — `FolderFile`/`FileVersion` and
 * `MediaAsset`/`MediaAssetVersion` — restricted to rows whose owning record is
 * not soft-deleted. Derived thumbnails count; they are real stored bytes.
 *
 * `fileCount` is the number of **distinct stored objects** (`StorageLocation`
 * rows referenced by a live version), not the number of user-visible files: a
 * file with N versions plus M generated thumbnails occupies N + M objects.
 * That is the figure that lines up with `totalUsed`.
 *
 * @param organizationId Organization to measure.
 */
export async function calculateStorageUsage(organizationId: string): Promise<StorageQuota> {
  const [folderFiles, mediaAssets] = await Promise.all([
    sumFolderFileUsage(organizationId),
    sumMediaAssetUsage(organizationId),
  ])

  const totalUsed = folderFiles.totalSize + mediaAssets.totalSize
  const fileCount = folderFiles.count + mediaAssets.count

  // Get organization's quota limit (would need to be added to Organization model)
  // For now, using a default
  const quotaLimit = DEFAULT_QUOTAS.professional

  return {
    organizationId,
    totalUsed,
    quotaLimit,
    percentUsed: Math.round((totalUsed / quotaLimit) * 100),
    fileCount,
  }
}

/**
 * Job to check and enforce storage quotas
 * Runs daily to notify organizations approaching their limits
 */
export async function storageQuotaCheckJob(
  ctx: JobContext<{ dryRun?: boolean }>
): Promise<{ checked: number; warnings: number; enforced: number }> {
  const job = ctx.job
  const { dryRun = false } = job.data
  const result = {
    checked: 0,
    warnings: 0,
    enforced: 0,
  }

  try {
    logger.info('Starting storage quota check')

    // Get all organizations
    const organizations = await db
      .select({
        id: schema.Organization.id,
        name: schema.Organization.name,
        // Add plan/tier field when available
      })
      .from(schema.Organization)

    for (const org of organizations) {
      result.checked++

      const usage = await calculateStorageUsage(org.id)

      // Check if over quota
      if (usage.percentUsed >= 100) {
        logger.warn('Organization over storage quota', {
          organizationId: org.id,
          name: org.name,
          percentUsed: usage.percentUsed,
          totalUsed: usage.totalUsed,
          quotaLimit: usage.quotaLimit,
        })

        if (!dryRun) {
          // TODO: Implement quota enforcement
          // - Prevent new uploads
          // - Send notification email
          // - Create system notification
          result.enforced++
        }
      } else if (usage.percentUsed >= 80) {
        // Warning threshold at 80%
        logger.info('Organization approaching storage quota', {
          organizationId: org.id,
          name: org.name,
          percentUsed: usage.percentUsed,
        })

        if (!dryRun) {
          // TODO: Send warning notification
          result.warnings++
        }
      }

      // Update job progress
      await job.updateProgress(Math.floor((result.checked / organizations.length) * 100))
    }

    logger.info('Storage quota check completed', result)
    return result
  } catch (error) {
    logger.error('Storage quota check failed', { error })
    throw error
  }
}

/**
 * Clean up files for organizations over quota
 * Prioritizes old, large, or unused files
 */
export async function quotaEnforcementCleanupJob(
  job: Job<{ organizationId: string; targetSize: number; dryRun?: boolean }>
): Promise<{ deleted: number; freedBytes: number }> {
  const { organizationId, targetSize, dryRun = false } = job.data
  const result = {
    deleted: 0,
    freedBytes: 0,
  }

  try {
    logger.info('Starting quota enforcement cleanup', { organizationId, targetSize })

    // Find candidates for deletion (old, orphaned files first)
    const candidates = await db
      .select({
        id: schema.FolderFile.id,
        name: schema.FolderFile.name,
        size: schema.FolderFile.size,
        createdAt: schema.FolderFile.createdAt,
        currentVersionId: schema.FileVersion.id,
        currentVersionSize: schema.FileVersion.size,
        storageLocationId: schema.StorageLocation.id,
      })
      .from(schema.FolderFile)
      .leftJoin(schema.FileVersion, eq(schema.FolderFile.currentVersionId, schema.FileVersion.id))
      .leftJoin(
        schema.StorageLocation,
        and(
          eq(schema.FileVersion.storageLocationId, schema.StorageLocation.id),
          isNull(schema.StorageLocation.deletedAt)
        )
      )
      .leftJoin(schema.Attachment, eq(schema.FolderFile.id, schema.Attachment.fileId))
      .where(
        and(
          eq(schema.FolderFile.organizationId, organizationId),
          isNull(schema.Attachment.id), // No attachment (orphaned)
          lt(schema.FolderFile.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        )
      )
      .orderBy(asc(schema.FolderFile.createdAt))

    // Delete files until we reach the target size
    for (const file of candidates) {
      if (result.freedBytes >= targetSize) {
        break
      }

      if (!dryRun) {
        try {
          // Soft delete the file
          await db
            .update(schema.FolderFile)
            .set({
              deletedAt: new Date(),
            })
            .where(eq(schema.FolderFile.id, file.id))

          result.deleted++
          result.freedBytes += file.currentVersionSize ?? 0

          logger.info('Deleted file for quota enforcement', {
            fileId: file.id,
            name: file.name,
            size: file.size,
          })
        } catch (error) {
          logger.error('Failed to delete file for quota enforcement', {
            fileId: file.id,
            error,
          })
        }
      } else {
        // Dry run - just count
        result.deleted++
        result.freedBytes += file.currentVersionSize ?? 0
      }
    }

    logger.info('Quota enforcement cleanup completed', result)
    return result
  } catch (error) {
    logger.error('Quota enforcement cleanup failed', { error })
    throw error
  }
}
