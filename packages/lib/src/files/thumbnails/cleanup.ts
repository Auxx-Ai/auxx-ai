// packages/lib/src/files/thumbnails/cleanup.ts

/**
 * The four scheduled thumbnail sweeps, plus the deletion routine they share
 * with `thumbnail-mutations.ts`.
 *
 * ## These take a bare `db`, not a `FilesCtx`, and that is deliberate
 *
 * Every other db-touching function under `files/` takes `ctx: FilesCtx` because
 * it operates *within* one organization. These do not: `thumbnailCleanupJob` is
 * scheduled once, cron, with no organization at all, and sweeps the whole
 * database. The legacy code expressed that by constructing
 * `new ThumbnailService('system', 'system', db)` — a fabricated org id that was
 * then never used, because all four methods accepted an `organizationId` option
 * and **three of the four destructured it and ignored it**. A `FilesCtx` here
 * would be the same lie with better types.
 *
 * So the organization is what it actually is: an optional *filter*, in
 * `options`, applied for real. A per-org invocation now sweeps one org; the
 * nightly global invocation is unchanged.
 *
 * ## Nothing here opens a transaction
 *
 * The legacy `processDeletions` ran `dbClient.transaction(...)` per item. That is
 * fine on a pool and wrong when the client is already a transaction — in
 * drizzle-orm 0.44 the nested call issues a `SAVEPOINT`, which is how an avatar
 * delete ended up doing `BEGIN → SAVEPOINT → SAVEPOINT → RELEASE → RELEASE →
 * COMMIT` for work nothing rolls back partially. `deleteThumbnailsForSource`
 * calls straight into {@link processThumbnailDeletions} from inside the asset
 * delete's transaction, so the routine runs its statements on whatever client it
 * was handed and opens nothing. A partially applied item leaves a soft-deleted
 * version whose asset still looks live; the next run of the same sweep finishes
 * it.
 *
 * ## Object first, rows second
 *
 * The legacy routine collected every storage key and deleted the objects **after**
 * all database work, in one batch whose failures were logged and dropped. A
 * failure there left rows marked deleted and objects nothing pointed at any
 * more — an unrecoverable leak, because the row was the only record of the key.
 * Here each object is removed before its rows, so a storage failure leaves the
 * row intact for the next sweep and nothing leaks.
 */

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { StorageLocationEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, count, desc, eq, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { ProviderId } from '../adapters/base-adapter'
import type { FilesDeps } from '../ctx'
import { bucketForVisibility } from '../storage/buckets'
import { guard } from './guard'
import type { ThumbnailWithLocation } from './thumbnail-queries'

const logger = createScopedLogger('files:thumbnails')

/** Storage and clock — everything a sweep is allowed to reach beyond the database. */
export type ThumbnailCleanupDeps = Pick<FilesDeps, 'storage' | 'now'>

/** What one sweep did. `details` is populated only for a dry run. */
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

/** Knobs shared by every sweep. */
export interface ThumbnailCleanupOptions {
  /** Rows to consider in one run. */
  batchSize?: number
  /** Report what would go without touching anything. */
  dryRun?: boolean
  /** Restrict the sweep to one organization. Absent means every organization. */
  organizationId?: string
}

function emptyResult(): CleanupResult {
  return { deleted: 0, failed: 0, errors: [], storageFreed: 0, details: [] }
}

/**
 * Sweep thumbnails whose source version is gone.
 *
 * The source is `MediaAssetVersion.derivedFromVersionId`, and "gone" means
 * soft-deleted or absent — an orphan whose bytes nobody can reach any more.
 *
 * **One statement, not 1 + N.** The legacy version ran a raw
 * `sql<Array<…>>` template for the ids and then re-read every row individually
 * through `Promise.all(orphaned.map(findFirst))`, so a `batchSize` of 500 meant
 * 501 round-trips. The join below returns the same columns in one.
 *
 * @param db Pool. These sweeps are cross-organization by default.
 * @param deps Storage and clock.
 * @param options `maxDeletesPerRun` caps `batchSize` as a second safety net.
 */
export async function cleanupOrphanedThumbnails(
  db: Database,
  deps: ThumbnailCleanupDeps,
  options: ThumbnailCleanupOptions & { maxDeletesPerRun?: number } = {}
): Promise<Result<CleanupResult, AuxxError>> {
  const { batchSize = 100, maxDeletesPerRun = 5000, dryRun = false, organizationId } = options

  return guard(
    async () => {
      const rows = await selectThumbnailRows(
        db,
        and(
          isNotNull(schema.MediaAssetVersion.derivedFromVersionId),
          isNull(schema.MediaAssetVersion.deletedAt),
          // The table name is a string literal on purpose: a Drizzle table
          // reference interpolated into `sql` binds as a *parameter*, not as a
          // relation, so `FROM ${schema.MediaAssetVersion}` silently produces
          // nonsense. Column references interpolate correctly and are used.
          sql`NOT EXISTS (
            SELECT 1 FROM "MediaAssetVersion" src
            WHERE src.id = ${schema.MediaAssetVersion.derivedFromVersionId}
              AND src."deletedAt" IS NULL
          )`,
          orgFilter(organizationId)
        ),
        Math.min(batchSize, maxDeletesPerRun)
      )

      return processThumbnailDeletions(db, deps, rows, { dryRun, permanent: false })
    },
    'Failed to sweep orphaned thumbnails',
    { organizationId, batchSize, dryRun }
  )
}

/**
 * Sweep thumbnails derived from an asset's older versions.
 *
 * Keeps the newest `keepVersions` versions of the asset and drops the thumbnails
 * of everything behind them. The asset's *own* old versions are untouched — only
 * their derivatives.
 *
 * @param db Pool.
 * @param deps Storage and clock.
 * @param assetId The asset whose version history to trim derivatives from.
 * @param options `keepVersions` defaults to 3.
 */
export async function cleanupOutdatedVersionThumbnails(
  db: Database,
  deps: ThumbnailCleanupDeps,
  assetId: string,
  options: ThumbnailCleanupOptions & { keepVersions?: number } = {}
): Promise<Result<CleanupResult, AuxxError>> {
  const { keepVersions = 3, batchSize = 100, dryRun = false, organizationId } = options

  return guard(
    async () => {
      const versions = await db
        .select({ id: schema.MediaAssetVersion.id })
        .from(schema.MediaAssetVersion)
        .where(
          and(
            eq(schema.MediaAssetVersion.assetId, assetId),
            isNull(schema.MediaAssetVersion.deletedAt)
          )
        )
        .orderBy(desc(schema.MediaAssetVersion.createdAt))

      if (versions.length <= keepVersions) return emptyResult()

      const outdated = versions.slice(keepVersions).map((version) => version.id)

      const rows = await selectThumbnailRows(
        db,
        and(
          // `inArray` is avoided: `ANY(array)` binds as one parameter and matches
          // nothing under this repo's driver configuration.
          or(...outdated.map((id) => eq(schema.MediaAssetVersion.derivedFromVersionId, id))) as SQL,
          isNull(schema.MediaAssetVersion.deletedAt),
          orgFilter(organizationId)
        ),
        batchSize
      )

      return processThumbnailDeletions(db, deps, rows, { dryRun, permanent: false })
    },
    'Failed to sweep outdated version thumbnails',
    { assetId, keepVersions, organizationId, dryRun }
  )
}

/**
 * Sweep failed and stranded thumbnail attempts, permanently.
 *
 * `FAILED` rows and `PROCESSING` rows older than `maxAgeHours` are both dead
 * ends: nothing retries them, and while a `PROCESSING` placeholder sits there it
 * occupies the `(derivedFromVersionId, preset)` unique slot. Since PR 5f
 * `ensureThumbnail` re-enqueues past a placeholder rather than reporting it as
 * `ready`, so this sweep is no longer the only recovery — but the row still has
 * to go.
 *
 * Hard delete, matching the legacy behaviour: there is nothing in a failed
 * attempt worth retaining for thirty days.
 */
export async function cleanupFailedThumbnails(
  db: Database,
  deps: ThumbnailCleanupDeps,
  options: ThumbnailCleanupOptions & { maxAgeHours?: number } = {}
): Promise<Result<CleanupResult, AuxxError>> {
  const { maxAgeHours = 24, batchSize = 100, dryRun = false, organizationId } = options

  return guard(
    async () => {
      const threshold = new Date(deps.now().getTime() - maxAgeHours * 60 * 60 * 1000)

      const rows = await selectThumbnailRows(
        db,
        and(
          isNotNull(schema.MediaAssetVersion.derivedFromVersionId),
          isNull(schema.MediaAssetVersion.deletedAt),
          or(
            eq(schema.MediaAssetVersion.status, 'FAILED'),
            and(
              eq(schema.MediaAssetVersion.status, 'PROCESSING'),
              lt(schema.MediaAssetVersion.createdAt, threshold)
            )
          ),
          orgFilter(organizationId)
        ),
        batchSize
      )

      return processThumbnailDeletions(db, deps, rows, { dryRun, permanent: true })
    },
    'Failed to sweep failed thumbnails',
    { organizationId, maxAgeHours, dryRun }
  )
}

/**
 * Hard-delete soft-deleted thumbnails past their retention window.
 *
 * The only sweep that deliberately looks at rows where `deletedAt IS NOT NULL` —
 * it is the second half of every soft delete the other paths perform.
 */
export async function cleanupExpiredSoftDeletes(
  db: Database,
  deps: ThumbnailCleanupDeps,
  options: ThumbnailCleanupOptions & { retentionDays?: number } = {}
): Promise<Result<CleanupResult, AuxxError>> {
  const { retentionDays = 30, batchSize = 100, dryRun = false, organizationId } = options

  return guard(
    async () => {
      const threshold = new Date(deps.now().getTime() - retentionDays * 24 * 60 * 60 * 1000)

      const rows = await selectThumbnailRows(
        db,
        and(
          isNotNull(schema.MediaAssetVersion.derivedFromVersionId),
          lt(schema.MediaAssetVersion.deletedAt, threshold),
          orgFilter(organizationId)
        ),
        batchSize
      )

      return processThumbnailDeletions(db, deps, rows, { dryRun, permanent: true })
    },
    'Failed to sweep expired soft-deleted thumbnails',
    { organizationId, retentionDays, dryRun }
  )
}

/**
 * Remove a batch of thumbnails: object first, then rows.
 *
 * Shared by the four sweeps above and by
 * `thumbnail-mutations.ts`'s `deleteThumbnailsForSource`, which used to be a
 * fifth, subtly different copy of this loop.
 *
 * The `kind`/`purpose` guard is kept even though every caller's query already
 * filters on it — this is the routine that issues the `DELETE`, and "a caller
 * checked" is not a property it can see. A row that fails the guard is skipped
 * and counted as failed, never deleted.
 *
 * Throws only for a programming error; per-item failures are collected into
 * {@link CleanupResult.errors} so one bad row cannot abort a nightly sweep.
 *
 * @param db The client to run on. May be a transaction — this opens none.
 * @param deps Storage and clock.
 * @param items Rows to remove, as produced by the sweeps or `loadThumbnailsForSource`.
 * @param options `permanent` hard-deletes; otherwise the rows are soft-deleted.
 */
export async function processThumbnailDeletions(
  db: Database | Transaction,
  deps: ThumbnailCleanupDeps,
  items: readonly ThumbnailWithLocation[],
  options: { dryRun?: boolean; permanent?: boolean } = {}
): Promise<CleanupResult> {
  const result = emptyResult()

  for (const item of items) {
    const sizeBytes = item.size ? Number(item.size) : 0

    if (options.dryRun) {
      result.details?.push({
        assetId: item.assetId,
        versionId: item.versionId,
        bytes: sizeBytes,
        preset: item.preset ?? 'unknown',
      })
      result.deleted++
      result.storageFreed += sizeBytes
      continue
    }

    try {
      await deleteThumbnailObject(deps, item)
      await deleteThumbnailRows(db, deps, item, options.permanent === true)
      result.deleted++
      result.storageFreed += sizeBytes
    } catch (error) {
      result.failed++
      result.errors.push(error as Error)
      logger.error('Failed to delete thumbnail', {
        versionId: item.versionId,
        assetId: item.assetId,
        permanent: options.permanent === true,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

/**
 * Which bucket a thumbnail's object actually lives in.
 *
 * `metadata.bucket` is authoritative and is what every row written since PR 3d
 * carries. For older rows there is exactly one safe recovery, and it is not a
 * configured default: a thumbnail on **platform** storage (`credentialId IS
 * NULL`) was routed to one of the two platform buckets by its own visibility, so
 * re-deriving it from `MediaAsset.isPrivate` reproduces the same decision rather
 * than guessing. A row on a customer credential cannot be recovered that way and
 * is refused.
 *
 * Refusing matters because S3 answers `204 No Content` for a delete of a key
 * that is not in the bucket you named (#1816/#1817/#1818): a wrong-bucket delete
 * is indistinguishable from a successful one, and the row would then be marked
 * deleted while the object lived on forever.
 *
 * @throws {AuxxError} when no bucket can be established.
 */
export function resolveThumbnailBucket(item: ThumbnailWithLocation): string {
  const recorded = (item.locationMetadata as { bucket?: unknown } | null)?.bucket
  if (typeof recorded === 'string' && recorded.length > 0) return recorded

  if (item.locationCredentialId) {
    throw new StorageBucketUnknownError(
      `StorageLocation ${item.locationId} has no metadata.bucket and uses credential ` +
        `${item.locationCredentialId}; refusing to guess a bucket for a delete`
    )
  }

  const derived = bucketForVisibility(item.assetIsPrivate === false ? 'PUBLIC' : 'PRIVATE')
  if (!derived) {
    throw new StorageBucketUnknownError(
      `StorageLocation ${item.locationId} has no metadata.bucket and no platform bucket is configured`
    )
  }

  logger.warn('Thumbnail storage location has no recorded bucket; derived from asset visibility', {
    storageLocationId: item.locationId,
    assetId: item.assetId,
    bucket: derived,
  })
  return derived
}

// ============= Internal helpers =============

/** A bucket that could not be established. Named so the sweeps' logs are greppable. */
class StorageBucketUnknownError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageBucketUnknownError'
  }
}

/** Restrict a sweep to one organization, or to all of them. */
function orgFilter(organizationId?: string): SQL | undefined {
  return organizationId ? eq(schema.MediaAsset.organizationId, organizationId) : undefined
}

/**
 * The one projection every sweep reads, joined to its asset and location.
 *
 * The `kind`/`purpose` predicate is part of the base rather than each caller's
 * `where`: it is the difference between a thumbnail sweep and a routine that
 * deletes original assets, and it must not be forgettable on a new sweep.
 */
async function selectThumbnailRows(
  db: Database,
  where: SQL | undefined,
  limit: number
): Promise<ThumbnailWithLocation[]> {
  return db
    .select({
      versionId: schema.MediaAssetVersion.id,
      assetId: schema.MediaAssetVersion.assetId,
      preset: schema.MediaAssetVersion.preset,
      size: schema.MediaAssetVersion.size,
      locationId: schema.StorageLocation.id,
      locationProvider: schema.StorageLocation.provider,
      locationExternalId: schema.StorageLocation.externalId,
      locationMetadata: schema.StorageLocation.metadata,
      locationCredentialId: schema.StorageLocation.credentialId,
      assetIsPrivate: schema.MediaAsset.isPrivate,
    })
    .from(schema.MediaAssetVersion)
    .innerJoin(schema.MediaAsset, eq(schema.MediaAsset.id, schema.MediaAssetVersion.assetId))
    .leftJoin(
      schema.StorageLocation,
      eq(schema.StorageLocation.id, schema.MediaAssetVersion.storageLocationId)
    )
    .where(
      and(
        or(eq(schema.MediaAsset.kind, 'THUMBNAIL'), eq(schema.MediaAsset.purpose, 'DERIVED')),
        where
      )
    )
    .limit(limit) as Promise<ThumbnailWithLocation[]>
}

/**
 * Remove one thumbnail's storage object, if it has one.
 *
 * A version with no `StorageLocation` is a placeholder that never reached
 * `READY`; there is nothing in the bucket to remove and this is a no-op.
 */
async function deleteThumbnailObject(
  deps: ThumbnailCleanupDeps,
  item: ThumbnailWithLocation
): Promise<void> {
  if (!item.locationId || !item.locationExternalId || !item.locationProvider) return

  await deps.storage.deleteObject({
    provider: item.locationProvider as ProviderId,
    bucket: resolveThumbnailBucket(item),
    key: item.locationExternalId,
    credentialId: item.locationCredentialId ?? undefined,
  })
}

/**
 * Remove one thumbnail's rows, then its asset if nothing live is left on it.
 *
 * The asset delete is guarded twice — the caller's query filtered on
 * `kind`/`purpose` and this re-reads it — because this is the statement that
 * could remove an original.
 */
async function deleteThumbnailRows(
  db: Database | Transaction,
  deps: ThumbnailCleanupDeps,
  item: ThumbnailWithLocation,
  permanent: boolean
): Promise<void> {
  if (permanent) {
    await db.delete(schema.MediaAssetVersion).where(eq(schema.MediaAssetVersion.id, item.versionId))
  } else {
    await db
      .update(schema.MediaAssetVersion)
      .set({ deletedAt: deps.now() })
      .where(eq(schema.MediaAssetVersion.id, item.versionId))
  }

  const [remaining] = await db
    .select({ live: count() })
    .from(schema.MediaAssetVersion)
    .where(
      and(
        eq(schema.MediaAssetVersion.assetId, item.assetId),
        isNull(schema.MediaAssetVersion.deletedAt)
      )
    )

  if ((remaining?.live ?? 0) > 0) return

  const assetIsDerived = and(
    eq(schema.MediaAsset.id, item.assetId),
    or(eq(schema.MediaAsset.kind, 'THUMBNAIL'), eq(schema.MediaAsset.purpose, 'DERIVED'))
  )

  if (permanent) {
    await db.delete(schema.MediaAsset).where(assetIsDerived)
  } else {
    await db.update(schema.MediaAsset).set({ deletedAt: deps.now() }).where(assetIsDerived)
  }
}

/** A location entity's `provider` column, re-exported for the sweeps' row type. */
export type ThumbnailLocationProvider = StorageLocationEntity['provider']
