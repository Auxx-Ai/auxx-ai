// packages/lib/src/files/storage/storage-manager.ts

import type { Transaction } from '@auxx/database'
import type { StorageLocationEntity as StorageLocation } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type {
  DownloadRef,
  MultipartUpload,
  PresignedUpload,
  ProviderAuth,
  ProviderId,
  StorageAdapter,
  StorageLocationRef,
} from '../adapters/base-adapter'
import {
  StorageAdapterError,
  StorageAuthError,
  StorageFileNotFoundError,
} from '../adapters/base-adapter'
import { defaultDatabase } from '../core/base-service'
import type { FilesCtx } from '../ctx'
import type { UploadPreparedConfig } from '../upload/init-types'
import { resolveProviderAuth } from './auth'
import { bucketForVisibility, buildExternalUrl, type StorageVisibility } from './buckets'
import { storageErrorCause } from './errors'
import { getStorageLocation } from './location-queries'
import { createStorageLocation, deleteStorageLocation } from './locations'
import { deleteObject, headObject, putObject } from './objects'
import { createS3StoragePort, type StoragePort } from './ports'
import { completeMultipart, presignPart, presignUpload, startMultipartUpload } from './presign'
import { getCachedStorageAdapter, getStorageAdapter, isProviderAvailable } from './providers'

const logger = createScopedLogger('storage-manager')

/**
 * Parameters for uploading content directly to storage
 *
 * @example
 * ```typescript
 * const uploadParams: StorageContentUploadParams = {
 *   provider: 'S3',
 *   key: 'org123/thumbnails/thumb_123.jpg',
 *   content: thumbnailBuffer,
 *   mimeType: 'image/jpeg',
 *   size: 102400,
 *   metadata: { original: 'file123', preset: 'medium' },
 *   credentialId: 'cred_aws_s3_prod',
 *   organizationId: 'org123'
 * }
 * ```
 */
export interface StorageContentUploadParams {
  provider: ProviderId
  key: string
  content: Buffer | NodeJS.ReadableStream
  mimeType?: string
  size?: number
  metadata?: Record<string, string>
  credentialId?: string
  organizationId?: string
  visibility?: StorageVisibility // Route to correct bucket
  bucket?: string // Explicit bucket override
}

/**
 * Parameters for downloading files from storage
 *
 * @example
 * ```typescript
 * const downloadParams: StorageDownloadParams = {
 *   locationId: 'loc_123abc',
 *   ttlSec: 3600, // 1 hour expiry
 *   range: { start: 0, end: 1024 } // First 1KB
 * }
 * ```
 */
export interface StorageDownloadParams {
  locationId: string
  ttlSec?: number
  range?: { start: number; end?: number }
  disposition?: 'inline' | 'attachment'
  filename?: string
  mimeType?: string
}

/**
 * The legacy storage facade — kept alive for its remaining call sites, not for
 * new work.
 *
 * @deprecated Use the `files/storage/*` functions directly. Deleted in the
 * Phase-10 consumer sweep (`plans/attachments/10-rollout-checklist.md`).
 *
 * ## What is left in here, and why
 *
 * Two kinds of method, and the difference is the whole map of this file:
 *
 * 1. **Delegates.** `generatePresignedUploadUrl`, `startMultipartUploadFromConfig`,
 *    `generatePartUploadUrl`, `completeMultipartUploadOnly`, `headByKey`,
 *    `deleteByKey` and the object half of `uploadContent` are now one call into
 *    `storage/presign.ts` or `storage/objects.ts` through a {@link StoragePort},
 *    plus {@link StorageManager.run} to turn the `Result` back into a throw. The
 *    behaviour lives in those modules; this class only adapts the calling
 *    convention.
 *
 * 2. **Composites this PR did not move.** `getDownloadRef`, `getContent`,
 *    `streamFileContent` and `deleteFile` are addressed by `storageLocationId`,
 *    so each one reads a database row *and* touches storage. Splitting them
 *    needs a `FilesCtx` at every call site (24 of them) and a decision about
 *    what the row's `metadata` is allowed to carry into the adapter — the row
 *    can hold `region` and `endpoint`, which the bucket/key-only port does not
 *    accept. That is Phase 4/5 work, and `assets/download.ts` is the shape it
 *    takes; doing it here would be a behaviour change smuggled into an
 *    extraction PR.
 *
 * ## One organization, one provider
 *
 * {@link StorageManager.port} is an S3 port. Every method still takes a
 * `provider`, and {@link StorageManager.validateStorageParams} rejects anything
 * without an adapter — which today is everything except `'S3'`. When a second
 * adapter lands, the port must be selected per call rather than per instance.
 *
 * @see {@link StorageAdapter} for provider-specific implementations
 * @see `files/storage/locations.ts` / `location-queries.ts` for `StorageLocation` persistence
 */
