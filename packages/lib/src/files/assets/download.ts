// packages/lib/src/files/assets/download.ts

/**
 * Resolving a `MediaAsset` to something a browser can fetch.
 *
 * This is the Phase-2 pilot: the first `files/` read written to the
 * {@link FilesCtx} contract, proving the seam works end to end before phases
 * 3-5 move the rest. `MediaAssetService.getDownloadRef` / `.getDownloadUrl`
 * delegate here; no call site moved.
 */

import type {
  MediaAssetEntity,
  MediaAssetVersionEntity,
  StorageLocationEntity,
} from '@auxx/database/types'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { NotFoundError } from '../../errors'
import type { DownloadRef } from '../adapters/base-adapter'
import type { FilesCtx, FilesDeps } from '../ctx'
import { guard } from '../guard'
import { requireLocationBucket } from '../storage/buckets'
import type { AssetVersionAddress } from './asset-queries'
import { requireAsset, resolveAssetVersion } from './asset-queries'

/**
 * The collaborators this read needs — storage, and nothing else.
 *
 * Deliberately a `Pick` of {@link FilesDeps} rather than the whole bundle. A
 * caller that already holds a `FilesDeps` passes it unchanged (structural
 * typing), but the signature still states the truth: this function cannot
 * enqueue a job, bust a cache, or read the clock. Widening it to `FilesDeps`
 * would make every caller of a pure read construct a queue port — i.e. bind a
 * live Redis connection — to presign a URL.
 */
export type DownloadDeps = Pick<FilesDeps, 'storage'>

/**
 * Which version to serve.
 *
 * Re-exported from `asset-queries.ts`, which is where the selector and its
 * resolution now live so that {@link getAssetDownloadRef} and
 * `getAssetContent` cannot drift about which bytes are "current".
 */
export type { AssetVersionSelector } from './asset-queries'

/** Knobs for {@link getAssetDownloadRef}. `disposition`/`ttlSec` reach only the presigned branch. */
export interface GetAssetDownloadRefOptions extends AssetVersionAddress {
  /** How the browser should treat the response. Ignored for durable public URLs. */
  disposition?: 'inline' | 'attachment'
  /** Presigned-URL lifetime. Ignored for durable public URLs, which never expire. */
  ttlSec?: number
}

/** A version row with its `StorageLocation` joined in, which is the only shape this read uses. */
export type VersionWithLocation = MediaAssetVersionEntity & {
  storageLocation: StorageLocationEntity | null
}

/**
 * Read the bucket off the `StorageLocation` row, and refuse to invent one.
 *
 * Delegates to the shared {@link requireLocationBucket} in `storage/buckets.ts`
 * so `folder-files/download.ts` cannot grow a second copy of the rule — the
 * bucket policy is one function, not one per library.
 */
function requireBucket(location: StorageLocationEntity, assetId: string): string {
  return requireLocationBucket(location, { assetId })
}

/**
 * Resolve one asset to a {@link DownloadRef} — the single download entry point
 * that replaces `getDownloadRef` / `getDownloadRefForVersion` / `getDownloadUrl`
 * / `getDownloadUrls` / `getDownloadInfo` / `downloadUrlFor`. Callers read
 * `.url` off the result.
 *
 * The public shortcut is the part worth not breaking: a non-private asset whose
 * `StorageLocation` carries an `externalUrl` returns that durable URL with no
 * expiry. OG-image and link-preview crawlers cache what they fetch for days, so
 * handing them a presigned URL means every cached copy 403s once the signature
 * lapses. Anything else is presigned through the {@link FilesDeps.storage}
 * port, with the bucket taken from the row rather than from config.
 *
 * `opts.version` accepts the same `number | 'latest' | 'current'` selector as
 * `getFolderFileDownloadRef`. Until it did, `getDownloadRefForVersion` had to
 * survive on the `MediaAssetService` facade purely to turn a version *number*
 * into a row id before calling this — and every consumer that wanted a numbered
 * version would otherwise have hand-rolled that resolution itself.
 *
 * @param ctx Scope. `ctx.db` may be a pool or a transaction; this function never opens one.
 * @param deps Storage only — see {@link DownloadDeps}.
 * @param assetId Asset to resolve, interpreted within `ctx.organizationId`.
 * @param opts Which version, and the presign knobs.
 * @returns `err(NotFoundError)` when the asset, version, or storage location is
 *   missing in this org; `err(AuxxError)` when the row cannot name its bucket.
 */
export async function getAssetDownloadRef(
  ctx: FilesCtx,
  deps: DownloadDeps,
  assetId: string,
  opts: GetAssetDownloadRefOptions = {}
): Promise<Result<DownloadRef, AuxxError>> {
  return guard(
    async () => {
      const asset = await requireAsset(ctx, assetId)
      const version = await resolveAssetVersion(ctx, asset, opts)
      return resolveAssetDownloadRef(deps, asset, version, opts)
    },
    'Failed to resolve asset download ref',
    {
      assetId,
      version: opts.version,
      versionId: opts.versionId,
      organizationId: ctx.organizationId,
    }
  )
}

/**
 * A {@link DownloadRef} plus the row metadata the preview pane needs.
 *
 * The exact shape `folder-files/download.ts` returns from
 * {@link ../folder-files/download.getFolderFileDownloadRef}, so
 * `fileRouter.getAttachmentPreviewRef` returns one contract whichever branch
 * ran. It was previously produced only by `MediaAssetService`'s
 * `getDownloadRefForVersion`, which is why that method was the last thing
 * keeping the facade alive.
 */
