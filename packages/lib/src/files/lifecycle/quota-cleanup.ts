// packages/lib/src/files/lifecycle/quota-cleanup.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, asc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { JobContext } from '../../jobs/types'
import { FeaturePermissionService } from '../../permissions/feature-permission-service'
import { FeatureKey } from '../../permissions/types'
import type { StorageQuota } from './types'

const logger = createScopedLogger('quota-cleanup')

const BYTES_PER_GB = 1024 * 1024 * 1024

/**
 * Sentinel for "no cap", shared with `OrganizationAiQuota.quotaLimit` and the
 * seeded plan rows. Kept out of the arithmetic everywhere it appears.
 */
const UNLIMITED = -1

/**
 * The org's real storage limit in bytes, resolved from its plan.
 *
 * `featureLimits` is a JSONB **array** of `{ key, limit }` entries, so it can
 * only be read through the features cache — a `->>'storageGbHard'` returns null.
 * `FeaturePermissionService.getLimit` is that reader, and it is the same one
 * `apps/web`'s upload gate uses, which is what keeps the gate and this job from
 * disagreeing about whether an org is over.
 *
 * Every non-numeric answer means **uncapped**, not zero:
 * - `null` — the plan does not name this key, or names it as `false`/`0`. A plan
 *   silent about storage is unlimited; reading it as a 0-byte cap would put every
 *   such org instantly over quota.
 * - `'+'` / `true` — the explicit unlimited markers. The features provider has
 *   already folded a seeded `-1` (Enterprise) into `'+'`.
 */
async function resolveStorageLimitBytes(
  organizationId: string,
  featureKey: FeatureKey
): Promise<number> {
  const limit = await new FeaturePermissionService().getLimit(organizationId, featureKey)

  if (typeof limit !== 'number' || limit <= 0) return UNLIMITED

  return Math.round(limit * BYTES_PER_GB)
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
 * `quotaLimit` is the org's real `storageGbHard` plan limit in bytes, or `-1`
 * when the plan is uncapped — it is NOT a fixed default. `percentUsed` is `0`
 * for an uncapped org, since there is no denominator to divide by.
 *
 * @param organizationId Organization to measure.
 */
export async function calculateStorageUsage(organizationId: string): Promise<StorageQuota> {
  const [folderFiles, mediaAssets, quotaLimit] = await Promise.all([
    sumFolderFileUsage(organizationId),
    sumMediaAssetUsage(organizationId),
    resolveStorageLimitBytes(organizationId, FeatureKey.storageGbHard),
  ])

  const totalUsed = folderFiles.totalSize + mediaAssets.totalSize
  const fileCount = folderFiles.count + mediaAssets.count

  return {
    organizationId,
    totalUsed,
    quotaLimit,
    percentUsed: quotaLimit === UNLIMITED ? 0 : Math.round((totalUsed / quotaLimit) * 100),
    fileCount,
  }
}

/**
 * Byte threshold at which an org should be warned it is approaching its cap.
 *
 * `storageGbSoft` is defined on every seeded plan (Free 0.8, Starter 8,
 * Growth 40, Demo 0.08) and, until now, read by nothing — orgs went from no
 * signal at all straight to a hard 403 at the upload gate. This wires it in as
 * the warn threshold.
 *
 * A plan that names no soft limit falls back to 80% of its hard limit, which is
 * the heuristic this job used before. `null` means there is nothing to warn
 * about: an uncapped plan cannot approach a cap.
 */
async function resolveWarnThresholdBytes(
  organizationId: string,
  hardLimitBytes: number
): Promise<number | null> {
  const softLimitBytes = await resolveStorageLimitBytes(organizationId, FeatureKey.storageGbSoft)
  if (softLimitBytes !== UNLIMITED) return softLimitBytes
  if (hardLimitBytes === UNLIMITED) return null
  return Math.round(hardLimitBytes * 0.8)
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
      const warnAt = await resolveWarnThresholdBytes(org.id, usage.quotaLimit)

      // Compared in bytes, not on `percentUsed` — that is rounded, so 99.6% of
      // the cap reads as 100 and would enforce against an org that is under.
      const overHardLimit = usage.quotaLimit !== UNLIMITED && usage.totalUsed >= usage.quotaLimit

      if (overHardLimit) {
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
      } else if (warnAt !== null && usage.totalUsed >= warnAt) {
        logger.info('Organization approaching storage quota', {
          organizationId: org.id,
          name: org.name,
          percentUsed: usage.percentUsed,
          totalUsed: usage.totalUsed,
          softLimit: warnAt,
          quotaLimit: usage.quotaLimit,
        })

        if (!dryRun) {
          // TODO: Send warning notification. Crossing the soft limit is only
          // logged today — there is still no user-facing signal between "fine"
          // and the hard 403 at the upload gate.
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
 *
 * **Not wired up, and half-blind.** Two things to know before relying on it:
 *
 * 1. It is exported but never scheduled or enqueued — `apps/worker/src/workers/index.ts`
 *    registers `orphanedFileCleanupJob`, `deletedFileCleanupJob` and
 *    `storageQuotaCheckJob`, not this. `storageQuotaCheckJob`'s enforcement
 *    branch is a `TODO` that increments a counter, so nothing calls this either.
 * 2. It only considers `FolderFile` candidates, which is where essentially none
 *    of the usage lives. `calculateStorageUsage` measures both lanes and
 *    `MediaAsset` dominates (avatars, mail/comment attachments, custom-field
 *    files, KB logos, dataset documents). Running it as written would free far
 *    less than `targetSize` and report success anyway.
 *
 * Decide before scheduling it: teach it the `MediaAsset` lane, or delete it.
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
