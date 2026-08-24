// packages/lib/src/files/lifecycle/file-reaper.ts

/**
 * The three whole-database sweeps behind the scheduled file-cleanup jobs:
 * expired unattached `FolderFile`s, `FolderFile`s past their soft-delete
 * retention, and `StorageLocation` rows marked for deletion.
 *
 * This replaces `lifecycle/cleanup-service.ts`, which was named for the wrong
 * thing (a second, stub `files/cleanup/cleanup-service.ts` sat next to it) and
 * bound the process-wide pool at module scope.
 *
 * ## These take a bare `db`, not a `FilesCtx`, and that is deliberate
 *
 * Same reasoning as `thumbnails/cleanup.ts`. Every other db-touching function
 * under `files/` takes `ctx: FilesCtx` because it operates *within* one
 * organization. These do not: the jobs that call them are cron-scheduled with no
 * organization at all and sweep the whole database. A `FilesCtx` here would be a
 * fabricated org id that nothing filters on — the same lie with better types.
 *
 * So the organization is what it actually is: an optional *filter*, in
 * `options`, **applied for real**. #1851 found three of four thumbnail sweeps
 * destructuring an `organizationId` they never put in the SQL, so a per-org
 * invocation swept every tenant. Every predicate below runs `orgFilter` and
 * every `DELETE` re-scopes to the row's own organization.
 *
 * ## What was deleted rather than converted
 *
 * `deleteEntityFiles`, `deleteOrganizationFiles`, `deleteOrphanedFiles`,
 * `cleanupFailedUpload` and `cleanupAssetThumbnails` had zero callers outside
 * the barrel that made them look used. `deleteEntityFiles` in particular had no
 * organization predicate anywhere in it — it matched `Attachment` rows by
 * `entityId`/`entityType` alone and hard-deleted across tenants. The two
 * attachment adapters (`cleanupOrphanedAttachments`,
 * `validateAttachmentIntegrity`) were `{ deleted, failed, errors }` wrappers
 * over `lifecycle/attachment-maintenance.ts`, which callers can use directly.
 *
 * ## Two bugs fixed here, both of them behaviour changes
 *
 * 1. **The soft-delete reaper never deleted anything.** `deletedFileCleanupJob`
 *    selected rows with `deletedAt < now - 30d` and handed their ids to
 *    `deleteFilesByIds`, whose own query re-filtered on `deletedAt IS NULL`.
 *    The intersection is empty by construction, so the sweep reported
 *    `deleted: N` while deleting nothing — and built its `files` array from the
 *    *scan*, stamping every entry `status: 'deleted'`. The two predicates are
 *    now in one place per sweep, so they cannot contradict each other.
 * 2. **`dryRun` deleted storage objects.** Both jobs passed
 *    `deleteFromStorage: true` unconditionally and only gated the database
 *    write. A dry run now touches nothing.
 *
 * Both sweeps are also `LIMIT`ed by `batchSize` now. The old cross-organization
 * path materialised every `FolderFile` older than 24 hours *with all of its
 * attachments* and filtered in JavaScript; the anti-join is in SQL.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { ProviderId } from '../adapters/base-adapter'
import type { FilesDeps } from '../ctx'
import { guard } from '../guard'

const logger = createScopedLogger('files:reaper')

// ============= Contracts =============

/**
 * Storage removal, as the reapers need it.
 *
 * Deliberately **not** {@link FilesDeps.storage}: a `FolderFile` is addressed by
 * its `StorageLocation` id, and turning that into a bucket + key means reading
 * the row, resolving the adapter and its auth, and deleting the location record
 * afterwards. `StorageManager` already does exactly that, so production hands
 * one in rather than this module re-deriving it — see
 * `jobs/maintenance/file-cleanup-jobs.ts`.
 *
 * A test supplies a plain object literal, which is why no `files/` test needs a
 * `vi.mock` to exercise a sweep.
 */
