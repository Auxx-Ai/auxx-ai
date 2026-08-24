// packages/lib/src/files/assets/download.ts

/**
 * Resolving a `MediaAsset` to something a browser can fetch.
 *
 * This is the Phase-2 pilot: the first `files/` read written to the
 * {@link FilesCtx} contract, proving the seam works end to end before phases
 * 3-5 move the rest. `MediaAssetService.getDownloadRef` / `.getDownloadUrl`
 * delegate here; no call site moved.
 */

import { schema } from '@auxx/database'
import type {
  MediaAssetEntity,
  MediaAssetVersionEntity,
  StorageLocationEntity,
} from '@auxx/database/types'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { NotFoundError } from '../../errors'
import type { DownloadRef } from '../adapters/base-adapter'
import type { FilesCtx, FilesDeps } from '../ctx'
import { guard } from '../guard'
import { requireLocationBucket } from '../storage/buckets'

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

/** Knobs for {@link getAssetDownloadRef}. `disposition`/`ttlSec` reach only the presigned branch. */
export interface GetAssetDownloadRefOptions {
  /** Target a specific version instead of the asset's current one. */
  versionId?: string
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
 * Load the asset, scoped to the caller's org and to live rows.
 *
 * Both filters are load-bearing. Dropping the org filter turns a 404 into a
 * cross-tenant read; dropping `deletedAt IS NULL` hands out a presigned URL for
 * an object the purge job may already have removed. The old service applied
 * them inconsistently across its six download entry points — this is the one
 * place that decides now.
 */
async function loadAsset(ctx: FilesCtx, assetId: string): Promise<MediaAssetEntity> {
  const asset = (await ctx.db.query.MediaAsset.findFirst({
    where: and(
      eq(schema.MediaAsset.id, assetId),
      eq(schema.MediaAsset.organizationId, ctx.organizationId),
      isNull(schema.MediaAsset.deletedAt)
    ),
  })) as MediaAssetEntity | undefined

  // Same error for "does not exist" and "belongs to another org": the caller
  // must not be able to probe for ids outside its tenant.
  if (!asset) throw new NotFoundError(`Asset ${assetId} not found`)
  return asset
}

/**
 * Resolve which version to serve.
 *
 * An explicit `versionId` is always additionally constrained by `assetId`, so a
 * version id belonging to a different asset (possibly another org's) cannot be
 * served through an asset the caller can see.
 */
async function resolveVersion(
  ctx: FilesCtx,
  asset: MediaAssetEntity,
  versionId?: string
): Promise<VersionWithLocation> {
  const where = versionId
    ? and(
        eq(schema.MediaAssetVersion.id, versionId),
        eq(schema.MediaAssetVersion.assetId, asset.id)
      )
    : asset.currentVersionId
      ? and(
          eq(schema.MediaAssetVersion.id, asset.currentVersionId),
          eq(schema.MediaAssetVersion.assetId, asset.id)
        )
      : eq(schema.MediaAssetVersion.assetId, asset.id)

  const version = (await ctx.db.query.MediaAssetVersion.findFirst({
    where,
    // Only meaningful for the no-`currentVersionId` fallback; harmless otherwise.
    orderBy: desc(schema.MediaAssetVersion.versionNumber),
    with: { storageLocation: true },
  })) as VersionWithLocation | undefined

  if (!version) {
    throw new NotFoundError(
      versionId
        ? `Version ${versionId} not found for asset ${asset.id}`
        : `No version found for asset ${asset.id}`
    )
  }
  return version
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
 * @param ctx Scope. `ctx.db` may be a pool or a transaction; this function never opens one.
 * @param deps Storage only — see {@link DownloadDeps}.
 * @param assetId Asset to resolve, interpreted within `ctx.organizationId`.
 * @param opts Optional version target and presign knobs.
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
      const asset = await loadAsset(ctx, assetId)
      const version = await resolveVersion(ctx, asset, opts.versionId)
      return resolveAssetDownloadRef(deps, asset, version, opts)
    },
    'Failed to resolve asset download ref',
    { assetId, versionId: opts.versionId, organizationId: ctx.organizationId }
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
