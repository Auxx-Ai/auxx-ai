// packages/lib/src/files/folder-files/version-mutations.ts

/**
 * `FileVersion` writes.
 *
 * Separate from `folder-files/file-mutations.ts` because the two have different
 * atomicity requirements, not because of a naming convention: creating a version
 * is *always* two statements (insert the row, move the file's
 * `currentVersionId`), so it can only be correct inside a transaction the caller
 * owns. That is why {@link createFileVersion} and {@link copyFileVersions} take
 * `tx: Transaction` positionally first — a `ctx`-only signature would accept a
 * pool and the pointer move would silently stop being atomic with the insert.
 *
 * ## These functions never open a transaction
 *
 * No `getTx`, no `tx.transaction(...)`. The legacy `createVersion` called
 * `this.getTx(run)`, which branches at runtime on whether `this.db.transaction`
 * exists — and in drizzle-orm 0.44 a transaction client still has that method,
 * so the "already inside one" branch is unreachable and an upload really ran a
 * nested `SAVEPOINT` for work nothing needed to partially roll back.
 *
 * ## The unique-constraint retry is gone, deliberately
 *
 * `createVersion` caught PostgreSQL `23505` on
 * `FileVersion_fileId_versionNumber_key` and re-ran the whole body once. That
 * cannot be done from inside a transaction the caller owns: after a constraint
 * violation the transaction is aborted, and every subsequent statement fails
 * with `25P02` until it is rolled back. A retry has to happen where the
 * transaction boundary is — i.e. in the caller — so it moves there rather than
 * pretending to work here. In practice the race needs two concurrent version
 * creates on the same file, which no production path performs.
 *
 * ## `Result` and rollback do not compose
 *
 * The bodies below throw `AuxxError` subclasses and {@link guard} converts at
 * the exported boundary. Returning `err()` from inside a transaction body does
 * **not** roll back — it is an ordinary resolved value, so the caller commits
 * the rows it was just told failed to write.
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type {
  FileVersionEntity,
  FolderFileEntity,
  StorageLocationEntity,
} from '@auxx/database/types'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { AuxxError, ConflictError, NotFoundError } from '../../errors'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'
import { getFolderFileVersionByNumber, requireFolderFile } from './file-queries'
import type { FolderFileWriteDeps } from './ports'

/** A version returned by a write, with the location it points at resolved. */
export type CreatedFileVersion = FileVersionEntity & {
  storageLocation: StorageLocationEntity
}

/** Everything needed to add one version to an existing file. */
export interface CreateFileVersionInput {
  fileId: string
  storageLocationId: string
  /**
   * Byte size. Defaults to the storage location's own `size` when omitted.
   *
   * The legacy `createVersion` spread its `metadata` argument over
   * `{ size, mimeType }` taken from the location, so a caller passing
   * `{ size: undefined }` — which `createWithVersion` did whenever
   * `CreateFileRequest.size` was absent — overwrote the location's size with
   * `undefined` and persisted `NULL`. Inheriting from the row is what the code
   * plainly meant, and matches the same fix PR 5a made in `assets/`.
   */
  size?: number
  /** MIME type. Defaults to the storage location's own `mimeType` when omitted. */
  mimeType?: string
  /** Content hash, carried forward when a version is copied. */
  checksum?: string
}

/**
 * Add a version to a file and make it current, inside the caller's transaction.
 *
 * Two statements plus the file existence check, all on `tx`. The
 * `currentVersionId` move is organization-scoped, which the legacy
 * `UPDATE FolderFile … WHERE id = ?` was not.
 *
 * ## The `StorageLocation` read is deliberately NOT organization-scoped
 *
 * `StorageLocation.organizationId` is nullable — the column was added for
 * backfill compatibility and old rows carry `NULL`. An `eq(organizationId, …)`
 * filter would make every one of those rows invisible, and a version could no
 * longer be created against a location that predates the column. Same trade,
 * stated the same way, as `assets/version-mutations.ts`.
 *
 * @param tx Positional and first: `FilesCtx.db` is `Database | Transaction`, so
 *   a `ctx`-only signature would accept a pool and the insert would stop being
 *   atomic with the pointer move. This function never calls `tx.transaction(…)`.
 * @param ctx Scope. `ctx.db` is ignored — every statement runs on `tx`.
 * @param input The version to write.
 */