export interface FileReaperStorage {
  /**
   * Remove the object a `StorageLocation` addresses, and the location row.
   *
   * @param params.organizationId Owning organization, used to resolve customer
   *   credentials. Never a fabricated value — pass the row's own.
   */
  deleteLocation(params: { organizationId?: string; locationId: string }): Promise<void>

  /**
   * Remove one object addressed directly by key.
   *
   * @param params.bucket The bucket the object actually lives in, as recorded
   *   on the row. **Never invented**: S3 answers `204` for a delete of a key
   *   that is not in the bucket you named (#1816/#1817/#1818), so a guessed
   *   bucket is indistinguishable from a successful delete while the real object
   *   leaks. `undefined` reaches the adapter, which refuses loudly.
   */
  deleteObject(params: {
    organizationId?: string
    provider: ProviderId
    key: string
    bucket?: string
  }): Promise<void>
}

/** Everything a reaper is allowed to reach beyond the database. */
export interface FileReaperDeps extends Pick<FilesDeps, 'now'> {
  storage: FileReaperStorage
}

/** Knobs shared by every sweep. */
export interface ReapOptions {
  /** Rows to consider in one run. Defaults to 100. */
  batchSize?: number
  /** Report what would go without touching storage or the database. */
  dryRun?: boolean
  /** Restrict the sweep to one organization. Absent means every organization. */
  organizationId?: string
}

/** One row a sweep considered, and what happened to it. */
export interface ReapedRow {
  id: string
  name: string
  size: number
  status: 'deleted' | 'error'
  error?: string
}

/** What one sweep did. `scanned` is what the query returned, not what went. */
export interface ReapResult {
  scanned: number
  deleted: number
  failed: number
  errors: Error[]
  /** Bytes recorded on the rows that were removed. */
  storageFreed: number
  rows: ReapedRow[]
}

function emptyResult(): ReapResult {
  return { scanned: 0, deleted: 0, failed: 0, errors: [], storageFreed: 0, rows: [] }
}

// ============= Sweeps =============

/**
 * Hard-delete unattached `FolderFile`s older than `maxAgeHours`.
 *
 * "Unattached" is an anti-join against `Attachment.fileId`: a file nothing
 * points at, left behind by an upload whose entity was never saved. Soft-deleted
 * rows are excluded — those belong to
 * {@link reapSoftDeletedFolderFiles}, which has its own retention window.
 *
 * @param db Pool. This sweep is cross-organization by default.
 * @param deps Storage and clock.
 * @param options `maxAgeHours` defaults to 24.
 */
export async function reapExpiredFolderFiles(
  db: Database,
  deps: FileReaperDeps,
  options: ReapOptions & { maxAgeHours?: number } = {}
): Promise<Result<ReapResult, AuxxError>> {
  const { maxAgeHours = 24, batchSize = 100, dryRun = false, organizationId } = options

  return guard(
    async () => {
      const cutoff = new Date(deps.now().getTime() - maxAgeHours * 60 * 60 * 1000)

      const rows = await selectFolderFiles(
        db,
        and(
          isNull(schema.FolderFile.deletedAt),
          lt(schema.FolderFile.createdAt, cutoff),
          hasNoAttachment(),
          orgFilter(organizationId)
        ),
        asc(schema.FolderFile.createdAt),
        batchSize
      )

      return removeFolderFiles(db, deps, rows, dryRun)
    },
    'Failed to sweep expired files',
    { organizationId, maxAgeHours, batchSize, dryRun }
  )
}

/**
 * Hard-delete `FolderFile`s soft-deleted longer than `retentionDays` ago.
 *
 * The second half of every soft delete the rest of the module performs, and the
 * only sweep here that deliberately looks at `deletedAt IS NOT NULL`.
 *
 * @param db Pool.
 * @param deps Storage and clock.
 * @param options `retentionDays` defaults to 30.
 */
