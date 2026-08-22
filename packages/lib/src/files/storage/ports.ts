// packages/lib/src/files/storage/ports.ts

/**
 * The side-effecting seams of `files/`, expressed as interfaces.
 *
 * Every port here is something a `files/` function used to *construct* for
 * itself (`new StorageManager()`, `getQueue(Queues.thumbnailQueue)`), which is
 * why nothing in this subsystem could be tested without `vi.mock`. They arrive
 * as {@link FilesDeps} instead, so a test supplies a plain object literal and a
 * production caller supplies the wiring below.
 *
 * ## `bucket` is required, everywhere it can be known
 *
 * Every parameter type that addresses an object carries a **required**
 * `bucket`. This is not tidiness. Bugs #1816/#1817/#1818 all had the same
 * shape: `bucket` was optional, the call site omitted it, and the resolver fell
 * back to `S3_PRIVATE_BUCKET`. S3 answers `204 No Content` for a delete of a key
 * that is not in the bucket you named, and `NoSuchUpload` for a part presigned
 * against the wrong bucket — so a PUBLIC upload's object leaked with no error
 * anywhere. An optional `bucket` on a port method is a regression.
 */

import { revealSecrets } from '@auxx/credentials/store'
import { BadRequestError, UnauthorizedError } from '../../errors'
import type { OrphanedStorageObjectJobData } from '../../jobs/maintenance/orphaned-storage-object-job'
import type {
  DownloadRef,
  FileMetadata,
  PresignedUpload,
  ProviderAuth,
  ProviderId,
  StorageLocationRef,
} from '../adapters/base-adapter'
import { S3Adapter } from '../adapters/s3-adapter'
import type { GenerateThumbnailPayload } from '../core/thumbnail-types'
import type { UploadPreparedConfig } from '../upload/init-types'
import { createStorageManager } from './storage-manager'

// ============= Parameter types =============

/**
 * Addresses exactly one object in a bucket-addressed provider.
 *
 * The base of every object-identifying param type, so `bucket` cannot be
 * forgotten on a new one. `credentialId` stays optional because platform
 * storage has none — the adapter resolves it from config instead.
 */
export interface ObjectRef {
  provider: ProviderId
  /** Required: a wrong-bucket delete 204s and a wrong-bucket part presign fails. */
  bucket: string
  key: string
  credentialId?: string
}

/**
 * The full prepared upload config, because presigning is where the upload
 * policy is enforced (key prefix, TTL ceiling, size range, mime allow-list).
 *
 * Deliberately not an {@link ObjectRef}: `UploadPreparedConfig` already carries
 * `provider`, a required `bucket`, and the key under its own name
 * (`storageKey`), and re-shaping it here would mean two vocabularies for one
 * object. The pure `buildUploadConfig` produces this value; the port consumes
 * it unchanged.
 */
export type PresignUploadParams = UploadPreparedConfig & {
  /** Extra S3 object metadata, merged over the org/uploader/entity trio. */
  metadata?: Record<string, string>
}

/** One part of an in-flight multipart upload. `bucket` must be the bucket the upload was started in. */
export interface PresignPartParams extends ObjectRef {
  uploadId: string
  partNumber: number
  size?: number
}

/** Finalises a multipart upload. `bucket` must be the bucket the upload was started in. */
export interface CompleteMultipartParams extends ObjectRef {
  uploadId: string
  parts: Array<{ partNumber: number; etag: string }>
}

/** Metadata probe. `versionId` targets a specific object version where the provider has them. */
export interface HeadParams extends ObjectRef {
  versionId?: string
}

/** Provider-neutral object metadata. Aliased so call sites read as storage, not adapter, vocabulary. */
export type HeadResult = FileMetadata

/** Server-side write of content the server itself produced (thumbnails, generated PDFs). */
export interface PutObjectParams extends ObjectRef {
  content: Buffer | NodeJS.ReadableStream
  mimeType?: string
  size?: number
  metadata?: Record<string, string>
}

/** What the provider reports back about a written object. */
export interface PutResult {
  etag?: string
  versionId?: string
  size?: number
}

/** Server-side read, whole-object. `versionId` targets a specific object version. */
export interface GetObjectParams extends ObjectRef {
  versionId?: string
}

