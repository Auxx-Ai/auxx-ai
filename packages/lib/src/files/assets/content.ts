// packages/lib/src/files/assets/content.ts

/**
 * Reading the **bytes** behind a `MediaAsset`.
 *
 * The content twin of `assets/download.ts`: that module answers "what URL can a
 * browser fetch", this one answers "give me the object". Together they replace
 * every content path `MediaAssetService` had — `getContent`, `streamContent`,
 * and the `StorageManager.getContent(locationId)` hop underneath both.
 *
 * ## Why this took four attempts to land
 *
 * PRs 5a, 5b and 5c each deferred `getContent`, every time recording the reason
 * as *"`StoragePort` is S3-only while `StorageManager.getContent` dispatches per
 * provider, so moving it is a behaviour change."* **That reason was false.**
 * `files/adapters/` contains exactly `base-adapter.ts` and `s3-adapter.ts`, and
 * `StorageManager.validateStorageParams` rejects every provider without an
 * adapter — which is everything except `'S3'`. The per-provider dispatch
 * resolves to S3 in every call that can succeed, so there was no dispatch to
 * preserve.
 *
 * The real blocker was narrower: `StorageManager.getContent` is addressed by
 * `storageLocationId`, so it reads a database row *and* touches storage, and the
 * row's `metadata` blob **can** carry `region` and `endpoint` — which
 * `S3Adapter.parseS3Location` spreads into the `S3Config` that
 * `createS3Client` reads, and which the bucket/key-only {@link StoragePort}
 * parameter types do not model. Routing content through the port would silently
 * drop them if anything set them.
 *
 * ## Nothing sets them — measured, not assumed
 *
 * - There are exactly **two** `INSERT` sites for `StorageLocation`
 *   (`storage/locations.ts` and `users/user-avatar-service.ts`). Neither writes
 *   `region` or `endpoint`, and `normalizeLocationMetadata` only ever adds
 *   `bucket` and `key` over whatever the caller passed.
 * - No caller of `createStorageLocation` / `StorageManager.uploadContent` passes
 *   either key, and no data migration or seeder writes one.
 * - Against the development database, the complete key set across all 33,290
 *   `StorageLocation` rows is `{bucket, key, etag, userId, orgId, preset,
 *   originalFileName, originalSize, uploader, sessionId, originalEtag,
 *   shareToken, source, endUserId, nodeId}` — **zero** rows carrying `region`
 *   or `endpoint`, and every row `provider = 'S3'`.
 * - `S3Adapter` resolves both from **provider auth** (`resolvePlatformAuth`
 *   reads `S3_REGION` / `S3_ENDPOINT` from config) or from `configService`, and
 *   `createS3StoragePort` resolves that same auth through `storage/auth.ts`. So
 *   the values the client is actually built with are unchanged by going through
 *   the port.
 *
 * The port's `bucket` + `key` is therefore sufficient, and
 * {@link StoragePort} needs no new parameters. If a future S3-compatible
 * provider ever needs a per-row endpoint, it belongs on `ExternalUrlParams` and
 * `ObjectRef` as an explicit field, never as a re-widened `metadata` passthrough.
 *
 * ## The bucket still comes off the row, never from config
 *
 * {@link requireLocationBucket} throws for a row that cannot name its bucket.
 * That is not defensiveness: S3 answers `204 No Content` for a delete aimed at a
 * key that was never in the bucket you named (#1816/#1817/#1818), so a guessed
 * bucket fails silently and later. A 500 naming the row is strictly better.
 */

import type { MediaAssetEntity } from '@auxx/database/types'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { NotFoundError } from '../../errors'
import type { FilesCtx, FilesDeps } from '../ctx'
import { guard, unwrap } from '../guard'
import { requireLocationBucket } from '../storage/buckets'
import { getObject, streamObject } from '../storage/objects'
import type { GetObjectParams, StoragePort } from '../storage/ports'
import type { AssetVersionAddress } from './asset-queries'
import { requireAsset, resolveAssetVersion } from './asset-queries'
import type { VersionWithLocation } from './download'

/**
 * The collaborators a content read needs — storage, and nothing else.
 *
 * A `Pick` of {@link FilesDeps} rather than the bundle, per `files/ctx.ts`: the
 * signature states that this cannot enqueue a job, bust a cache, or read the
 * clock, and a caller holding a real `FilesDeps` still passes it unchanged.
 */
export type AssetContentDeps = Pick<FilesDeps, 'storage'>

/**
 * Which version's bytes to read. The same address {@link getAssetDownloadRef}
 * accepts, so a caller cannot ask the two for different versions by accident.
 */
export type GetAssetContentOptions = AssetVersionAddress