export async function reapSoftDeletedFolderFiles(
  db: Database,
  deps: FileReaperDeps,
  options: ReapOptions & { retentionDays?: number } = {}
): Promise<Result<ReapResult, AuxxError>> {
  const { retentionDays = 30, batchSize = 100, dryRun = false, organizationId } = options

  return guard(
    async () => {
      const cutoff = new Date(deps.now().getTime() - retentionDays * 24 * 60 * 60 * 1000)

      const rows = await selectFolderFiles(
        db,
        and(lt(schema.FolderFile.deletedAt, cutoff), orgFilter(organizationId)),
        asc(schema.FolderFile.deletedAt),
        batchSize
      )

      return removeFolderFiles(db, deps, rows, dryRun)
    },
    'Failed to sweep soft-deleted files',
    { organizationId, retentionDays, batchSize, dryRun }
  )
}

/**
 * Hard-delete `StorageLocation` rows marked for deletion more than `minAgeHours`
 * ago, removing their objects first.
 *
 * A safety net behind `storageCleanupJob`, which handles the immediate case;
 * anything still marked a day later was missed and is swept here.
 *
 * The bucket comes from `metadata.bucket` and is never derived — see
 * {@link FileReaperStorage.deleteObject}.
 *
 * @param db Pool.
 * @param deps Storage and clock.
 * @param options `minAgeHours` defaults to 24.
 */
