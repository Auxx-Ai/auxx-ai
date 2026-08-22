// packages/lib/src/files/storage/buckets.ts

/**
 * Bucket routing and public-URL formatting — the pure half of the storage layer.
 *
 * Everything here is data in, string out: it reads `configService` and formats
 * a URL. No database, no adapter, no credential fetch, no `Promise`. That is
 * deliberate and it is the point of the file:
 *
 * - **Zero mocks to test.** These four functions used to live on `S3Adapter`
 *   and in `upload/util.ts`, reachable only by constructing an adapter or a
 *   `StorageManager`. As free functions they are a table-driven test.
 * - **`buildExternalUrl` is synchronous.** It is called *inside* the open
 *   `db.transaction` on the upload-complete path. The async version it replaces
 *   (`StorageManager.buildExternalUrl`) could reach `getProviderAuth()` →
 *   `revealSecrets()` — a database read plus a decrypt — while holding a write
 *   transaction open, purely to learn a bucket the caller already knew. The
 *   sync signature forecloses that; a caller that genuinely needs a
 *   credential-derived `region` resolves it *before* opening the transaction
 *   and passes it in. Same contract as {@link StoragePort.buildExternalUrl}.
 *
 * ## Visibility is a strict union, not a `string`
 *
 * {@link StorageVisibility} exists because `BaseAssetProcessor` declared
 * `fileVisibility: string` and cast it at the one call site
 * (`this.fileVisibility as 'PUBLIC' | 'PRIVATE'`). `DatasetAssetProcessor`
 * therefore compiled with lowercase `'private'`, which matched neither branch:
 * dataset uploads routed to the *public* bucket and `isAssetPrivate()` — a
 * `=== 'PRIVATE'` comparison — answered `false`. A named union on the field
 * turns both of those into compile errors.
 */

import { configService } from '@auxx/credentials'
import { BadRequestError } from '../../errors'
import type { ProviderId } from '../adapters/base-adapter'

/**
 * Which of the platform's two buckets an object belongs in.
 *
 * Uppercase, matching the `FileVisibility` database enum and
 * `UploadPreparedConfig.visibility`. The lowercase `'public' | 'private'` in
 * `upload/types.ts` is a *request* vocabulary and never reaches this module —
 * `toStorageVisibility` maps it.
 */
export type StorageVisibility = 'PUBLIC' | 'PRIVATE'

/** Everything needed to render an object's public URL. */
export interface ExternalUrlInput {
  provider: ProviderId
  /** The object key. Returned unchanged for providers that have no URL form. */
  key: string
  /** The bucket the object actually lives in. Wins over `visibility`. */
  bucket?: string
  /** Used to pick a bucket only when `bucket` is absent. */
  visibility?: StorageVisibility
  /**
   * Supplied by the caller — which has already read the `StorageLocation` row
   * — rather than fetched from a credential. That is what keeps this function
   * synchronous. Falls back to `S3_REGION`.
   */
  region?: string
}

/** Region used when neither the caller nor `S3_REGION` supplies one. */
const DEFAULT_REGION = 'us-west-1'

/**
 * The configured bucket for a visibility.
 *
 * Returns `''` when the bucket is not configured, matching the behaviour of the
 * `getBucketForVisibility` it replaces: callers treat the empty string as
 * "unknown" and fall through to their own resolution. Use {@link assertBucket}
 * at the point where a bucket stops being optional.
 */
export function bucketForVisibility(visibility: StorageVisibility): string {
  const key = visibility === 'PUBLIC' ? 'S3_PUBLIC_BUCKET' : 'S3_PRIVATE_BUCKET'
  return configService.get<string>(key) || ''
}

/**
 * The public URL for an object in the public bucket.
 *
 * Prefers `CDN_URL`; otherwise renders a virtual-hosted-style S3 URL against
 * the public bucket.
 */
export function publicCdnUrl(storageKey: string): string {
  return buildExternalUrl({ provider: 'S3', key: storageKey, visibility: 'PUBLIC' })
}

/**
 * Render the external (public) URL for an object.
 *
 * Resolution order, unchanged from `S3Adapter.buildExternalUrl` +
 * `StorageManager.withResolvedS3Bucket` which it replaces:
 * `CDN_URL` → explicit `bucket` → `visibility`'s configured bucket →
 * `S3_PUBLIC_BUCKET` → the bare key.
 *
 * Non-bucket-addressed providers have no URL form here and get the key back,
 * which is what `StorageManager.buildExternalUrl` did for any adapter without a
 * `buildExternalUrl`.
 */
export function buildExternalUrl(p: ExternalUrlInput): string {
  const cdnUrl = configService.get<string>('CDN_URL')
  if (cdnUrl) return `${cdnUrl}/${p.key}`

  if (p.provider !== 'S3') return p.key

  const bucket =
    p.bucket ||
    (p.visibility ? bucketForVisibility(p.visibility) : '') ||
    configService.get<string>('S3_PUBLIC_BUCKET')

  if (!bucket) return p.key

  const region = p.region || configService.get<string>('S3_REGION') || DEFAULT_REGION
  return `https://${bucket}.s3.${region}.amazonaws.com/${p.key}`
}

/**
 * Require a bucket, naming the operation that needs one.
 *
 * The single replacement for the six near-identical "S3 bucket name is
 * required…" throws that used to sit behind an `S3_PRIVATE_BUCKET` fallback in
 * `S3Adapter`. Bugs #1816/#1817/#1818 were all that fallback: S3 answers
 * `204 No Content` for a delete of a key that is not in the bucket you named,
 * and `NoSuchUpload` for a part presigned against a bucket the upload did not
 * start in — so the wrong-bucket call succeeded and the real object leaked.
 *
 * @throws {BadRequestError} when no bucket was supplied.
 */
export function assertBucket(bucket: string | undefined, op: string): string {
  if (!bucket) {
    throw new BadRequestError(
      `${op} requires an explicit bucket. Pass the bucket the object lives in ` +
        '(the upload session `bucket`). Resolving a configured default instead is how a ' +
        'wrong-bucket delete 204s and a wrong-bucket part presign fails with NoSuchUpload.'
    )
  }
  return bucket
}
