// packages/lib/src/files/folder-files/file-mutations.ts

/**
 * `FolderFile` writes.
 *
 * Reads live in `folder-files/file-queries.ts`, version writes in
 * `folder-files/version-mutations.ts` — `docs/lib-module-guide.md` §5, "a file
 * that both queries and mutates is the first step back toward a service class".
 *
 * ## Scope comes from `ctx`, never from the payload
 *
 * The legacy `processCreateData` read `data.organizationId` and only fell back
 * to the service's own scope, so a caller could write a row into an organization
 * it was not acting for. Following `assets/asset-mutations.ts` and
 * `storage/locations.ts`, the input types below carry no `organizationId` at
 * all, and every `WHERE` names `ctx.organizationId` unconditionally — the
 * legacy `if (this.organizationId)` guard in `BaseService.buildBaseWhereClause`
 * meant an unscoped service updated and deleted across tenants.
 *
 * ## Actors travel in the input, not in `ctx`
 *
 * `FilesCtx` deliberately has no `userId` (`files/ctx.ts`), so
 * {@link CreateFolderFileInput.createdById} is where attribution appears.
 *
 * ## `updatedAt` is stamped explicitly, on every write
 *
 * `FolderFile.updatedAt` is `NOT NULL` with no database default and no Drizzle
 * `$onUpdate`, so it has to be supplied. It comes from `deps.now()` rather than
 * a bare `new Date()`, which is what made the legacy writes untestable without
 * process-global fake timers.
 */

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { FolderFileEntity } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { AuxxError, BadRequestError, NotFoundError } from '../../errors'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'
import { requireFolderFile, resolveUniqueFilePath } from './file-queries'
import type { FolderFileWriteDeps } from './ports'
import type { CreatedFileVersion } from './version-mutations'
import { copyFileVersions, createFileVersion } from './version-mutations'

/** Everything needed to persist one `FolderFile` row. See the file header for what is absent. */
export interface CreateFolderFileInput {
  name: string
  /** `undefined` and `null` both mean the organization root. */
  folderId?: string | null
  /**
   * An explicit path. Omit it and a collision-safe one is derived from the
   * folder's path plus `name` — which is what every production caller does.
   */
  path?: string
  ext?: string
  mimeType?: string
  size?: number
  checksum?: string
  /**
   * The actor to attribute the row to.
   *
   * **Behaviour change:** the legacy `processCreateData` called
   * `requireUserId()` and threw when neither the payload nor the service carried
   * an actor. The column is nullable and several lib-internal writers genuinely
   * have none, so this is optional here — the same call `CreateAssetInput` made.
   */
  createdById?: string
  /** Preserved when copying or importing an existing file; defaults to `deps.now()`. */
  createdAt?: Date
  /** Preserved when copying or importing an existing file; defaults to `deps.now()`. */
  updatedAt?: Date
}

/** {@link CreateFolderFileInput} plus the storage location the first version points at. */
export interface CreateFolderFileWithVersionInput extends CreateFolderFileInput {
  storageLocationId: string
}

/** The mutable fields of a `FolderFile`. Absent fields are left alone. */
export interface UpdateFolderFileInput {
  name?: string
  path?: string
  /** `null` moves the row to the organization root. */
  folderId?: string | null
  isArchived?: boolean
  mimeType?: string
  size?: number
  /** Normalised to lowercase; an empty string clears the column. */
  ext?: string | null
}

/** Everything needed to duplicate a file and its version history. */
export interface CopyFolderFileInput {
  sourceFileId: string
  /** `null` copies into the organization root. */
  targetFolderId: string | null
  /** Defaults to `Copy of <source name>`, matching the legacy `copy`. */
  newName?: string
  /** The actor to attribute the new row to. */
  createdById?: string
}

/**
 * Create one `FolderFile` row.
 *
 * A single `INSERT` (plus the reads that derive a collision-safe path), so it
 * takes `ctx` rather than a `Transaction`. A caller already inside one passes
 * `{ ...ctx, db: tx }`.
 *
 * @param ctx Scope and database. `ctx.organizationId` is the row's owner.
 * @param deps `now`, for the `createdAt`/`updatedAt` stamps.
 * @param input The row to write.
 */
