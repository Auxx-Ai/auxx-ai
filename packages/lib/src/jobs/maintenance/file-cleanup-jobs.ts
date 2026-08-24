// packages/lib/src/jobs/maintenance/file-cleanup-jobs.ts

/**
 * The three scheduled file-lifecycle jobs, and the only place they touch the
 * process-wide pool.
 *
 * They used to live in `files/lifecycle/orphaned-cleanup.ts` and
 * `files/lifecycle/quota-cleanup.ts`, each with its own
 * `import { database as db } from '@auxx/database'` at module scope — the last
 * such imports anywhere under `files/`. `jobs/maintenance/` is where every other
 * cron handler already binds the pool (`thumbnail-cleanup-job.ts`,
 * `media-asset-cleanup-job.ts`), so the sweeps moved here and `files/lifecycle/`
 * is now database-agnostic: it takes a `Database` and a storage seam as
 * parameters, and its tests need no `vi.mock`.
 *
 * ## `StorageManager` is the storage seam, injected
 *
 * `FileReaperStorage` is a two-method interface rather than the `StoragePort`
 * every other `files/` function takes, because a `FolderFile` is addressed by
 * its `StorageLocation` id: turning that into a bucket + key means reading the
 * row, resolving the adapter and its auth, and removing the location record
 * afterwards. `StorageManager.deleteFile` already does exactly that — including
 * refusing to invent a bucket, which is what #1816/#1817/#1818 were about — so
 * it is wrapped here rather than reimplemented in the reaper.
 */

import { database as db, schema } from '@auxx/database'
import type { ProviderId } from '../../files/adapters/base-adapter'
import type { FileReaperDeps, ReapResult } from '../../files/lifecycle/file-reaper'
import {
  reapExpiredFolderFiles,
  reapMarkedStorageLocations,
  reapSoftDeletedFolderFiles,
} from '../../files/lifecycle/file-reaper'
import {
  calculateStorageUsage,
  resolveWarnThresholdBytes,
  UNLIMITED,
} from '../../files/lifecycle/quota-cleanup'
import { StorageManager } from '../../files/storage/storage-manager'
import { createScopedLogger } from '../../logger'
import type { JobContext } from '../types'

const logger = createScopedLogger('file-cleanup-jobs')

/** Data both `FolderFile` sweeps accept. */
export interface FileCleanupJobData {
  /** Rows to consider in one run. */
  batchSize?: number
  /** Report what would go without touching storage or the database. */
  dryRun?: boolean
  /** Restrict the run to one organization. Absent sweeps every organization. */
  organizationId?: string
}

/** What a sweep reports back to BullMQ. */
export interface FileCleanupJobResult {
  scanned: number
  deleted: number
  errors: number
  storageFreed: number
}

function toJobResult(result: ReapResult): FileCleanupJobResult {
  return {
    scanned: result.scanned,
    deleted: result.deleted,
    errors: result.failed,
    storageFreed: result.storageFreed,
  }
}

/**
 * Bind `StorageManager` into the shape the reapers ask for.
 *
 * A manager is constructed per call with the row's **own** organization, not a
 * job-wide one: these sweeps are cross-organization, and the organization is
 * what resolves customer credentials.
 */
function reaperDeps(): FileReaperDeps {
  return {
    now: () => new Date(),
    storage: {
      async deleteLocation({ organizationId, locationId }) {
        await new StorageManager(organizationId).deleteFile(locationId)
      },
      async deleteObject({ organizationId, provider, key, bucket }) {
        await new StorageManager(organizationId).deleteByKey({
          provider: provider as ProviderId,
          key,
          bucket,
        })
      },
    },
  }
}

/**
 * Hourly: hard-delete files that were uploaded but never attached to anything.
 *
 * Unattached and older than 24 hours, `LIMIT batchSize`. The old body scanned
 * every `FolderFile` older than 24 hours **with all of its attachments** loaded
 * and filtered in JavaScript; the anti-join and the limit are now in SQL.
 */
export async function orphanedFileCleanupJob(
  ctx: JobContext<FileCleanupJobData>
): Promise<FileCleanupJobResult> {
  const { batchSize = 100, dryRun = false, organizationId } = ctx.job.data

  logger.info('Starting orphaned file cleanup', { batchSize, dryRun, organizationId })

  const swept = await reapExpiredFolderFiles(db, reaperDeps(), {
    batchSize,
    dryRun,
    organizationId,
  })
  if (swept.isErr()) throw swept.error

  const result = toJobResult(swept.value)
  logger.info('Orphaned file cleanup completed', { ...result, dryRun, organizationId })
  return result
}

/**
 * Daily: hard-delete files soft-deleted more than 30 days ago, then sweep
 * `StorageLocation` rows that were marked for deletion and missed.
 *
 * **This now deletes rows it never used to.** The old body handed the ids of
 * `deletedAt < now - 30d` rows to a helper whose own query re-filtered on
 * `deletedAt IS NULL`, so the intersection was empty by construction and phase 1
 * had never removed a single file — while still reporting every scanned row as
 * `status: 'deleted'`. See `files/lifecycle/file-reaper.ts`.
 */
export async function deletedFileCleanupJob(
  ctx: JobContext<FileCleanupJobData>
): Promise<FileCleanupJobResult & { storageLocationsSwept: number }> {
  const { batchSize = 100, dryRun = false, organizationId } = ctx.job.data
  const deps = reaperDeps()

  logger.info('Starting soft-deleted file cleanup', { batchSize, dryRun, organizationId })

  const files = await reapSoftDeletedFolderFiles(db, deps, { batchSize, dryRun, organizationId })
  if (files.isErr()) throw files.error

  await ctx.job.updateProgress(50)

  // Safety net behind `storageCleanupJob`, which handles the immediate case.
  const locations = await reapMarkedStorageLocations(db, deps, {
    batchSize,
    dryRun,
    organizationId,
  })
  if (locations.isErr()) throw locations.error

  await ctx.job.updateProgress(100)

  const result = {
    ...toJobResult(files.value),
    errors: files.value.failed + locations.value.failed,
    storageLocationsSwept: locations.value.deleted,
  }

  logger.info('Soft-deleted file cleanup completed', { ...result, dryRun, organizationId })
  return result
}

/**
 * Daily: measure every organization against its plan's storage limits.
 *
 * Read-only. The enforcement branch is still a `TODO` that increments a counter
 * — `quotaEnforcementCleanupJob`, the body it would have called, was deleted in
 * plan 7c because it was never scheduled and only measured the `FolderFile`
 * lane, which is where essentially none of the usage is.
 */
export async function storageQuotaCheckJob(
  ctx: JobContext<{ dryRun?: boolean }>
): Promise<{ checked: number; warnings: number; enforced: number }> {
  const { dryRun = false } = ctx.job.data
  const result = { checked: 0, warnings: 0, enforced: 0 }

  logger.info('Starting storage quota check', { dryRun })

  const organizations = await db
    .select({ id: schema.Organization.id, name: schema.Organization.name })
    .from(schema.Organization)

  for (const org of organizations) {
    result.checked++

    const usage = await calculateStorageUsage({ db, organizationId: org.id })
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

    await ctx.job.updateProgress(Math.floor((result.checked / organizations.length) * 100))
  }

  logger.info('Storage quota check completed', result)
  return result
}