/**
 * Compensation / lifecycle delete.
 *
 * No `versionId`: the underlying `deleteByKey` path addresses the current
 * object only, and a silently-ignored `versionId` would be worse than not
 * offering one.
 */
export type DeleteParams = ObjectRef

/** Presigned client download, with the disposition the browser should honour. */
export interface DownloadParams extends ObjectRef {
  versionId?: string
  ttlSec?: number
  disposition?: 'inline' | 'attachment'
  filename?: string
  mimeType?: string
}

/**
 * Everything needed to render a public URL for an object.
 *
 * `region` is optional and exists so the caller — which has already read the
 * `StorageLocation` row — can supply it instead of the port going and fetching
 * a credential. That is what keeps {@link StoragePort.buildExternalUrl}
 * synchronous.
 */
export interface ExternalUrlParams {
  provider: ProviderId
  bucket: string
  key: string
  region?: string
}

/** The thumbnail queue's job payload, reused verbatim so the port cannot drift from the worker. */
export type EnqueueThumbnailParams = GenerateThumbnailPayload

/** The orphaned-object cleanup job payload, with `bucket` promoted to required. */
export type EnqueueStorageCleanupParams = Omit<OrphanedStorageObjectJobData, 'bucket'> & {
  /** Required here even though the job accepts it optionally: see the file header. */
  bucket: string
}

// ============= Ports =============

/**
 * Object storage, addressed by bucket + key. Knows nothing about the database.
 *
 * Every method is bucket/key-addressed rather than `storageLocationId`-addressed
 * (which is how `StorageManager` mostly reads today) precisely so this port
 * cannot do a database read behind the caller's back. Resolving a
 * `StorageLocation` row into a bucket and key is the caller's job, on `ctx.db`.
 */
export interface StoragePort {
  presignUpload(p: PresignUploadParams): Promise<PresignedUpload>
  presignPart(p: PresignPartParams): Promise<PresignedUpload>
  completeMultipart(p: CompleteMultipartParams): Promise<{ etag: string; size?: number }>
  head(p: HeadParams): Promise<HeadResult>
  putObject(p: PutObjectParams): Promise<PutResult>
  getObject(p: GetObjectParams): Promise<Buffer>
  streamObject(p: GetObjectParams): Promise<NodeJS.ReadableStream>
  deleteObject(p: DeleteParams): Promise<void>
  presignDownload(p: DownloadParams): Promise<DownloadRef>
  /**
   * Synchronous on purpose.
   *
   * This is called **inside** an open `db.transaction` on the upload-complete
   * path. A `Promise`-returning version invites an adapter lookup or a
   * credential fetch there, which is network I/O holding a write transaction
   * open. For S3 it is pure string work over config (`CDN_URL`, else
   * virtual-hosted style), so the sync signature costs nothing and forecloses
   * the mistake. A future adapter that genuinely needs I/O must expose its own
   * async method, and the caller resolves it *before* opening the transaction.
   */
  buildExternalUrl(p: ExternalUrlParams): string
}

/**
 * Background work, so a function that needs a job enqueued does not reach for
 * `getQueue(...)` and bind itself to a live Redis connection.
 *
 * Both methods return the job id, which is what lets a test assert *which* job
 * was scheduled without a queue running.
 */
export interface QueuePort {
  enqueueThumbnail(p: EnqueueThumbnailParams): Promise<string>
  enqueueStorageCleanup(p: EnqueueStorageCleanupParams): Promise<string>
}

/**
 * Post-commit invalidation and realtime notification.
 *
 * Intentionally one stringly-typed method rather than a per-event surface: the
 * ports exist to make ordering assertable ("no bust between BEGIN and COMMIT"),
 * not to type the event catalogue, which lives with the events module.
 */
export interface CachePort {
  bust(event: string, payload: Record<string, unknown>): Promise<void>
}

// ============= Production implementation =============

/**
 * The S3 {@link StoragePort}, wired to the existing adapter and
 * `StorageManager`.
 *
 * This is the proof the interface is implementable against real code rather
 * than a shape invented for tests. It delegates rather than reimplements:
 *
 * - Policy-enforcing upload operations go through `StorageManager`, because the
 *   policy check (`enforcePolicy`) lives there and must not be bypassed.
 * - `deleteObject` goes through `StorageManager.deleteByKey`, because that is
 *   where the "no bucket supplied" fallback is logged.
 * - Object reads/writes go straight to the adapter, because every
 *   `StorageManager` equivalent (`getFileMetadata`, `getContent`,
 *   `uploadContent`) is `storageLocationId`-addressed and does its own database
 *   work — exactly what this port must not do.
 *
 * @param organizationId Required only when a call passes a `credentialId`;
 *   platform storage resolves its auth from config and needs no org.
 */