export async function createFileVersion(
  tx: Transaction,
  ctx: FilesCtx,
  input: CreateFileVersionInput
): Promise<Result<CreatedFileVersion, AuxxError>> {
  return guard(async () => insertVersion(tx, ctx, input), 'Failed to create file version', {
    fileId: input.fileId,
    storageLocationId: input.storageLocationId,
  })
}

/**
 * Point a file back at one of its earlier versions.
 *
 * A single `UPDATE`, so it takes `ctx` rather than a `Transaction` — but the
 * `WHERE` now carries the organization filter the legacy `restoreVersion`
 * omitted (it read the version org-scoped and then updated by bare id).
 *
 * This is also the whole of what `FileService.pinVersion` did: the two methods
 * had byte-identical bodies down to the error message. Only the name is gone.
 *
 * @param ctx Scope and database.
 * @param deps `now`, for the `updatedAt` stamp.
 * @param fileId The file to move.
 * @param versionNumber The 1-based version number to restore — not a version id.
 */
export async function restoreFileVersion(
  ctx: FilesCtx,
  deps: FolderFileWriteDeps,
  fileId: string,
  versionNumber: number
): Promise<Result<FolderFileEntity, AuxxError>> {
  return guard(
    async () => {
      const version = await requireVersionByNumber(ctx, fileId, versionNumber)

      const [file] = await ctx.db
        .update(schema.FolderFile)
        .set({ currentVersionId: version.id, updatedAt: deps.now() })
        .where(
          and(
            eq(schema.FolderFile.id, fileId),
            eq(schema.FolderFile.organizationId, ctx.organizationId)
          )
        )
        .returning()

      if (!file) throw new AuxxError(`File ${fileId} restore affected no rows`)
      return file as FolderFileEntity
    },
    'Failed to restore file version',
    { fileId, versionNumber }
  )
}

/**
 * Hard-delete one non-current version of a file.
 *
 * Refuses to delete the file's current version — losing it would leave the file
 * pointing at nothing, which is the state `findOrphanedFolderFiles` exists to
 * find.
 *
 * The version row goes; its `StorageLocation` and the object behind it do not.
 * That is inherited unchanged, and it is why `lifecycle/`'s orphaned-object
 * sweep exists.
 *
 * @param ctx Scope and database. Kept `ctx`-shaped rather than `tx`-first
 *   because the legacy method ran its statements on a bare pool; introducing a
 *   transaction here would be a Phase-6 change made under cover of Phase 5.
 */
export async function deleteFileVersion(
  ctx: FilesCtx,
  fileId: string,
  versionNumber: number
): Promise<Result<void, AuxxError>> {
  return guard(
    async () => {
      const file = await requireFolderFile(ctx, fileId)
      const version = await requireVersionByNumber(ctx, fileId, versionNumber)

      if (file.currentVersionId === version.id) {
        throw new ConflictError('Cannot delete the current version')
      }

      await ctx.db
        .delete(schema.FileVersion)
        .where(and(eq(schema.FileVersion.id, version.id), eq(schema.FileVersion.fileId, fileId)))
    },
    'Failed to delete file version',
    { fileId, versionNumber }
  )
}