export class StorageManager {
  protected readonly organizationId?: string

  constructor(organizationId?: string) {
    this.organizationId = organizationId
  }

  /**
   * The {@link StoragePort} every delegate runs through.
   *
   * Built once per manager. `createS3StoragePort` is cheap — it closes over the
   * shared, cached adapter from `storage/providers.ts` rather than constructing
   * one — but building it per call would still allocate a fresh closure set on
   * the hottest paths in the upload flow.
   */
  private cachedPort?: StoragePort

  private get port(): StoragePort {
    this.cachedPort ??= createS3StoragePort(this.organizationId)
    return this.cachedPort
  }

  /**
   * Turn a `Result`-returning storage function back into the throw the legacy
   * callers of this class expect.
   *
   * `handleStorageError` restores the original adapter error class where there
   * is one (`storage/errors.ts` hangs it off `cause`), so a caller that used to
   * catch `StorageFileNotFoundError` still catches `StorageFileNotFoundError`.
   */
  private async run<T>(
    operation: Promise<Result<T, AuxxError>>,
    name: string,
    provider: ProviderId
  ): Promise<T> {
    const result = await operation
    if (result.isErr()) this.handleStorageError(result.error, name, provider)
    return result.value
  }

  /**
   * Build the `FilesCtx` the `storage/locations*` functions take.
   *
   * This is the whole seam between the class and the functional layer, and it
   * is the **only** place this facade reaches the process-wide pool.
   * `defaultDatabase()` is imported from `core/base-service.ts` rather than
   * re-derived here on purpose: that accessor already carries the namespace
   * import and the 20-line explanation of the Vitest link-time hazard (a *named*
   * `database` binding kills every downstream file at collection for any test
   * that mocks `@auxx/database` without that key — see PR #1823). Borrowing it
   * keeps `files/storage/**` free of any module-scope database reach, named or
   * namespace, which is the Phase-3 exit criterion.
   *
   * `organizationId` is optional on this class but required by `FilesCtx`, and
   * that gap is real rather than cosmetic: the reads below are now org-scoped,
   * so an unscoped manager would silently match nothing. Every call site that
   * reaches a location read or delete already passes an org, so this throws
   * rather than inventing `''`.
   */
  private filesCtx(operation: string): FilesCtx {
    if (!this.organizationId) {
      throw new StorageAdapterError(
        `${operation} requires an organization-scoped StorageManager`,
        'UNKNOWN' as ProviderId,
        operation
      )
    }
    return { db: defaultDatabase(), organizationId: this.organizationId }
  }

  /**
   * Load a `StorageLocation`, or throw the not-found error this class's callers
   * already expect.
   *
   * Three methods repeated this five-line shape verbatim; it is one place now so
   * the `Result` -> throw conversion happens identically in all of them.
   * `getStorageLocation` scopes to the organization, so a row belonging to
   * another tenant reaches here as `null` and surfaces as "not found" — the
   * caller must not be able to tell the two apart.
   */
  private async requireStorageLocation(
    locationId: string,
    operation: string
  ): Promise<StorageLocation> {
    const result = await getStorageLocation(this.filesCtx(operation), locationId)
    if (result.isErr()) throw result.error
    if (!result.value) {
      throw new StorageFileNotFoundError('UNKNOWN' as ProviderId, locationId)
    }
    return result.value
  }

  // ============= Core Storage Operations =============

