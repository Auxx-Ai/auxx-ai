// packages/lib/src/files/folder-files/download.ts

/**
 * Resolving a `FolderFile` to something a browser can fetch.
 *
 * The file-library twin of `assets/download.ts`, and the single accessor that
 * replaces `FileService.getDownloadRef`, `.getDownloadRefForVersion` and
 * `.getDownloadInfo` — the "one id convention" collapse decided in
 * `plans/attachments/02-target-module-shape.md` §2.2. Callers read `.url` off
 * the result; the extra metadata the preview pane needs (filename, size,
 * `versionNumber`) rides along, because both surviving callers wanted it and
 * resolving it costs no extra query.
 *
 * ## The two libraries differ in exactly one place
 *
 * `assets/download.ts` has a durable public-URL shortcut for a non-private asset
 * whose location carries an `externalUrl`. `FolderFile` has **no `isPrivate`
 * column** — a file-library file is always private — so there is no shortcut
 * here and every ref is presigned. The bucket rule is shared:
 * `requireLocationBucket` in `storage/buckets.ts` is the one implementation both
 * import, so the two policies cannot drift.
 */

import { schema } from '@auxx/database'
import type { FolderFileEntity } from '@auxx/database/types'
import { desc, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { NotFoundError } from '../../errors'
import type { DownloadRef } from '../adapters/base-adapter'
import type { FilesCtx, FilesDeps } from '../ctx'
import { guard } from '../guard'
import { requireLocationBucket } from '../storage/buckets'
import type { FileVersionWithLocation } from './file-queries'
import {
  getFolderFileVersionByNumber,
  loadCurrentFileVersion,
  requireFolderFile,
} from './file-queries'

/**
 * The collaborators this read needs — storage to presign, and the clock for the
 * legacy `expiresAt` fallback below.
 *
 * Deliberately a `Pick` of {@link FilesDeps} rather than the whole bundle, per
 * `files/ctx.ts`: a caller holding a real `FilesDeps` passes it unchanged, but
 * the signature states that this function cannot enqueue a job or bust a cache.
 */
export type FolderFileDownloadDeps = Pick<FilesDeps, 'storage' | 'now'>

/**
 * How long a ref claims to be valid when the provider hands back no expiry.
 *
 * Inherited from `FileService.getDownloadRefForVersion`, which stamped
 * `Date.now() + 10 minutes` on both the "url with no expiry" and the "stream"
 * branches so the preview pane always had something to schedule a refetch
 * against.
 */
export const DEFAULT_DOWNLOAD_TTL_MS = 10 * 60 * 1000

/** Which version to serve. `versionNumber` is the 1-based UI counter, never a row id. */
export type FolderFileVersionSelector = number | 'latest' | 'current'

/** Knobs for {@link getFolderFileDownloadRef}. */
export interface GetFolderFileDownloadRefOptions {
  /** Defaults to `'current'`, matching every legacy entry point. */
  version?: FolderFileVersionSelector
  /** How the browser should treat the response. Defaults to the provider's own default. */
  disposition?: 'inline' | 'attachment'
  /** Presigned-URL lifetime. */
  ttlSec?: number
}

/**
 * A {@link DownloadRef} plus the row metadata the preview pane and
 * `FileDownloadInfo` both need.
 *
 * Shaped to be a superset of the legacy `getDownloadRefForVersion` return type,
 * so `fileRouter.getAttachmentPreviewRef` keeps its response contract.
 */
export type FolderFileDownloadRef = DownloadRef & {
  filename: string
  mimeType?: string
  size?: number
  versionNumber: number
  expiresAt: Date
}

/**
 * Resolve one file to a {@link FolderFileDownloadRef}.
 *
 * ## `isArchived = false` is part of the lookup, and stays that way
 *
 * All three legacy accessors refused to serve an archived file
 * (`buildScopedWhere([eq(id), eq(isArchived, false)])`). That is preserved
 * rather than relaxed: widening what is downloadable is a product decision, not
 * a refactor's to make. A soft-deleted file is likewise unreachable, so a
 * presigned URL cannot outlive the purge job.
 *
 * @param ctx Scope. `ctx.db` may be a pool or a transaction; this never opens one.
 * @param deps Storage and the clock — see {@link FolderFileDownloadDeps}.
 * @param fileId File to resolve, interpreted within `ctx.organizationId`.
 * @param opts Which version, and the presign knobs.
 * @returns `err(NotFoundError)` when the file, version, or storage location is
 *   missing in this org; `err(AuxxError)` when the row cannot name its bucket.
 */
export async function getFolderFileDownloadRef(
  ctx: FilesCtx,
  deps: FolderFileDownloadDeps,
  fileId: string,
  opts: GetFolderFileDownloadRefOptions = {}
): Promise<Result<FolderFileDownloadRef, AuxxError>> {
  return guard(
    async () => {
      const file = await requireLiveUnarchivedFile(ctx, fileId)
      const version = await resolveVersion(ctx, file, opts.version ?? 'current')
      return resolveFolderFileDownloadRef(deps, file, version, opts)
    },
    'Failed to resolve file download ref',
    { fileId, version: opts.version, organizationId: ctx.organizationId }
  )
}

/**
 * The database-free tail of {@link getFolderFileDownloadRef}: file + version in,
 * {@link FolderFileDownloadRef} out.
 *
 * Exported for the same reason `resolveAssetDownloadRef` is: a **batch** caller
 * that has already loaded its rows can presign them without re-reading each file
 * and version, so a list read stays a fixed number of round-trips instead of
 * `3N`. Nothing batches file downloads today, but the seam is where the URL
 * policy lives, and having it means a future batch cannot quietly grow a second
 * copy — which is precisely what happened to `MediaAssetService.getDownloadUrls`
 * before PR 5a.
 *
 * Throws rather than returning `Result`: it is a helper, and its only callers
 * are already inside a {@link guard}.
 *
 * @throws {NotFoundError} when the version has no usable storage location.
 * @throws {AuxxError} when the storage location cannot name its bucket.
 */
export async function resolveFolderFileDownloadRef(
  deps: FolderFileDownloadDeps,
  file: FolderFileEntity,
  version: FileVersionWithLocation,
  opts: Pick<GetFolderFileDownloadRefOptions, 'disposition' | 'ttlSec'> = {}
): Promise<FolderFileDownloadRef> {
  const location = version.storageLocation
  if (!version.storageLocationId || !location) {
    throw new NotFoundError(`No storage location found for file ${file.id}`)
  }

  const ref = await deps.storage.presignDownload({
    provider: location.provider,
    bucket: requireLocationBucket(location, { fileId: file.id }),
    key: location.externalId,
    credentialId: location.credentialId ?? undefined,
    ttlSec: opts.ttlSec,
    disposition: opts.disposition,
    filename: file.name,
    mimeType: file.mimeType ?? undefined,
  })

  const fallbackExpiry = new Date(deps.now().getTime() + DEFAULT_DOWNLOAD_TTL_MS)
  return {
    ...ref,
    filename: file.name,
    mimeType: file.mimeType ?? undefined,
    size: file.size ?? undefined,
    versionNumber: version.versionNumber,
    expiresAt: ref.type === 'url' ? (ref.expiresAt ?? fallbackExpiry) : fallbackExpiry,
  }
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/** {@link requireFolderFile} plus the archived check every download path applied. */
async function requireLiveUnarchivedFile(ctx: FilesCtx, fileId: string): Promise<FolderFileEntity> {
  const file = await requireFolderFile(ctx, fileId)
  // Same error as "does not exist": an archived file is not downloadable, and
  // distinguishing the two would let a caller probe for ids it cannot read.
  if (file.isArchived) throw new NotFoundError(`File ${fileId} not found`)
  return file
}

/**
 * Turn a {@link FolderFileVersionSelector} into a row.
 *
 * `'current'` follows `currentVersionId` (falling back to the highest number),
 * `'latest'` always takes the highest number — the two differ after a
 * `restoreVersion` — and a number addresses the version by its UI counter. Every
 * branch constrains on `fileId`, so a version belonging to another file (and
 * possibly another org) cannot be served through a file the caller can see.
 */
async function resolveVersion(
  ctx: FilesCtx,
  file: FolderFileEntity,
  selector: FolderFileVersionSelector
): Promise<FileVersionWithLocation> {
  let version: FileVersionWithLocation | null

  if (selector === 'current') {
    version = await loadCurrentFileVersion(ctx, file)
  } else if (selector === 'latest') {
    version = ((await ctx.db.query.FileVersion.findFirst({
      where: eq(schema.FileVersion.fileId, file.id),
      with: { storageLocation: true },
      orderBy: desc(schema.FileVersion.versionNumber),
    })) ?? null) as FileVersionWithLocation | null
  } else {
    const found = await getFolderFileVersionByNumber(ctx, file.id, selector)
    if (found.isErr()) throw found.error
    version = found.value
  }

  if (!version) throw new NotFoundError(`Version ${selector} not found for file ${file.id}`)
  return version
}
