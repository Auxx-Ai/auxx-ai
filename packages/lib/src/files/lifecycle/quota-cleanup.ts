// packages/lib/src/files/lifecycle/quota-cleanup.ts

/**
 * How many bytes an organization is storing, and what its plan allows.
 *
 * The daily job that acts on the answer lives in
 * `jobs/maintenance/file-cleanup-jobs.ts`; this file is the measurement, and it
 * takes its database on a {@link FilesCtx} like every other read under
 * `files/`. It kept its path because `@auxx/lib/files/lifecycle/quota-cleanup`
 * is a published package subpath that `apps/web`'s upload gate and admin router
 * both import.
 *
 * `quotaEnforcementCleanupJob` used to live here. It was exported, never
 * scheduled and never enqueued — `storageQuotaCheckJob`'s enforcement branch is
 * still a `TODO` that increments a counter — and it only considered `FolderFile`
 * candidates, which is the lane essentially none of the usage is in. Deleted per
 * `plans/attachments/07-dead-code-removal.md` §7.4 ("schedule or delete"). If
 * enforcement is built, it needs the `MediaAsset` lane, which means writing it
 * against the sums below rather than resurrecting that body.
 */

import { schema } from '@auxx/database'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { FeaturePermissionService } from '../../permissions/feature-permission-service'
import { FeatureKey } from '../../permissions/types'
import type { FilesCtx } from '../ctx'

const BYTES_PER_GB = 1024 * 1024 * 1024

/**
 * Sentinel for "no cap", shared with `OrganizationAiQuota.quotaLimit` and the
 * seeded plan rows. Kept out of the arithmetic everywhere it appears.
 */
export const UNLIMITED = -1

/** Storage quota information for one organization. */
export interface StorageQuota {
  organizationId: string
  /** Total storage used in bytes. */
  totalUsed: number
  /** Storage quota limit in bytes, or {@link UNLIMITED}. */
  quotaLimit: number
  /** Percentage of quota used. `0` for an uncapped organization. */
  percentUsed: number
  /** Number of distinct stored objects. */
  fileCount: number
}

/**
 * The org's real storage limit in bytes, resolved from its plan.
 *
 * `featureLimits` is a JSONB **array** of `{ key, limit }` entries, so it can
 * only be read through the features cache — a `->>'storageGbHard'` returns null.
 * `FeaturePermissionService.getLimit` is that reader, and it is the same one
 * `apps/web`'s upload gate uses, which is what keeps the gate and the daily job
 * from disagreeing about whether an org is over.
 *
 * Every non-numeric answer means **uncapped**, not zero:
 * - `null` — the plan does not name this key, or names it as `false`/`0`. A plan
 *   silent about storage is unlimited; reading it as a 0-byte cap would put every
 *   such org instantly over quota.
 * - `'+'` / `true` — the explicit unlimited markers. The features provider has
 *   already folded a seeded `-1` (Enterprise) into `'+'`.
 */
export async function resolveStorageLimitBytes(
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
async function sumFolderFileUsage(ctx: FilesCtx): Promise<LaneUsage> {
  const locations = ctx.db
    .select({
      locationId: schema.FileVersion.storageLocationId,
      size: sql<number>`max(${schema.FileVersion.size})`.as('size'),
    })
    .from(schema.FileVersion)
    .innerJoin(schema.FolderFile, eq(schema.FileVersion.fileId, schema.FolderFile.id))
    .where(
      and(
        eq(schema.FolderFile.organizationId, ctx.organizationId),
        isNull(schema.FolderFile.deletedAt)
      )
    )
    .groupBy(schema.FileVersion.storageLocationId)
    .as('folder_file_locations')

  const [row] = await ctx.db
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
async function sumMediaAssetUsage(ctx: FilesCtx): Promise<LaneUsage> {
  const locations = ctx.db
    .select({
      locationId: schema.MediaAssetVersion.storageLocationId,
      size: sql<number>`max(${schema.MediaAssetVersion.size})`.as('size'),
    })
    .from(schema.MediaAssetVersion)
    .innerJoin(schema.MediaAsset, eq(schema.MediaAssetVersion.assetId, schema.MediaAsset.id))
    .where(
      and(
        eq(schema.MediaAsset.organizationId, ctx.organizationId),
        isNull(schema.MediaAsset.deletedAt),
        isNull(schema.MediaAssetVersion.deletedAt),
        isNotNull(schema.MediaAssetVersion.storageLocationId)
      )
    )
    .groupBy(schema.MediaAssetVersion.storageLocationId)
    .as('media_asset_locations')

  const [row] = await ctx.db
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
 * @param ctx Scope and database. The organization measured is `ctx.organizationId`.
 */
export async function calculateStorageUsage(ctx: FilesCtx): Promise<StorageQuota> {
  const [folderFiles, mediaAssets, quotaLimit] = await Promise.all([
    sumFolderFileUsage(ctx),
    sumMediaAssetUsage(ctx),
    resolveStorageLimitBytes(ctx.organizationId, FeatureKey.storageGbHard),
  ])

  const totalUsed = folderFiles.totalSize + mediaAssets.totalSize
  const fileCount = folderFiles.count + mediaAssets.count

  return {
    organizationId: ctx.organizationId,
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
 * Growth 40, Demo 0.08) and, until recently, read by nothing — orgs went from no
 * signal at all straight to a hard 403 at the upload gate. This wires it in as
 * the warn threshold.
 *
 * A plan that names no soft limit falls back to 80% of its hard limit, which is
 * the heuristic the daily job used before. `null` means there is nothing to warn
 * about: an uncapped plan cannot approach a cap.
 */
export async function resolveWarnThresholdBytes(
  organizationId: string,
  hardLimitBytes: number
): Promise<number | null> {
  const softLimitBytes = await resolveStorageLimitBytes(organizationId, FeatureKey.storageGbSoft)
  if (softLimitBytes !== UNLIMITED) return softLimitBytes
  if (hardLimitBytes === UNLIMITED) return null
  return Math.round(hardLimitBytes * 0.8)
}