/**
 * Copy every version of one file onto another, oldest first.
 *
 * Oldest-first matters: {@link insertVersion} numbers each new row `last + 1`,
 * so walking the source newest-first would invert the history. The legacy
 * `copyVersions` iterated `getVersions`, which is ordered *descending*, and
 * therefore reversed the version order of every copied file.
 *
 * The copies share the source's `StorageLocation` rows rather than duplicating
 * the objects — a copy is a new pointer to the same bytes.
 *
 * @param tx The caller's transaction. One version create is two statements, and
 *   `n` of them have to land together or the copy is half-built.
 * @param ctx Scope. `ctx.db` is ignored.
 * @param sourceFileId The file to read versions from, org-scoped.
 * @param targetFileId The file to write versions onto, org-scoped.
 */
export async function copyFileVersions(
  tx: Transaction,
  ctx: FilesCtx,
  sourceFileId: string,
  targetFileId: string
): Promise<Result<FileVersionEntity[], AuxxError>> {
  return guard(
    async () => {
      const txCtx: FilesCtx = { ...ctx, db: tx }
      await requireFolderFile(txCtx, sourceFileId)
      await requireFolderFile(txCtx, targetFileId)

      const sourceVersions = await tx.query.FileVersion.findMany({
        where: eq(schema.FileVersion.fileId, sourceFileId),
        orderBy: asc(schema.FileVersion.versionNumber),
      })

      const copied: FileVersionEntity[] = []
      for (const source of sourceVersions) {
        copied.push(
          await insertVersion(tx, ctx, {
            fileId: targetFileId,
            storageLocationId: source.storageLocationId,
            size: source.size ?? undefined,
            mimeType: source.mimeType ?? undefined,
            checksum: source.checksum ?? undefined,
          })
        )
      }
      return copied
    },
    'Failed to copy file versions',
    { sourceFileId, targetFileId }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/** {@link getFolderFileVersionByNumber}, but a miss is a `NotFoundError` rather than `null`. */
async function requireVersionByNumber(
  ctx: FilesCtx,
  fileId: string,
  versionNumber: number
): Promise<FileVersionEntity> {
  const found = await getFolderFileVersionByNumber(ctx, fileId, versionNumber)
  if (found.isErr()) throw found.error
  if (!found.value) {
    throw new NotFoundError(`Version ${versionNumber} not found for file ${fileId}`)
  }
  return found.value
}

/**
 * The shared body of {@link createFileVersion} and {@link copyFileVersions}.
 *
 * Throws rather than returning `Result`, so a failure inside the caller's
 * transaction rolls it back.
 */
async function insertVersion(
  tx: Transaction,
  ctx: FilesCtx,
  input: CreateFileVersionInput
): Promise<CreatedFileVersion> {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  await requireFolderFile(txCtx, input.fileId)

  const last = await tx.query.FileVersion.findFirst({
    where: eq(schema.FileVersion.fileId, input.fileId),
    orderBy: desc(schema.FileVersion.versionNumber),
    columns: { versionNumber: true },
  })
  const versionNumber = (last?.versionNumber ?? 0) + 1

  // See the function docs on `createFileVersion`: intentionally not
  // organization-scoped, because `StorageLocation.organizationId` is nullable.
  const storageLocation = await tx.query.StorageLocation.findFirst({
    where: and(
      eq(schema.StorageLocation.id, input.storageLocationId),
      isNull(schema.StorageLocation.deletedAt)
    ),
  })
  if (!storageLocation) {
    throw new NotFoundError(`Storage location ${input.storageLocationId} not found`)
  }

  const [version] = await tx
    .insert(schema.FileVersion)
    .values({
      fileId: input.fileId,
      versionNumber,
      storageLocationId: input.storageLocationId,
      size: input.size ?? storageLocation.size,
      mimeType: input.mimeType ?? storageLocation.mimeType,
      checksum: input.checksum,
    })
    .returning()

  if (!version) throw new AuxxError('File version insert returned no row')

  await tx
    .update(schema.FolderFile)
    .set({ currentVersionId: version.id })
    .where(
      and(
        eq(schema.FolderFile.id, input.fileId),
        eq(schema.FolderFile.organizationId, ctx.organizationId)
      )
    )

  return { ...(version as FileVersionEntity), storageLocation }
}