export type AssetDownloadRefWithMeta = DownloadRef & {
  filename: string
  mimeType?: string
  size?: number
  versionNumber: number
  expiresAt: Date
}

/**
 * How long a {@link AssetDownloadRefWithMeta} claims to be valid when the
 * underlying ref carries no expiry of its own.
 *
 * Same 10 minutes as `folder-files`' `DEFAULT_DOWNLOAD_TTL_MS` and as the
 * deleted facade's `LEGACY_PREVIEW_TTL_MS` — the preview pane refetches on this
 * value, so the two libraries must not disagree about it.
 */
export const DEFAULT_ASSET_DOWNLOAD_TTL_MS = 10 * 60 * 1000

/**
 * Resolve one asset to a {@link AssetDownloadRefWithMeta}.
 *
 * The metadata twin of {@link getAssetDownloadRef}: identical resolution, plus
 * the filename / mime / size / version number a preview surface renders. Prefer
 * the plain accessor when all you want is a URL — this one exists because the
 * asset and file branches of one tRPC procedure have to answer with the same
 * fields.
 *
 * **This is not a second copy of the version ladder.** It calls
 * {@link getAssetDownloadRef}'s own helpers (`requireAsset` +
 * `resolveAssetVersion`), so "which bytes are current" is still decided in
 * exactly one place — the mistake the legacy `getDownloadRefForVersion` made was
 * resolving a version *number* to a row itself and then handing the row id back
 * down, which read the asset twice.
 *
 * @param ctx Scope. `ctx.db` may be a pool or a transaction; this never opens one.
 * @param deps Storage, plus the clock the `expiresAt` fallback is measured from.
 * @param assetId Asset to resolve, interpreted within `ctx.organizationId`.
 * @param opts Which version, and the presign knobs.
 * @returns `err(NotFoundError)` when the asset, version, or storage location is
 *   missing in this org; `err(AuxxError)` when the row cannot name its bucket.
 */
export async function getAssetDownloadRefWithMeta(
  ctx: FilesCtx,
  deps: DownloadDeps & Pick<FilesDeps, 'now'>,
  assetId: string,
  opts: GetAssetDownloadRefOptions = {}
): Promise<Result<AssetDownloadRefWithMeta, AuxxError>> {
  return guard(
    async () => {
      const asset = await requireAsset(ctx, assetId)
      const version = await resolveAssetVersion(ctx, asset, opts)
      const ref = await resolveAssetDownloadRef(deps, asset, version, opts)

      const fallbackExpiry = new Date(deps.now().getTime() + DEFAULT_ASSET_DOWNLOAD_TTL_MS)
      return {
        ...ref,
        // The legacy fallback, kept verbatim: an asset row may carry no name.
        filename: asset.name || `${asset.kind.toLowerCase()}_${asset.id}`,
        mimeType: asset.mimeType ?? undefined,
        size: asset.size ?? undefined,
        versionNumber: version.versionNumber,
        expiresAt: ref.type === 'url' ? (ref.expiresAt ?? fallbackExpiry) : fallbackExpiry,
      }
    },
    'Failed to resolve asset download ref',
    {
      assetId,
      version: opts.version,
      versionId: opts.versionId,
      organizationId: ctx.organizationId,
    }
  )
}

/**
 * The database-free tail of {@link getAssetDownloadRef}: asset + version in,
 * {@link DownloadRef} out.
 *
 * Exported so a **batch** caller can keep its fixed number of round-trips. The
 * legacy service resolved many asset ids at once (`getDownloadUrls`, one query
 * for the assets and at most two for their versions) through a private
 * `downloadUrlFor(entity, version)` helper; without a seam like this, collapsing
 * that path onto `getAssetDownloadRef` would mean re-reading the asset and its
 * version once per id — turning three queries into 3N. The URL policy stays in
 * one place either way, which is the point of the collapse.
 *
 * Throws rather than returning `Result`: it is a helper, and its only callers
 * are already inside a {@link guard}.
 *
 * @param deps Storage only — see {@link DownloadDeps}.
 * @param asset The asset the caller has already loaded, org-scoped.
 * @param version That asset's version, with `storageLocation` joined in.
 * @param opts Presign knobs. Ignored for the durable public-URL branch.
 * @throws NotFoundError when the version has no usable storage location.
 * @throws AuxxError when the storage location cannot name its bucket.
 */
export async function resolveAssetDownloadRef(
  deps: DownloadDeps,
  asset: MediaAssetEntity,
  version: VersionWithLocation,
  opts: Pick<GetAssetDownloadRefOptions, 'disposition' | 'ttlSec'> = {}
): Promise<DownloadRef> {
  const location = version.storageLocation
  if (!version.storageLocationId || !location) {
    throw new NotFoundError(`No storage location found for asset ${asset.id}`)
  }

  // Durable public URL: no signature, so no expiry to outlive.
  if (!asset.isPrivate && location.externalUrl) {
    return { type: 'url', url: location.externalUrl } satisfies DownloadRef
  }

  return deps.storage.presignDownload({
    provider: location.provider,
    bucket: requireBucket(location, asset.id),
    key: location.externalId,
    credentialId: location.credentialId ?? undefined,
    ttlSec: opts.ttlSec,
    disposition: opts.disposition,
    filename: asset.name ?? undefined,
    mimeType: asset.mimeType ?? undefined,
  })
}