export async function createFolderFile(
  ctx: FilesCtx,
  deps: FolderFileWriteDeps,
  input: CreateFolderFileInput
): Promise<Result<FolderFileEntity, AuxxError>> {
  return guard(async () => insertFolderFile(ctx.db, ctx, deps, input), 'Failed to create file', {
    name: input.name,
    organizationId: ctx.organizationId,
  })
}

/**
 * Create a file and its first version together, inside the caller's transaction.
 *
 * `tx` is positional and first because this is three statements — insert the
 * file, insert the version, move `currentVersionId` — and a file that exists
 * without a version is a file nothing can download (and is exactly what
 * `findOrphanedFolderFiles` sweeps up). The legacy `createWithVersion` opened
 * its own `getTx` savepoint; here the caller owns the boundary
 * (`plans/attachments/06-transactions-and-jobs.md` §6.1).
 *
 * @param tx The caller's transaction. Never `tx.transaction(…)`ed here.
 * @param ctx Scope. `ctx.db` is ignored — every statement runs on `tx`.
 * @param deps `now`, for the file's timestamps.
 * @param input File fields plus the storage location the first version points at.
 */
export async function createFolderFileWithVersion(
  tx: Transaction,
  ctx: FilesCtx,
  deps: FolderFileWriteDeps,
  input: CreateFolderFileWithVersionInput
): Promise<Result<{ file: FolderFileEntity; version: CreatedFileVersion }, AuxxError>> {
  return guard(
    async () => {
      const { storageLocationId, ...fileInput } = input
      const txCtx: FilesCtx = { ...ctx, db: tx }
      const file = await insertFolderFile(tx, txCtx, deps, fileInput)

      const version = await createFileVersion(tx, ctx, {
        fileId: file.id,
        storageLocationId,
        size: input.size,
        mimeType: input.mimeType,
        checksum: input.checksum,
      })
      // Rethrow rather than return: an `err()` here would resolve normally and
      // the caller would commit a file with no version.
      if (version.isErr()) throw version.error

      return { file, version: version.value }
    },
    'Failed to create file with version',
    { name: input.name, storageLocationId: input.storageLocationId }
  )
}

/**
 * Update one file's mutable fields.
 *
 * Soft-deleted rows are updatable, matching the legacy `update` (which passed
 * `includeDeleted = true`) — `restoreFolderFile` depends on that.
 *
 * @param ctx Scope and database.
 * @param deps `now`, for the `updatedAt` stamp.
 * @param fileId The file to update, interpreted within `ctx.organizationId`.
 * @param input The fields to change.
 */
export async function updateFolderFile(
  ctx: FilesCtx,
  deps: FolderFileWriteDeps,
  fileId: string,
  input: UpdateFolderFileInput
): Promise<Result<FolderFileEntity, AuxxError>> {
  return guard(
    async () => applyUpdate(ctx, fileId, buildUpdatePayload(input, deps.now())),
    'Failed to update file',
    { fileId, organizationId: ctx.organizationId }
  )
}

/**
 * Soft-delete a file by stamping `deletedAt`.
 *
 * **Deliberately idempotent.** The legacy `delete` issued the `UPDATE` without
 * first checking that the row existed and returned `void` either way, so a
 * repeated delete — a double-clicked button, a retried mutation — succeeded.
 * Turning that into a 404 would be a visible UI regression, so the silence is
 * preserved. What is *not* preserved is the missing scope: the statement now
 * always names `ctx.organizationId`.
 *
 * @param ctx Scope and database.
 * @param deps `now`, for the `deletedAt` stamp.
 * @param fileId The file to remove.
 */