/**
 * The database-free seam: an asset + version in, the object address out.
 *
 * **Pure.** No `ctx`, no `deps`, no I/O — which is what lets both
 * {@link getAssetContent} and {@link streamAssetContent} share one bucket
 * resolution, and lets a batch caller that has already loaded its rows address
 * many objects without re-reading a single one. It is the content-side
 * counterpart of `resolveAssetDownloadRef`, and it is *smaller* than that one
 * on purpose: there is no public-URL shortcut to apply here, because a durable
 * `externalUrl` is a browser affordance and says nothing about how the server
 * reads the bytes.
 *
 * Throws rather than returning `Result`: it is a helper, and its callers are
 * already inside a {@link guard}.
 *
 * @param asset The asset the caller has already loaded, org-scoped.
 * @param version That asset's version, with `storageLocation` joined in.
 * @throws {NotFoundError} when the version has no usable storage location.
 * @throws {AuxxError} when the storage location cannot name its bucket.
 */
export function resolveAssetObjectRef(
  asset: MediaAssetEntity,
  version: VersionWithLocation
): GetObjectParams {
  const location = version.storageLocation
  if (!version.storageLocationId || !location) {
    throw new NotFoundError(`No storage location found for asset ${asset.id}`)
  }

  return {
    provider: location.provider,
    bucket: requireLocationBucket(location, { assetId: asset.id }),
    key: location.externalId,
    credentialId: location.credentialId ?? undefined,
  }
}

/**
 * Read one asset's bytes into memory.
 *
 * Replaces `MediaAssetService.getContent(id)` — and the
 * `StorageManager.getContent(locationId)` hop it delegated to, which did its own
 * **unscoped** `StorageLocation` read behind the caller's back. Here the asset
 * and its version are resolved org-scoped first, and the location arrives
 * joined onto the version, so there is no second lookup to get wrong.
 *
 * Buffers the whole object. Use {@link streamAssetContent} for anything being
 * forwarded to a response body rather than parsed, hashed or re-encoded.
 *
 * **`MediaAssetVersion.deletedAt` is deliberately not filtered.** Neither the
 * legacy path nor `assets/download.ts` filters it, and whether it should is the
 * open question in `plans/attachments/05-core-services.md` §5.6.1. Changing it
 * here would be a behaviour change smuggled into an extraction.
 *
 * @param ctx Scope. `ctx.db` may be a pool or a transaction; this never opens one.
 * @param deps Storage only — see {@link AssetContentDeps}.
 * @param assetId Asset to read, interpreted within `ctx.organizationId`.
 * @param opts Which version. Defaults to `'current'`.
 * @returns `err(NotFoundError)` when the asset, version, or storage location is
 *   missing in this org; `err(AuxxError)` when the row cannot name its bucket or
 *   the provider read fails.
 */
export async function getAssetContent(
  ctx: FilesCtx,
  deps: AssetContentDeps,
  assetId: string,
  opts: GetAssetContentOptions = {}
): Promise<Result<Buffer, AuxxError>> {
  return guard(
    async () => readAssetObject(ctx, deps.storage, assetId, opts, getObject),
    'Failed to read asset content',
    {
      assetId,
      version: opts.version,
      versionId: opts.versionId,
      organizationId: ctx.organizationId,
    }
  )
}

/**
 * Open a read stream over one asset's bytes.
 *
 * Replaces `MediaAssetService.streamContent(id)`, which **never worked**: its
 * body called `storageManager.streamContent(...)`, a method `StorageManager`
 * does not have (it is `streamFileContent`), through a `Promise<any>` accessor
 * that hid the mistake from the compiler. It had no callers, so the throw was
 * never reached.
 *
 * There is no range parameter, matching {@link StoragePort}:
 * `StorageManager.streamFileContent` accepted one, logged
 * `'Range support not yet implemented'` and returned the full stream anyway. A
 * silently ignored parameter is worse than an absent one.
 *
 * @param ctx Scope. `ctx.db` may be a pool or a transaction; this never opens one.
 * @param deps Storage only — see {@link AssetContentDeps}.
 * @param assetId Asset to read, interpreted within `ctx.organizationId`.
 * @param opts Which version. Defaults to `'current'`.
 */
export async function streamAssetContent(
  ctx: FilesCtx,
  deps: AssetContentDeps,
  assetId: string,
  opts: GetAssetContentOptions = {}
): Promise<Result<NodeJS.ReadableStream, AuxxError>> {
  return guard(
    async () => readAssetObject(ctx, deps.storage, assetId, opts, streamObject),
    'Failed to open asset content stream',
    {
      assetId,
      version: opts.version,
      versionId: opts.versionId,
      organizationId: ctx.organizationId,
    }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * The shared body of the two reads above: resolve the asset, resolve the
 * version, address the object, hand it to `read`.
 *
 * `read` is the `storage/objects.ts` function rather than the port method
 * directly, because those wrap the call in `storageGuard` — which maps
 * `StorageFileNotFoundError` to a 404 and `StorageAuthError` to a 401 instead of
 * letting the plain `files/guard.ts` flatten both to `Internal error`.
 */
async function readAssetObject<T>(
  ctx: FilesCtx,
  storage: StoragePort,
  assetId: string,
  opts: GetAssetContentOptions,
  read: (port: StoragePort, p: GetObjectParams) => Promise<Result<T, AuxxError>>
): Promise<T> {
  const asset = await requireAsset(ctx, assetId)
  const version = await resolveAssetVersion(ctx, asset, opts)
  return unwrap(await read(storage, resolveAssetObjectRef(asset, version)))
}
