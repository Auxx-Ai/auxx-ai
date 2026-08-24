// packages/lib/src/files/attachments/download.ts

/**
 * Resolving an `Attachment` to something a browser can fetch.
 *
 * The third member of the download trio, alongside `assets/download.ts` and
 * `folder-files/download.ts`, and the only one that does not own a library of
 * its own. An attachment is a pointer: `(entityType, entityId)` names the host
 * and exactly one of `fileId` / `assetId` names the target, so this module is
 * **download policy about a pointer**, and the bytes always come from one of the
 * other two modules or from a `StorageLocation` addressed directly.
 *
 * ## Three branches, and only one of them is local
 *
 * | attachment | resolves through |
 * | ---------- | ---------------- |
 * | pinned (`fileVersionId` / `assetVersionId` set) | {@link LocationDownloadPort} — the pinned `StorageLocation`, by id |
 * | unpinned, `fileId` | `getFolderFileDownloadRef` |
 * | unpinned, `assetId` | `getAssetDownloadRef` |
 *
 * The two unpinned branches **delegate rather than restate**. That is not
 * stylistic tidiness: the libraries do not have the same download policy. A
 * non-private `MediaAsset` whose location carries an `externalUrl` returns that
 * durable URL with no expiry, because an OG crawler caches what it fetches for
 * days and a presigned URL would 403 in every cached copy. `FolderFile` has no
 * `isPrivate` column at all, so a file is *always* presigned. Restating either
 * policy here would give the repository a second copy that drifts — which is
 * exactly what `AttachmentService.getDownloadRef` did until PR 5c collapsed its
 * two `await import('./…-service')` bodies onto these same two calls.
 *
 * ## The pinned branch still uses `StorageManager`, deliberately
 *
 * It addresses a `StorageLocation` by id, and `storage/location-queries.ts` is
 * organization-scoped while `StorageLocation.organizationId` is **nullable** —
 * so routing it through `FilesDeps.storage` would make every pre-backfill row
 * undownloadable. See `attachments/ports.ts` for the full argument. This looks
 * like an inconsistency and is a deliberately preserved one.
 */

import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { BadRequestError } from '../../errors'
import type { DownloadRef } from '../adapters/base-adapter'
import { getAssetDownloadRef } from '../assets/download'
import type { FileDownloadInfo } from '../core/types'
import type { FilesCtx, FilesDeps } from '../ctx'
import { getFolderFileDownloadRef } from '../folder-files/download'
import { guard, unwrap } from '../guard'
import type { ResolvedAttachmentVersion } from './attachment-queries'
import { requireResolvedVersion } from './attachment-queries'
import type { LocationDownloadPort } from './ports'

/**
 * The collaborators this read needs.
 *
 * `storage` and `now` are what the two delegated library downloads take —
 * `folder-files/download.ts` reads the clock for its legacy `expiresAt`
 * fallback. `locations` is the pinned branch's port.
 *
 * Deliberately a narrowed slice of {@link FilesDeps} plus one extra field rather
 * than the whole bundle, per `files/ctx.ts`: a caller holding a real `FilesDeps`
 * spreads it in unchanged, but the signature states that this function cannot
 * enqueue a job or bust a cache.
 */
export type AttachmentDownloadDeps = Pick<FilesDeps, 'storage' | 'now'> & {
  locations: LocationDownloadPort
}

/** Knobs for {@link getAttachmentDownloadRef}. */
export interface GetAttachmentDownloadRefOptions {
  /** How the browser should treat the response. Defaults to the provider's own default. */
  disposition?: 'inline' | 'attachment'
  /** Presigned-URL lifetime. */
  ttlSec?: number
}

/**
 * Resolve one attachment to a {@link DownloadRef}. Callers read `.url` off the
 * result.
 *
 * Replaces `AttachmentService.getDownloadRef` and — by composition —
 * `.getDownloadUrl`, which was `ref.type === 'url' ? ref.url : throw`. It is not
 * given a function of its own here for the same reason `folder-files/` did not
 * give one to `FileService.getDownloadUrl`: a one-line narrowing is not worth a
 * second exported name.
 *
 * **There is no version selector.** The attachment row already carries the
 * answer: a pinned attachment names its version, and an unpinned one means
 * "whatever is current", which is the library's own default. Adding
 * `{ version }` here would let a caller ask for version 3 of an attachment
 * pinned to version 1, and there is no defensible answer to that question.
 *
 * @param ctx Scope. `ctx.db` may be a pool or a transaction; this never opens one.
 * @param deps Storage, clock, and the location port — see {@link AttachmentDownloadDeps}.
 * @param attachmentId Attachment to resolve, interpreted within `ctx.organizationId`.
 * @param opts Presign knobs, threaded to whichever branch runs.
 * @returns `err(NotFoundError)` when the attachment is missing in this org;
 *   `err(BadRequestError)` when the row references neither library or its target
 *   has no storage location; `err(AuxxError)` when a row cannot name its bucket.
 */