  /**
   * Upload content directly to storage from server, and record it.
   *
   * **This is a composite, not an object write.** It puts the bytes *and*
   * creates the `StorageLocation` row, which is why it stayed on the facade when
   * PR 3d moved `putObject` out: the object half is `storage/objects.ts`, the
   * row half is `storage/locations.ts`, and gluing them together needs a
   * transaction and a `FilesCtx` that its 13 call sites do not have yet. Phase 6
   * owns that seam; until then this method is the glue.
   *
   * The bucket is now resolved **once**, here, and used for all three of the
   * object write, the external URL and the persisted row. It used to be resolved
   * three times independently — `S3Adapter.putObject` re-derived it from
   * `visibility`, `withResolvedS3Bucket` derived it again for the URL, and
   * `prepareLocationMetadata` a third time for the row — so the object could
   * land in one bucket while the row claimed another.
   *
   * @param params - Upload parameters including content and metadata
   * @returns Promise resolving to the created StorageLocation record
   *
   * @throws {StorageAdapterError} When provider doesn't support direct uploads
   * @throws {StorageAuthError} When authentication is invalid or missing
   *
   * @example
   * ```typescript
   * const storageLocation = await storageManager.uploadContent({
   *   provider: 'S3',
   *   key: 'thumbnails/image_thumb.jpg',
   *   content: thumbnailBuffer,
   *   mimeType: 'image/jpeg',
   *   size: thumbnailBuffer.length,
   *   visibility: 'PRIVATE',
   * })
   * ```
   */
  async uploadContent(params: StorageContentUploadParams): Promise<StorageLocation> {
    this.validateStorageParams(params)

    const bucket =
      params.provider === 'S3'
        ? await this.resolveS3BucketForLocation({
            bucket: params.bucket,
            metadata: params.metadata ?? {},
            credentialId: params.credentialId,
            visibility: params.visibility,
          })
        : params.bucket

    const result = await this.run(
      putObject(this.port, {
        provider: params.provider,
        bucket: bucket ?? '',
        key: params.key,
        credentialId: params.credentialId,
        content: params.content,
        mimeType: params.mimeType,
        size: params.size,
        metadata: {
          ...params.metadata,
          organizationId: params.organizationId! || this.organizationId!,
        },
      }),
      'uploadContent',
      params.provider
    )

    try {
      // Synchronous, and off the same bucket the bytes just went to.
      const externalUrl = buildExternalUrl({
        provider: params.provider,
        key: params.key,
        bucket,
        visibility: params.visibility,
      })

      return await this.createStorageLocation({
        provider: params.provider,
        externalId: params.key,
        externalUrl,
        externalRev: result.etag || '',
        credentialId: params.credentialId,
        size: result.size,
        mimeType: params.mimeType,
        metadata: {
          ...(params.metadata || {}),
          etag: result.etag,
          versionId: result.versionId,
        },
        bucket,
        visibility: params.visibility,
      })
    } catch (error) {
      this.handleStorageError(error, 'uploadContent', params.provider)
    }
  }

  /**
   * Get download URL for a storage location
   *
   * Generates a download URL for accessing stored files. The URL type depends on
   * the provider capabilities:
   * - **Presigned URLs**: For providers like S3 (direct client access)
   * - **Proxy URLs**: For providers requiring server-side access
   *
   * @param params - Download parameters including location ID and options
   * @returns Promise resolving to the download URL
   *
   * @throws {StorageFileNotFoundError} When storage location doesn't exist
   * @throws {StorageAdapterError} When provider doesn't support download URLs
   *
   * @see {@link getContent} for direct content retrieval
   * @see {@link streamFileContent} for streaming access
   */
  async getDownloadRef(params: StorageDownloadParams): Promise<DownloadRef> {
    // Get storage location from database
    const storageLocation = await this.requireStorageLocation(params.locationId, 'getDownloadRef')

    // Build location reference
    const locationRef = this.buildLocationRef(storageLocation)

    // Get adapter for the provider
    const adapter = await getStorageAdapter(locationRef.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await resolveProviderAuth({
      provider: locationRef.provider,
      organizationId: this.organizationId,
      credentialId: locationRef.credentialId,
    })

    const metadata = (storageLocation.metadata as Record<string, any>) || {}
    const inferredFileName =
      params.filename ||
      metadata.originalFileName ||
      metadata.fileName ||
      storageLocation.externalId.split('/').pop() ||
      'file'

    const inferredMimeType = params.mimeType || storageLocation.mimeType || undefined

    try {
      // Use adapter to get download reference
      if (adapter.getDownloadRef) {
        return await adapter.getDownloadRef(locationRef, auth, {
          ttlSec: params.ttlSec,
          disposition: params.disposition,
          filename: inferredFileName,
          mimeType: inferredMimeType,
        })
      } else if (adapter.openDownloadStream) {
        // Fallback to stream for providers without presigned URL support
        const stream = await adapter.openDownloadStream(locationRef, auth)
        const metadata = await adapter.getMeta(locationRef, auth)

        return {
          type: 'stream',
          stream,
          size: metadata.size,
          mimeType: metadata.mimeType,
          etag: metadata.etagOrRev,
        }
      } else {
        throw new StorageAdapterError(
          `Provider ${locationRef.provider} does not support downloads`,
          locationRef.provider,
          'getDownloadRef'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'getDownloadRef', locationRef.provider)
    }
  }

  /**
   * Get file content as Buffer
   *
   * Retrieves the complete file content from storage as a Buffer. This method
   * is suitable for smaller files that can fit in memory. For large files,
   * consider using {@link streamFileContent} instead.
   *
   * @param locationId - The storage location ID to retrieve content for
   * @returns Promise resolving to the file content as Buffer
   *
   * @throws {StorageFileNotFoundError} When storage location doesn't exist
   * @throws {StorageAdapterError} When provider doesn't support content retrieval
   *
   * @see {@link streamFileContent} for streaming large files
   * @see {@link getDownloadRef} for client-side downloads
   */
  async getContent(locationId: string): Promise<Buffer> {
    try {
      // Get the stream using streamFileContent (which handles all the setup)
      const stream = await this.streamFileContent(locationId)

      // Convert stream to buffer
      const chunks: Buffer[] = []
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
      })
    } catch (error) {
      // Re-throw with proper context if not already a storage error
      if (
        error instanceof StorageAdapterError ||
        error instanceof StorageAuthError ||
        error instanceof StorageFileNotFoundError
      ) {
        throw error
      }
      this.handleStorageError(error, 'getContent', 'UNKNOWN' as ProviderId)
    }
  }