export async function reapMarkedStorageLocations(
  db: Database,
  deps: FileReaperDeps,
  options: ReapOptions & { minAgeHours?: number } = {}
): Promise<Result<ReapResult, AuxxError>> {
  const { minAgeHours = 24, batchSize = 100, dryRun = false, organizationId } = options

  return guard(
    async () => {
      const cutoff = new Date(deps.now().getTime() - minAgeHours * 60 * 60 * 1000)

      const locations = await db
        .select({
          id: schema.StorageLocation.id,
          provider: schema.StorageLocation.provider,
          externalId: schema.StorageLocation.externalId,
          organizationId: schema.StorageLocation.organizationId,
          size: schema.StorageLocation.size,
          metadata: schema.StorageLocation.metadata,
        })
        .from(schema.StorageLocation)
        .where(
          and(
            isNotNull(schema.StorageLocation.deletedAt),
            lt(schema.StorageLocation.deletedAt, cutoff),
            organizationId ? eq(schema.StorageLocation.organizationId, organizationId) : undefined
          )
        )
        .limit(batchSize)

      const result = emptyResult()
      result.scanned = locations.length

      for (const location of locations) {
        const bytes = Number(location.size ?? 0)

        if (dryRun) {
          result.deleted++
          result.storageFreed += bytes
          result.rows.push({
            id: location.id,
            name: location.externalId,
            size: bytes,
            status: 'deleted',
          })
          continue
        }

        try {
          try {
            await deps.storage.deleteObject({
              organizationId: location.organizationId ?? undefined,
              provider: location.provider as ProviderId,
              key: location.externalId,
              bucket: bucketOf(location.metadata),
            })
          } catch (error) {
            // The row is the only record of the key, so it must survive a
            // storage failure for the next run to retry. Rethrow rather than
            // fall through to the DELETE.
            logger.warn('Failed to delete storage object during sweep', {
              storageLocationId: location.id,
              error: error instanceof Error ? error.message : String(error),
            })
            throw error
          }

          await db
            .delete(schema.StorageLocation)
            .where(
              and(
                eq(schema.StorageLocation.id, location.id),
                location.organizationId
                  ? eq(schema.StorageLocation.organizationId, location.organizationId)
                  : isNull(schema.StorageLocation.organizationId)
              )
            )

          result.deleted++
          result.storageFreed += bytes
          result.rows.push({
            id: location.id,
            name: location.externalId,
            size: bytes,
            status: 'deleted',
          })
        } catch (error) {
          result.failed++
          result.errors.push(error as Error)
          result.rows.push({
            id: location.id,
            name: location.externalId,
            size: bytes,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      return result
    },
    'Failed to sweep marked storage locations',
    { organizationId, minAgeHours, batchSize, dryRun }
  )
}

// ============= Internal helpers =============

/** One `FolderFile` and the storage object its current version points at. */
interface FolderFileRow {
  id: string
  name: string
  organizationId: string
  size: number | null
  versionSize: number | null
  storageLocationId: string | null
}

/** Restrict a sweep to one organization, or to all of them. */
function orgFilter(organizationId?: string): SQL | undefined {
  return organizationId ? eq(schema.FolderFile.organizationId, organizationId) : undefined
}

/**
 * "No `Attachment` row points at this file."
 *
 * The table name is a string literal on purpose: a Drizzle table reference
 * interpolated into `sql` binds as a *parameter*, not a relation, so
 * `FROM ${schema.Attachment}` silently produces nonsense. Column references
 * interpolate correctly and are used.
 */
function hasNoAttachment(): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM "Attachment" att WHERE att."fileId" = ${schema.FolderFile.id}
  )`
}

/** The one projection both `FolderFile` sweeps read, joined to its current version. */
async function selectFolderFiles(
  db: Database,
  where: SQL | undefined,
  orderBy: SQL,
  limit: number
): Promise<FolderFileRow[]> {
  return db
    .select({
      id: schema.FolderFile.id,
      name: schema.FolderFile.name,
      organizationId: schema.FolderFile.organizationId,
      size: schema.FolderFile.size,
      versionSize: schema.FileVersion.size,
      storageLocationId: schema.FileVersion.storageLocationId,
    })
    .from(schema.FolderFile)
    .leftJoin(schema.FileVersion, eq(schema.FolderFile.currentVersionId, schema.FileVersion.id))
    .where(where)
    .orderBy(orderBy)
    .limit(limit) as Promise<FolderFileRow[]>
}

/**
 * Remove a batch of files: object first, then the row.
 *
 * The object goes first for the same reason it does in `thumbnails/cleanup.ts` —
 * the row is the only record of the storage key, so deleting it before the
 * object leaks the object with nothing left pointing at it. A storage failure
 * therefore aborts that file and leaves it for the next run.
 *
 * The `DELETE` is scoped to the row's own organization as well as its id. The
 * ids came from an org-filtered select, but a sweep is the last place to rely on
 * that.
 */
async function removeFolderFiles(
  db: Database,
  deps: FileReaperDeps,
  rows: readonly FolderFileRow[],
  dryRun: boolean
): Promise<ReapResult> {
  const result = emptyResult()
  result.scanned = rows.length

  for (const row of rows) {
    const bytes = Number(row.versionSize ?? row.size ?? 0)

    if (dryRun) {
      result.deleted++
      result.storageFreed += bytes
      result.rows.push({ id: row.id, name: row.name, size: bytes, status: 'deleted' })
      continue
    }

    try {
      if (row.storageLocationId) {
        await deps.storage.deleteLocation({
          organizationId: row.organizationId,
          locationId: row.storageLocationId,
        })
      }

      await db
        .delete(schema.FolderFile)
        .where(
          and(
            eq(schema.FolderFile.id, row.id),
            eq(schema.FolderFile.organizationId, row.organizationId)
          )
        )

      result.deleted++
      result.storageFreed += bytes
      result.rows.push({ id: row.id, name: row.name, size: bytes, status: 'deleted' })
    } catch (error) {
      result.failed++
      result.errors.push(error as Error)
      result.rows.push({
        id: row.id,
        name: row.name,
        size: bytes,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
      logger.error('Failed to reap file', {
        fileId: row.id,
        organizationId: row.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

/**
 * The bucket an object actually lives in, as recorded on its `StorageLocation`.
 *
 * `StorageManager.prepareLocationMetadata` stamps `metadata.bucket` on every S3
 * location it writes, so this is the only trustworthy source for a sweep — the
 * provider default is the PRIVATE bucket, and a delete aimed there for a PUBLIC
 * object 204s on the missing key while the real object leaks.
 *
 * Returns `undefined` for rows written outside `StorageManager` or before the
 * bucket was persisted. Guessing one would be worse: the adapter refuses a
 * bucketless delete rather than silently deleting nothing.
 */
export function bucketOf(metadata: unknown): string | undefined {
  const bucket = (metadata as { bucket?: unknown } | null | undefined)?.bucket
  return typeof bucket === 'string' && bucket.length > 0 ? bucket : undefined
}