export async function deleteFolderFile(
  ctx: FilesCtx,
  deps: FolderFileWriteDeps,
  fileId: string
): Promise<Result<void, AuxxError>> {
  return guard(
    async () => {
      await ctx.db
        .update(schema.FolderFile)
        .set({ deletedAt: deps.now() })
        .where(
          and(
            eq(schema.FolderFile.id, fileId),
            eq(schema.FolderFile.organizationId, ctx.organizationId)
          )
        )
    },
    'Failed to delete file',
    { fileId, organizationId: ctx.organizationId }
  )
}

/**
 * Clear a file's `deletedAt`, bringing it back into every live read.
 *
 * Unlike {@link deleteFolderFile} this reports a miss: restoring an id that
 * names nothing is a caller error, not an idempotent no-op.
 */
export async function restoreFolderFile(
  ctx: FilesCtx,
  deps: FolderFileWriteDeps,
  fileId: string
): Promise<Result<FolderFileEntity, AuxxError>> {
  return guard(
    async () => applyUpdate(ctx, fileId, { deletedAt: null, updatedAt: deps.now() }),
    'Failed to restore file',
    { fileId, organizationId: ctx.organizationId }
  )
}

/**
 * Move a file into another folder, re-deriving a collision-safe path.
 *
 * **Behaviour change: moving to the root now actually moves it.** The legacy
 * `move` finished with `update(id, { folderId: target ?? undefined, path })`,
 * and `update` skipped any field that was `undefined` — so a move to the root
 * rewrote `path` to `/name` while leaving `folderId` pointing at the old folder.
 * The row then listed under its old parent with a root-shaped path. `null` is
 * written explicitly here.
 *
 * @param ctx Scope and database.
 * @param deps `now`, for the `updatedAt` stamp.
 * @param fileId The file to move.
 * @param targetFolderId The destination, or `null` for the organization root.
 *   The string `'root'` is accepted and treated as `null`, which is the
 *   vocabulary the filesystem move-plan speaks.
 */
export async function moveFolderFile(
  ctx: FilesCtx,
  deps: FolderFileWriteDeps,
  fileId: string,
  targetFolderId: string | null
): Promise<Result<FolderFileEntity, AuxxError>> {
  return guard(
    async () => {
      const target = targetFolderId === 'root' ? null : targetFolderId
      const file = await requireFolderFile(ctx, fileId)
      // Resolves the destination org-scoped and throws NotFoundError if it is
      // not this organization's folder, so no separate validation is needed.
      const path = await resolveUniqueFilePath(ctx, target, file.name)

      return applyUpdate(ctx, fileId, { folderId: target, path, updatedAt: deps.now() })
    },
    'Failed to move file',
    { fileId, targetFolderId, organizationId: ctx.organizationId }
  )
}

/**
 * Rename a file, re-deriving its path and extension.
 *
 * The extension is taken from the new name — a rename from `notes.txt` to
 * `notes.md` has to move `ext` too, or every extension filter keeps reporting
 * the old type.
 */
export async function renameFolderFile(
  ctx: FilesCtx,
  deps: FolderFileWriteDeps,
  fileId: string,
  newName: string
): Promise<Result<FolderFileEntity, AuxxError>> {
  return guard(
    async () => {
      if (!newName.trim()) throw new BadRequestError('File name cannot be empty')

      const file = await requireFolderFile(ctx, fileId)
      const path = await resolveUniqueFilePath(ctx, file.folderId, newName)

      const dot = newName.lastIndexOf('.')
      const ext = dot > 0 ? newName.slice(dot + 1).toLowerCase() : null

      return applyUpdate(ctx, fileId, { name: newName, path, ext, updatedAt: deps.now() })
    },
    'Failed to rename file',
    { fileId, organizationId: ctx.organizationId }
  )
}

/**
 * Duplicate a file and its whole version history into another folder.
 *
 * **`tx` is positional and first, which the legacy `copy` had no equivalent
 * of.** That method inserted the file, then looped `createVersion` once per
 * source version, each opening its own savepoint — so a failure halfway left a
 * half-copied file behind with no way to tell it from a real one. One
 * transaction, owned by the caller, is what makes the copy all-or-nothing.
 *
 * @param tx The caller's transaction.
 * @param ctx Scope. `ctx.db` is ignored.
 * @param deps `now`, for the new row's timestamps.
 * @param input Source, destination, optional name and the actor.
 */