  /**
   * Stream file content
   */
  async streamFileContent(
    locationId: string,
    range?: { start: number; end?: number }
  ): Promise<NodeJS.ReadableStream> {
    // Get storage location from database
    const storageLocation = await this.requireStorageLocation(locationId, 'streamFileContent')

    // Build location reference
    const locationRef = this.buildLocationRef(storageLocation)

    // Get adapter for the provider
    const adapter = await getStorageAdapter(locationRef.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    if (locationRef.credentialId) {
      auth = await resolveProviderAuth({
        provider: locationRef.provider,
        organizationId: this.organizationId,
        credentialId: locationRef.credentialId,
      })
    }

    try {
      // Use adapter to get file content stream
      if (adapter.openDownloadStream) {
        const stream = await adapter.openDownloadStream(locationRef, auth)

        // TODO: Add range support for partial content streaming
        // For now, return full stream - range support would require
        // adapter-specific implementation for HTTP Range headers
        if (range) {
          logger.warn('Range support not yet implemented - returning full stream', { locationId })
        }

        return stream
      } else {
        throw new StorageAdapterError(
          `Provider ${locationRef.provider} does not support file content streaming`,
          locationRef.provider,
          'streamFileContent'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'streamFileContent', locationRef.provider)
    }
  }

  /**
   * Delete file from storage
   */
  async deleteFile(locationId: string): Promise<void> {
    // Get storage location from database
    const storageLocation = await this.requireStorageLocation(locationId, 'deleteFile')

    // Load the adapter FIRST: `buildLocationRef` reads `adapter.resolveBucket()`
    // out of the adapter cache to fill in `metadata.bucket` for rows persisted
    // without one, and the adapter's delete no longer resolves a default itself.
    const adapter = await getStorageAdapter(storageLocation.provider as ProviderId)

    // Build location reference
    const locationRef = this.buildLocationRef(storageLocation)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    if (locationRef.credentialId) {
      auth = await resolveProviderAuth({
        provider: locationRef.provider,
        organizationId: this.organizationId,
        credentialId: locationRef.credentialId,
      })
    }

    if (locationRef.provider === 'S3' && !locationRef.metadata?.bucket) {
      const fallback = this.resolveFallbackBucket(adapter, auth, {
        provider: locationRef.provider,
        key: locationRef.externalId,
        operation: 'deleteFile',
      })
      if (fallback) {
        locationRef.metadata = { ...locationRef.metadata, bucket: fallback }
      }
    }

    try {
      // Use adapter to delete file
      if (adapter.deleteFile) {
        await adapter.deleteFile(locationRef, auth)

        // Remove storage location record from database.
        //
        // The `BEGIN`/`COMMIT` around a single DELETE is not ceremony: it is what
        // `deleteStorageLocation`'s `tx` slot costs here, and the slot is what
        // stops a future caller from doing this row-delete on the pool while its
        // asset rows go down in a transaction. In Postgres a one-statement
        // transaction is semantically identical to the implicit one the bare
        // DELETE already ran; the price is two round-trips on a path that has
        // just paid for an S3 DELETE. Phase 6 folds this into the caller's own
        // transaction and the wrapper goes away.
        const ctx = this.filesCtx('deleteFile')
        const deleted = await defaultDatabase().transaction((tx) =>
          deleteStorageLocation(tx, { ...ctx, db: tx }, locationId)
        )
        if (deleted.isErr()) throw deleted.error
      } else {
        throw new StorageAdapterError(
          `Provider ${locationRef.provider} does not support file deletion`,
          locationRef.provider,
          'deleteFile'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'deleteFile', locationRef.provider)
    }
  }

  // ============= Storage Location Management =============

  /**
   * Build the external (public) URL for an object.
   *
   * **Synchronous since PR 3b, deliberately.** The `apps/web` upload-complete
   * route calls this *inside* an open `db.transaction`, and the async version
   * could reach `getProviderAuth()` → `revealSecrets()` — a database read plus a
   * decrypt — from in there, purely to learn a bucket the caller already had on
   * the upload session. `storage/buckets.ts` does the whole job over config, so
   * there is nothing left to await. A caller that needs a credential-derived
   * `region` resolves it before opening the transaction and passes it in
   * `opts.region`.
   *
   * @param provider - The storage provider ID
   * @param key - The storage key/path
   * @param opts.bucket - The bucket the object lives in. Wins over `visibility`.
   * @param opts.visibility - Picks a configured bucket when `bucket` is absent.
   * @param opts.region - Overrides `S3_REGION` for the virtual-hosted-style URL.
   */
  buildExternalUrl(
    provider: ProviderId,
    key: string,
    opts?: {
      bucket?: string
      visibility?: StorageVisibility
      region?: string
    }
  ): string {
    return buildExternalUrl({
      provider,
      key,
      bucket: opts?.bucket,
      visibility: opts?.visibility,
      region: opts?.region,
    })
  }

  /**
   * Create a new storage location record (enhanced to support transactions)
   *
   * @deprecated Use `createStorageLocation(tx, ctx, input)` from
   * `files/storage/locations.ts`, which requires a `bucket` and takes its
   * organization scope from `ctx`. This method is a strangler facade, deleted
   * in Phase 6 (PR 6a) together with the route call sites that still pass
   * `{ tx }`.
   *
   * **The delegation is direct since PR 3c.** It used to hop through
   * `storageLocationService.create`, which was itself a facade over the same
   * function; that class is gone, so the middle hop went with it.
   *
   * The provider check below is now redundant with the new function's own
   * validation, and is kept only so this method's throw-shape
   * (`StorageAdapterError` via `handleStorageError`) is unchanged for its
   * existing callers.
   */
  async createStorageLocation(
    params: {
      provider: ProviderId
      externalId: string
      externalUrl?: string
      externalRev?: string
      credentialId?: string
      size?: number
      mimeType?: string
      metadata?: Record<string, any>
      bucket?: string
      visibility?: StorageVisibility
    },
    opts?: { tx?: any }
  ): Promise<StorageLocation> {
    try {
      // Validate provider
      if (!isProviderAvailable(params.provider)) {
        throw new StorageAdapterError(
          `Provider ${params.provider} is not available`,
          params.provider,
          'createStorageLocation'
        )
      }

      const metadata = await this.prepareLocationMetadata(params)
      // `prepareLocationMetadata` is where the bucket gets resolved, and
      // `CreateStorageLocationInput.bucket` is required, so it has to be read
      // back out rather than left buried in the blob. An unresolved bucket
      // reaches the new function as `''` and is rejected there — which is the
      // point: bugs #1816/#1817/#1818 were all a row persisted without one.
      const bucket = typeof metadata.bucket === 'string' ? metadata.bucket : ''

      const ctx = this.filesCtx('createStorageLocation')
      const input = {
        provider: params.provider,
        externalId: params.externalId,
        bucket,
        externalUrl: params.externalUrl || '',
        externalRev: params.externalRev || '',
        credentialId: params.credentialId,
        size: params.size,
        mimeType: params.mimeType,
        metadata,
      }

      // Two branches, because the optional `opts.tx` cannot be reconciled with a
      // required `Transaction` any other way:
      //
      // - Nothing supplied: open a transaction. Honest, no cast, and
      //   semantically identical to the single implicit transaction a bare
      //   INSERT already ran.
      // - Something supplied: production reaches this from the upload-complete
      //   route with a real `NodePgTransaction`, but `opts.tx` is typed `any`,
      //   so the compiler cannot see that. The cast is the receipt for that
      //   unsoundness and it is the honest answer — the legacy signature IS
      //   unsound, and no arrangement of this facade makes it sound. Calling
      //   `.transaction()` on it instead would issue a `SAVEPOINT` on the
      //   hottest write path in the app. The cast disappears with this method.
      const result = opts?.tx
        ? await createStorageLocation(opts.tx as Transaction, ctx, input)
        : await defaultDatabase().transaction((tx) =>
            createStorageLocation(tx, { ...ctx, db: tx }, input)
          )

      if (result.isErr()) throw result.error
      return result.value
    } catch (error) {
      this.handleStorageError(error, 'createStorageLocation', params.provider)
    }
  }

  /**
   * Normalize metadata before creating storage location records
   */
  private async prepareLocationMetadata(params: {
    provider: ProviderId
    externalId: string
    credentialId?: string
    metadata?: Record<string, any>
    bucket?: string
    visibility?: StorageVisibility
  }): Promise<Record<string, any>> {
    const metadata: Record<string, any> = { ...(params.metadata ?? {}) }

    if (params.provider === 'S3') {
      const bucket = await this.resolveS3BucketForLocation({
        bucket: params.bucket,
        metadata,
        credentialId: params.credentialId,
        visibility: params.visibility,
      })

      if (bucket) {
        metadata.bucket = bucket
      } else {
        logger.warn('Creating S3 storage location without resolved bucket', {
          externalId: params.externalId,
          credentialId: params.credentialId,
        })
      }

      if (!metadata.key) {
        metadata.key = params.externalId
      }
    }

    return metadata
  }

  /**
   * Last-resort bucket resolution for callers that did not supply one.
   *
   * Adapters no longer fall back to a configured default (a wrong-bucket delete
   * 204s and a wrong-bucket part presign fails with `NoSuchUpload`), so the
   * fallback lives here where it can be logged. Every warn from this method is a
   * caller that should be passing the upload session's `bucket`.
   */
  private resolveFallbackBucket(
    adapter: StorageAdapter,
    auth: ProviderAuth | undefined,
    context: { provider: ProviderId; key: string; operation: string }
  ): string | undefined {
    // Providers that are not bucket-addressed have no `resolveBucket`; there is
    // nothing to warn about for those.
    if (!adapter.resolveBucket && !(auth as any)?.bucket) return undefined

    const bucket = ((auth as any)?.bucket as string | undefined) || adapter.resolveBucket?.()

    logger.warn('No bucket supplied; falling back to the provider default bucket', {
      ...context,
      bucket,
    })

    return bucket
  }

  /**
   * The bucket for a key-addressed call whose caller supplied none.
   *
   * The single legacy shim behind `headByKey`, `deleteByKey`,
   * `generatePartUploadUrl` and `completeMultipartUploadOnly`. Those four have
   * an optional `bucket` that the functional layer does not: every parameter
   * type in `storage/ports.ts` requires one, on the reasoning in that file's
   * header. Rather than reintroduce the optional downstream, the facade resolves
   * it here — loudly, so the warn names the call site that should be passing the
   * upload session's `bucket`.
   *
   * Auth failures are swallowed on purpose: this is only computing a *fallback*,
   * and the port resolves auth again for the real call, where the same failure
   * surfaces properly.
   */
  private async legacyFallbackBucket(
    params: { provider: ProviderId; key: string; credentialId?: string },
    operation: string
  ): Promise<string | undefined> {
    const adapter = await getStorageAdapter(params.provider)

    let auth: ProviderAuth | undefined
    try {
      auth = await resolveProviderAuth({
        provider: params.provider,
        organizationId: this.organizationId,
        credentialId: params.credentialId,
      })
    } catch (error) {
      logger.warn('Failed to resolve provider auth while picking a fallback bucket', {
        provider: params.provider,
        operation,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return this.resolveFallbackBucket(adapter, auth, {
      provider: params.provider,
      key: params.key,
      operation,
    })
  }

  /**
   * Determine S3 bucket for storage metadata
   */
  private async resolveS3BucketForLocation(params: {
    bucket?: string
    metadata: Record<string, any>
    credentialId?: string
    visibility?: StorageVisibility
  }): Promise<string | undefined> {
    let bucket =
      params.bucket ||
      params.metadata?.bucket ||
      params.metadata?.Bucket ||
      params.metadata?.s3Bucket ||
      params.metadata?.publicBucket ||
      params.metadata?.privateBucket

    const visibilityFromMetadata = params.metadata?.visibility
    const visibility = params.visibility || visibilityFromMetadata

    if (!bucket) {
      if (visibility === 'PUBLIC' || visibility === 'PRIVATE') {
        bucket = bucketForVisibility(visibility)
      }
    }

    if (!bucket) {
      try {
        const auth = await resolveProviderAuth({
          provider: 'S3',
          organizationId: this.organizationId,
          credentialId: params.credentialId,
        })
        bucket = this.resolveS3BucketFromAuth(auth, visibility)
      } catch (error) {
        logger.warn('Failed to resolve bucket from provider auth', {
          credentialId: params.credentialId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Platform bucket resolution now happens via resolveProviderAuth → adapter.resolvePlatformAuth(),
    // which returns auth.bucket from configService. No separate configService fallback needed.

    return bucket || undefined
  }

  /**
   * Resolve the S3 bucket from auth using the requested visibility when available.
   */
  private resolveS3BucketFromAuth(
    auth?: ProviderAuth,
    visibility?: StorageVisibility
  ): string | undefined {
    if (!auth) {
      return undefined
    }

    if (visibility === 'PUBLIC') {
      return (
        (auth as any)?.publicBucket ||
        (auth as any)?.bucket ||
        (auth as any)?.privateBucket ||
        undefined
      )
    }

    if (visibility === 'PRIVATE') {
      return (
        (auth as any)?.privateBucket ||
        (auth as any)?.bucket ||
        (auth as any)?.publicBucket ||
        undefined
      )
    }

    return (
      (auth as any)?.bucket ||
      (auth as any)?.privateBucket ||
      (auth as any)?.publicBucket ||
      undefined
    )
  }

  // ============= Presigned URLs =============

  /**
   * Generate a presigned upload URL, with the upload policy enforced.
   *
   * Delegates to `storage/presign.ts`, which is where the policy check lives
   * since PR 3d — {@link StoragePort.presignUpload} signs whatever it is handed,
   * so this is the only door that must be used.
   */
  async generatePresignedUploadUrl(
    config: UploadPreparedConfig & { metadata?: Record<string, string> }
  ): Promise<PresignedUpload> {
    this.validateStorageParams({ provider: config.provider })
    return this.run(presignUpload(this.port, config), 'generatePresignedUploadUrl', config.provider)
  }

  /**
   * Start a multipart upload, with the upload policy enforced.
   *
   * The policy is *advisory* from here on — nothing constrains the total size or
   * the real content type of a multipart upload until the `headByKey` that
   * follows completion. `storage/presign.ts` documents the asymmetry in full.
   */
  async startMultipartUploadFromConfig(
    config: UploadPreparedConfig & { metadata?: Record<string, string> }
  ): Promise<MultipartUpload> {
    this.validateStorageParams({ provider: config.provider })
    return this.run(
      startMultipartUpload(this.port, config),
      'startMultipartUploadFromConfig',
      config.provider
    )
  }

  // ============= S3-Only Operations (No Persistence) =============

  /**
   * Complete multipart upload without creating DB record
   * Returns S3 metadata only for use in transactions
   *
   * @param params.bucket - The bucket the multipart upload was initiated in
   *   (the upload session's `bucket`). Completing against a different bucket
   *   fails with `NoSuchUpload`. Omitting it falls back — loudly — to the
   *   provider default, which is almost always wrong for a PUBLIC upload.
   */
  async completeMultipartUploadOnly(params: {
    provider: ProviderId
    key: string
    uploadId: string
    parts: Array<{ partNumber: number; etag: string }>
    credentialId?: string
    bucket?: string
  }): Promise<{ etag: string; size?: number }> {
    this.validateStorageParams(params)
    const bucket =
      params.bucket ?? (await this.legacyFallbackBucket(params, 'completeMultipartUploadOnly'))

    return this.run(
      completeMultipart(this.port, {
        provider: params.provider,
        bucket: bucket ?? '',
        key: params.key,
        credentialId: params.credentialId,
        uploadId: params.uploadId,
        parts: params.parts,
      }),
      'completeMultipartUploadOnly',
      params.provider
    )
  }

  /**
   * Delete by key for compensation (cleanup orphaned objects)
   *
   * @param params.bucket - The bucket the object actually lives in (the upload
   *   session's `bucket`). Omitting it on a PUBLIC upload deletes a nonexistent
   *   key from the private bucket — S3 answers 204 and the real object leaks.
   */
  async deleteByKey(params: {
    provider: ProviderId
    key: string
    credentialId?: string
    bucket?: string
  }): Promise<void> {
    this.validateStorageParams(params)
    const bucket = params.bucket ?? (await this.legacyFallbackBucket(params, 'deleteByKey'))

    await this.run(
      deleteObject(this.port, {
        provider: params.provider,
        bucket: bucket ?? '',
        key: params.key,
        credentialId: params.credentialId,
      }),
      'deleteByKey',
      params.provider
    )
  }

  // ============= Multipart Uploads =============

  /**
   * Generate presigned URL for uploading one part.
   *
   * @param params.bucket - The bucket the multipart upload was initiated in
   *   (the upload session's `bucket`). Presigning a part against a different
   *   bucket fails with `NoSuchUpload`.
   */
  async generatePartUploadUrl(params: {
    provider: ProviderId
    key: string
    uploadId: string
    partNumber: number
    size?: number
    credentialId?: string
    bucket?: string
  }): Promise<PresignedUpload> {
    this.validateStorageParams(params)
    const bucket =
      params.bucket ?? (await this.legacyFallbackBucket(params, 'generatePartUploadUrl'))

    return this.run(
      presignPart(this.port, {
        provider: params.provider,
        bucket: bucket ?? '',
        key: params.key,
        credentialId: params.credentialId,
        uploadId: params.uploadId,
        partNumber: params.partNumber,
        size: params.size,
      }),
      'generatePartUploadUrl',
      params.provider
    )
  }

  // ============= Utility Methods =============

  /**
   * Build storage location reference from database record
   *
   * Converts a StorageLocation database record into a StorageLocationRef
   * that can be used with storage adapters. This transformation handles
   * type conversions and null value management.
   *
   * @param location - The database storage location record
   * @returns Storage location reference for adapter use
   *
   * @internal
   */
  private buildLocationRef(location: StorageLocation): StorageLocationRef {
    const rawMetadata = (location.metadata as Record<string, any>) || undefined
    let metadata = rawMetadata ? { ...rawMetadata } : undefined

    if (location.provider === 'S3') {
      const adapter = getCachedStorageAdapter('S3')
      const bucketCandidate =
        metadata?.bucket ||
        metadata?.Bucket ||
        metadata?.s3Bucket ||
        metadata?.publicBucket ||
        metadata?.privateBucket ||
        adapter?.resolveBucket?.()

      if (bucketCandidate) {
        if (!metadata) {
          metadata = {}
        }
        metadata.bucket = bucketCandidate
      }

      if (metadata) {
        metadata.key = metadata.key || location.externalId
      }
    }

    return {
      provider: location.provider as ProviderId,
      externalId: location.externalId,
      externalUrl: location.externalUrl || undefined,
      credentialId: location.credentialId || undefined,
      metadata,
    }
  }

  // NOTE: Provider-specific utilities (like S3 key generation) belong in individual adapters

  /**
   * Validate storage operation parameters
   */
  private validateStorageParams(params: any): void {
    if (!params) {
      throw new StorageAdapterError(
        'Parameters are required',
        'UNKNOWN' as ProviderId,
        'validateParams'
      )
    }

    if (!params.provider) {
      throw new StorageAdapterError(
        'Provider is required',
        'UNKNOWN' as ProviderId,
        'validateParams'
      )
    }

    if (!isProviderAvailable(params.provider)) {
      throw new StorageAdapterError(
        `Provider ${params.provider} is not available`,
        params.provider,
        'validateParams'
      )
    }
  }

  /**
   * Get file metadata by provider key without downloading (HEAD request)
   *
   * Use this when you have provider/key but no `StorageLocation` row — upload
   * verification, integrity checking. It is also the **only** real size and
   * content-type check a multipart upload ever gets: see `storage/presign.ts`.
   *
   * @param params.bucket - The bucket the object lives in. Omitting it falls
   *   back — loudly — to the provider default.
   * @returns Promise resolving to basic file metadata (size, mimeType, etagOrRev)
   *
   * @throws {StorageFileNotFoundError} When file doesn't exist
   * @throws {StorageAuthError} When authentication is invalid
   * @throws {StorageAdapterError} When operation fails
   */
  async headByKey(params: {
    provider: ProviderId
    key: string
    credentialId?: string
    bucket?: string
  }): Promise<{ size: number; mimeType: string; etagOrRev: string }> {
    this.validateStorageParams(params)
    const bucket = params.bucket ?? (await this.legacyFallbackBucket(params, 'headByKey'))

    const metadata = await this.run(
      headObject(this.port, {
        provider: params.provider,
        bucket: bucket ?? '',
        key: params.key,
        credentialId: params.credentialId,
      }),
      'headByKey',
      params.provider
    )

    return {
      size: metadata.size || 0,
      mimeType: metadata.mimeType || 'application/octet-stream',
      etagOrRev: metadata.etagOrRev || metadata.updatedAt?.toISOString() || '',
    }
  }

  /**
   * Handle storage operation errors
   *
   * Processes and categorizes storage operation errors, ensuring consistent
   * error handling across all storage operations. Preserves existing storage
   * errors and wraps unknown errors in StorageAdapterError.
   *
   * The `cause` unwrap is what keeps this facade's throw shape unchanged now
   * that the delegates return `Result<T, AuxxError>`: `storage/errors.ts` maps
   * an adapter error onto an `AuxxError` subclass and hangs the original off
   * `cause`, so a caller that used to catch `StorageFileNotFoundError` still
   * does.
   *
   * @param error - The original error that occurred
   * @param operation - The operation that was being performed
   * @param provider - The provider where the error occurred
   * @throws {StorageAdapterError|StorageAuthError|StorageFileNotFoundError} Categorized error
   *
   * @internal
   */
  private handleStorageError(error: any, operation: string, provider: ProviderId): never {
    // An adapter error that `storageGuard` mapped on its way out. Restore it.
    const adapterError = storageErrorCause(error)
    if (adapterError) throw adapterError

    // If it's already a storage error, re-throw it
    if (
      error instanceof StorageAdapterError ||
      error instanceof StorageAuthError ||
      error instanceof StorageFileNotFoundError
    ) {
      throw error
    }

    // Wrap other errors in StorageAdapterError
    throw new StorageAdapterError(
      `Storage operation failed: ${error.message || error}`,
      provider,
      operation,
      error instanceof Error ? error : undefined
    )
  }
}

// Factory function to create service instances for specific organizations
export const createStorageManager = (organizationId?: string) => new StorageManager(organizationId)