export function createS3StoragePort(organizationId?: string): StoragePort {
  const manager = createStorageManager(organizationId)
  const adapter = new S3Adapter()

  /**
   * Resolve provider auth with the bucket pinned to the caller's choice.
   *
   * Pinning is the whole trick: the adapter's `parseS3Location`,
   * `createS3Client` and `buildExternalUrl` all read `auth.bucket`, and leaving
   * it to resolve from config is how objects ended up in — and deletes aimed
   * at — the wrong bucket.
   */
  async function resolveAuth(bucket: string, credentialId?: string): Promise<ProviderAuth> {
    if (credentialId) {
      if (!organizationId) {
        throw new BadRequestError(
          `credentialId '${credentialId}' was supplied but the storage port has no organizationId`
        )
      }
      const revealed = await revealSecrets(credentialId, organizationId)
      if (revealed.isErr()) {
        throw new UnauthorizedError(
          `Failed to load S3 credential '${credentialId}': ${revealed.error.message}`
        )
      }
      const { record, secrets } = revealed.value
      return { ...record.metadata, ...secrets, bucket } as ProviderAuth
    }

    const platformAuth = adapter.resolvePlatformAuth()
    if (!platformAuth) {
      throw new BadRequestError(
        'S3 platform storage is not configured (set S3_REGION and S3_PRIVATE_BUCKET) and no credentialId was supplied'
      )
    }
    return { ...platformAuth, bucket }
  }

  /** Build the adapter's location shape with the bucket on metadata, where the adapter looks for it. */
  function locationRef(p: ObjectRef & { versionId?: string }): StorageLocationRef {
    return {
      provider: p.provider,
      externalId: p.key,
      credentialId: p.credentialId,
      metadata: { bucket: p.bucket, key: p.key, ...(p.versionId && { versionId: p.versionId }) },
    }
  }

  return {
    presignUpload: (p) => manager.generatePresignedUploadUrl(p),

    presignPart: (p) =>
      manager.generatePartUploadUrl({
        provider: p.provider,
        key: p.key,
        uploadId: p.uploadId,
        partNumber: p.partNumber,
        size: p.size,
        credentialId: p.credentialId,
        bucket: p.bucket,
      }),

    completeMultipart: (p) =>
      manager.completeMultipartUploadOnly({
        provider: p.provider,
        key: p.key,
        uploadId: p.uploadId,
        parts: p.parts,
        credentialId: p.credentialId,
        bucket: p.bucket,
      }),

    deleteObject: (p) =>
      manager.deleteByKey({
        provider: p.provider,
        key: p.key,
        credentialId: p.credentialId,
        bucket: p.bucket,
      }),

    head: async (p) => adapter.getMeta(locationRef(p), await resolveAuth(p.bucket, p.credentialId)),

    putObject: async (p) =>
      adapter.putObject({
        key: p.key,
        content: p.content,
        mimeType: p.mimeType,
        size: p.size,
        metadata: p.metadata,
        bucket: p.bucket,
        auth: await resolveAuth(p.bucket, p.credentialId),
      }),

    streamObject: async (p) =>
      adapter.openDownloadStream(locationRef(p), await resolveAuth(p.bucket, p.credentialId)),

    getObject: async (p) => {
      const stream = await adapter.openDownloadStream(
        locationRef(p),
        await resolveAuth(p.bucket, p.credentialId)
      )
      const chunks: Buffer[] = []
      return new Promise<Buffer>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
      })
    },

    presignDownload: async (p) =>
      adapter.getDownloadRef(locationRef(p), await resolveAuth(p.bucket, p.credentialId), {
        ttlSec: p.ttlSec,
        disposition: p.disposition,
        filename: p.filename,
        mimeType: p.mimeType,
      }),

    buildExternalUrl: (p) =>
      adapter.buildExternalUrl(p.key, {
        bucket: p.bucket,
        ...(p.region && { region: p.region }),
      } as ProviderAuth),
  }
}