export async function copyFolderFile(
  tx: Transaction,
  ctx: FilesCtx,
  deps: FolderFileWriteDeps,
  input: CopyFolderFileInput
): Promise<Result<FolderFileEntity, AuxxError>> {
  return guard(
    async () => {
      const txCtx: FilesCtx = { ...ctx, db: tx }
      const source = await requireFolderFile(txCtx, input.sourceFileId)

      const file = await insertFolderFile(tx, txCtx, deps, {
        name: input.newName || `Copy of ${source.name}`,
        folderId: input.targetFolderId,
        ext: source.ext ?? undefined,
        mimeType: source.mimeType ?? undefined,
        size: source.size ?? undefined,
        checksum: source.checksum ?? undefined,
        createdById: input.createdById,
      })

      const copied = await copyFileVersions(tx, ctx, input.sourceFileId, file.id)
      if (copied.isErr()) throw copied.error

      return file
    },
    'Failed to copy file',
    { sourceFileId: input.sourceFileId, organizationId: ctx.organizationId }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * The shared `INSERT` body. Takes the client explicitly so
 * {@link createFolderFileWithVersion} and {@link copyFolderFile} can run it on
 * `tx` without a second `ctx`.
 */
async function insertFolderFile(
  client: Database | Transaction,
  ctx: FilesCtx,
  deps: FolderFileWriteDeps,
  input: CreateFolderFileInput
): Promise<FolderFileEntity> {
  if (!input.name.trim()) throw new BadRequestError('File name is required')

  // An empty-string folderId is the root, not a folder whose id is ''. The
  // legacy code special-cased this because the uploader sends `''` when no
  // folder is selected, and a bare `''` violates the FK.
  const folderId = input.folderId?.trim() ? input.folderId : null

  const now = deps.now()
  const path =
    input.path ?? (await resolveUniqueFilePath({ ...ctx, db: client }, folderId, input.name))

  const [file] = await client
    .insert(schema.FolderFile)
    .values({
      name: input.name,
      path,
      folderId,
      ext: input.ext?.toLowerCase(),
      mimeType: input.mimeType,
      size: input.size,
      checksum: input.checksum,
      createdById: input.createdById,
      isArchived: false,
      // Scope is the caller's, never the payload's.
      organizationId: ctx.organizationId,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    })
    .returning()

  if (!file) throw new AuxxError('File insert returned no row')
  return file as FolderFileEntity
}

/** Map {@link UpdateFolderFileInput} onto the column payload, dropping absent fields. */
function buildUpdatePayload(input: UpdateFolderFileInput, now: Date): Record<string, unknown> {
  const payload: Record<string, unknown> = { updatedAt: now }
  if (input.name !== undefined) payload.name = input.name
  if (input.path !== undefined) payload.path = input.path
  if (input.folderId !== undefined) payload.folderId = input.folderId ?? null
  if (input.isArchived !== undefined) payload.isArchived = input.isArchived
  if (input.mimeType !== undefined) payload.mimeType = input.mimeType
  if (input.size !== undefined) payload.size = input.size
  if (input.ext !== undefined) payload.ext = input.ext ? input.ext.toLowerCase() : null
  return payload
}

/**
 * The single `UPDATE … RETURNING` every write above funnels through.
 *
 * Soft-deleted rows are in scope on purpose (see {@link updateFolderFile}), but
 * the organization filter never is optional.
 */
async function applyUpdate(
  ctx: FilesCtx,
  fileId: string,
  payload: Record<string, unknown>
): Promise<FolderFileEntity> {
  const [file] = await ctx.db
    .update(schema.FolderFile)
    .set(payload)
    .where(
      and(
        eq(schema.FolderFile.id, fileId),
        eq(schema.FolderFile.organizationId, ctx.organizationId)
      )
    )
    .returning()

  if (!file) throw new NotFoundError(`File ${fileId} not found`)
  return file as FolderFileEntity
}
