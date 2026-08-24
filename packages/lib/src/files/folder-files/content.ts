// packages/lib/src/files/folder-files/content.ts

/**
 * Reading the **bytes** behind a `FolderFile`.
 *
 * The file-library twin of `assets/content.ts`, and the replacement for
 * `FileService.getContent(id)` plus the `StorageManager.getContent(locationId)`
 * hop underneath it. `assets/content.ts` carries the full account of why
 * `getContent` was deferred three times, and the measurement that showed the
 * bucket/key-only {@link StoragePort} is sufficient — no `StorageLocation`
 * row in this codebase carries `region` or `endpoint`.
 *
 * ## Two ways this differs from `folder-files/download.ts`, both deliberate
 *
 * 1. **No archived check.** `getFolderFileDownloadRef` refuses an archived file,
 *    because all three legacy download accessors did. `FileService.getContent`
 *    resolved its version through `getCurrentVersion` → `requireFolderFile`,
 *    which does not look at `isArchived`, so an archived file's bytes were
 *    readable server-side. That asymmetry is preserved rather than tidied:
 *    narrowing what a server-side render, an export or a mail attachment can
 *    read is a product decision, not a refactor's to make.
 * 2. **No public-URL shortcut, and none to miss.** `FolderFile` has no
 *    `isPrivate` column at all — that is the one place the two libraries diverge
 *    on the download side — but a durable `externalUrl` is a browser affordance
 *    and says nothing about how the server reads bytes, so the content path is
 *    identical across both libraries anyway.
 *
 * The bucket still comes off the `StorageLocation` row via
 * {@link requireLocationBucket}, never from config: S3 answers `204 No Content`
 * for a delete aimed at a key that was never in the bucket you named
 * (#1816/#1817/#1818), so a guessed bucket fails silently and later.
 */

import type { FolderFileEntity } from '@auxx/database/types'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { NotFoundError } from '../../errors'
import type { FilesCtx, FilesDeps } from '../ctx'
import { guard, unwrap } from '../guard'
import { requireLocationBucket } from '../storage/buckets'
import { getObject, streamObject } from '../storage/objects'
import type { GetObjectParams, StoragePort } from '../storage/ports'
import type { FileVersionWithLocation, FolderFileVersionSelector } from './file-queries'
import { requireFolderFile, resolveFolderFileVersion } from './file-queries'

/**
 * The collaborators a content read needs — storage, and nothing else.
 *
 * Narrower than `FolderFileDownloadDeps`, which also takes `now` for its legacy
 * `expiresAt` fallback. A content read has no expiry to invent, so the clock is
 * not in the signature.
 */
export type FolderFileContentDeps = Pick<FilesDeps, 'storage'>

/** Knobs for {@link getFolderFileContent} and {@link streamFolderFileContent}. */
export interface GetFolderFileContentOptions {
  /** Defaults to `'current'`, matching `FileService.getContent`. */
  version?: FolderFileVersionSelector
}

/**
 * The database-free seam: a file + version in, the object address out.
 *
 * **Pure.** No `ctx`, no `deps`, no I/O — which is what lets both
 * {@link getFolderFileContent} and {@link streamFolderFileContent} share one
 * bucket resolution, and lets a batch caller that has already loaded its rows
 * address many objects without re-reading a single one. The counterpart of
 * `resolveFolderFileDownloadRef`, and of `resolveAssetObjectRef` in the asset
 * library.
 *
 * Throws rather than returning `Result`: it is a helper, and its callers are
 * already inside a {@link guard}.
 *
 * @param file The file the caller has already loaded, org-scoped.
 * @param version That file's version, with `storageLocation` joined in.
 * @throws {NotFoundError} when the version has no usable storage location.
 * @throws {AuxxError} when the storage location cannot name its bucket.
 */
export function resolveFolderFileObjectRef(
  file: FolderFileEntity,
  version: FileVersionWithLocation
): GetObjectParams {
  const location = version.storageLocation
  if (!version.storageLocationId || !location) {
    throw new NotFoundError(`No storage location found for file ${file.id}`)
  }

  return {
    provider: location.provider,
    bucket: requireLocationBucket(location, { fileId: file.id }),
    key: location.externalId,
    credentialId: location.credentialId ?? undefined,
  }
}