export async function getAttachmentDownloadRef(
  ctx: FilesCtx,
  deps: AttachmentDownloadDeps,
  attachmentId: string,
  opts: GetAttachmentDownloadRefOptions = {}
): Promise<Result<DownloadRef, AuxxError>> {
  return guard(
    async () => {
      const resolved = await requireResolvedVersion(ctx, attachmentId)
      return resolveAttachmentDownloadRef(ctx, deps, resolved, opts)
    },
    'Failed to resolve attachment download ref',
    { attachmentId, organizationId: ctx.organizationId }
  )
}

/**
 * Everything about an attachment a download response needs: the ref, plus the
 * filename, mime type and size to stamp on it.
 *
 * Replaces `AttachmentService.getDownloadInfo`, and **resolves the attachment
 * once**. The facade resolved it twice — its body called `resolveVersion(id)`
 * for the metadata and then `getDownloadRef(id)`, which resolved the whole thing
 * again — so this halves the reads on that path. The seam below is what makes
 * that possible.
 *
 * **The filename is `title || 'attachment'`, and that is not a regression.** The
 * legacy expression was `attachment.title || version.name || 'attachment'`, but
 * `version` was typed `any` and none of the four projections behind it ever
 * selected a `name` column, so the middle term was always `undefined`.
 * `ResolvedAttachmentVersion` refuses to compile the dead read, which is how it
 * surfaced.
 */
export async function getAttachmentDownloadInfo(
  ctx: FilesCtx,
  deps: AttachmentDownloadDeps,
  attachmentId: string,
  opts: GetAttachmentDownloadRefOptions = {}
): Promise<Result<FileDownloadInfo, AuxxError>> {
  return guard(
    async () => {
      const resolved = await requireResolvedVersion(ctx, attachmentId)
      const ref = await resolveAttachmentDownloadRef(ctx, deps, resolved, opts)
      return {
        kind: ref.type,
        url: ref.type === 'url' ? ref.url : undefined,
        filename: resolved.attachment.title || 'attachment',
        mimeType: resolved.mimeType || undefined,
        size: resolved.size || undefined,
        expiresAt: ref.type === 'url' ? ref.expiresAt : undefined,
      } satisfies FileDownloadInfo
    },
    'Failed to resolve attachment download info',
    { attachmentId, organizationId: ctx.organizationId }
  )
}

/**
 * The branch seam of {@link getAttachmentDownloadRef}: a resolved attachment in,
 * a {@link DownloadRef} out, with the attachment lookup already done.
 *
 * Exported for the same reason `resolveAssetDownloadRef` and
 * `resolveFolderFileDownloadRef` are — a caller that has already resolved its
 * rows must be able to reuse the download policy without paying for the
 * resolution again. It is a weaker seam than theirs by necessity: the two
 * unpinned branches ask the owning library which version is current, so this
 * still takes a `ctx`. What it removes is the re-read of the attachment and its
 * version, which is precisely the duplicated work the legacy `getDownloadInfo`
 * did on every call.
 *
 * Throws rather than returning `Result`: it is a helper, and its callers are
 * already inside a {@link guard}.
 *
 * @throws {BadRequestError} when `resolved` names neither library.
 * @throws {NotFoundError} when the target row or its storage location is gone.
 */
export async function resolveAttachmentDownloadRef(
  ctx: FilesCtx,
  deps: AttachmentDownloadDeps,
  resolved: ResolvedAttachmentVersion,
  opts: GetAttachmentDownloadRefOptions = {}
): Promise<DownloadRef> {
  const { attachment } = resolved

  if (resolved.isPinned) {
    return deps.locations.getDownloadRef({
      locationId: resolved.storageLocationId,
      filename: attachment.title || undefined,
      mimeType: resolved.mimeType || undefined,
      ttlSec: opts.ttlSec,
      disposition: opts.disposition,
    })
  }

  if (attachment.fileId) {
    return unwrap(await getFolderFileDownloadRef(ctx, deps, attachment.fileId, opts))
  }
  if (attachment.assetId) {
    return unwrap(await getAssetDownloadRef(ctx, deps, attachment.assetId, opts))
  }

  // Unreachable through `getAttachmentDownloadRef` — `requireResolvedVersion`
  // throws the same error first — but reachable for a batch caller that built
  // its own `ResolvedAttachmentVersion`, so the guard stays.
  throw new BadRequestError('Attachment has no valid file or asset reference')
}