/**
 * Read one file's bytes into memory.
 *
 * Replaces `FileService.getContent(id)` — and the
 * `StorageManager.getContent(locationId)` hop it delegated to, which did its own
 * **unscoped** `StorageLocation` read behind the caller's back. Here the file
 * and its version are resolved org-scoped first, and the location arrives joined
 * onto the version, so there is no second lookup to get wrong.
 *
 * Buffers the whole object. Use {@link streamFolderFileContent} for anything
 * being forwarded to a response body rather than parsed or re-encoded.
 *
 * **`FileVersion.deletedAt` is deliberately not filtered**, matching both the
 * legacy path and `folder-files/download.ts`. Whether it should be is the open
 * question in `plans/attachments/05-core-services.md` §5.6.1.
 *
 * @param ctx Scope. `ctx.db` may be a pool or a transaction; this never opens one.
 * @param deps Storage only — see {@link FolderFileContentDeps}.
 * @param fileId File to read, interpreted within `ctx.organizationId`.
 * @param opts Which version. Defaults to `'current'`.
 * @returns `err(NotFoundError)` when the file, version, or storage location is
 *   missing in this org; `err(AuxxError)` when the row cannot name its bucket or
 *   the provider read fails.
 */
export async function getFolderFileContent(
  ctx: FilesCtx,
  deps: FolderFileContentDeps,
  fileId: string,
  opts: GetFolderFileContentOptions = {}
): Promise<Result<Buffer, AuxxError>> {
  return guard(
    async () => readFolderFileObject(ctx, deps.storage, fileId, opts, getObject),
    'Failed to read file content',
    { fileId, version: opts.version, organizationId: ctx.organizationId }
  )
}

/**
 * Open a read stream over one file's bytes.
 *
 * `FileService.streamContent` was deleted in PR 5b as zero-caller; this is the
 * functional replacement, offered because the {@link StoragePort} has
 * `streamObject` and buffering a large export or attachment purely to hand it to
 * a response is the mistake the buffered variant invites.
 *
 * There is no range parameter, matching the port:
 * `StorageManager.streamFileContent` accepted one, logged
 * `'Range support not yet implemented'` and returned the full stream anyway. A
 * silently ignored parameter is worse than an absent one.
 *
 * @param ctx Scope. `ctx.db` may be a pool or a transaction; this never opens one.
 * @param deps Storage only — see {@link FolderFileContentDeps}.
 * @param fileId File to read, interpreted within `ctx.organizationId`.
 * @param opts Which version. Defaults to `'current'`.
 */
export async function streamFolderFileContent(
  ctx: FilesCtx,
  deps: FolderFileContentDeps,
  fileId: string,
  opts: GetFolderFileContentOptions = {}
): Promise<Result<NodeJS.ReadableStream, AuxxError>> {
  return guard(
    async () => readFolderFileObject(ctx, deps.storage, fileId, opts, streamObject),
    'Failed to open file content stream',
    { fileId, version: opts.version, organizationId: ctx.organizationId }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * The shared body of the two reads above: resolve the file, resolve the version,
 * address the object, hand it to `read`.
 *
 * `read` is the `storage/objects.ts` function rather than the port method
 * directly, because those wrap the call in `storageGuard` — which maps
 * `StorageFileNotFoundError` to a 404 and `StorageAuthError` to a 401 instead of
 * letting the plain `files/guard.ts` flatten both to `Internal error`.
 */
async function readFolderFileObject<T>(
  ctx: FilesCtx,
  storage: StoragePort,
  fileId: string,
  opts: GetFolderFileContentOptions,
  read: (port: StoragePort, p: GetObjectParams) => Promise<Result<T, AuxxError>>
): Promise<T> {
  const file = await requireFolderFile(ctx, fileId)
  const version = await resolveFolderFileVersion(ctx, file, opts.version ?? 'current')
  return unwrap(await read(storage, resolveFolderFileObjectRef(file, version)))
}
