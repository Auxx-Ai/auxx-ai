// packages/lib/src/files/storage/storage-manager.ts

import type { Transaction } from '@auxx/database'
import type { StorageLocationEntity as StorageLocation } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
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
import { getStorageLocation } from './location-queries'
import { createStorageLocation, deleteStorageLocation } from './locations'
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
  visibility?: 'PUBLIC' | 'PRIVATE' // Route to correct bucket
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
 * Enhanced StorageManager - Unified Multi-Provider Storage Orchestrator
 *
 * The StorageManager provides a single, consistent interface for managing files across
 * multiple storage providers (S3, Google Drive, Dropbox, etc.). It handles provider
 * abstraction, authentication, error handling, and advanced features like multipart
 * uploads and webhooks.
 *
 * ## Key Features
 * - **Multi-Provider Support**: S3, Google Drive, Dropbox, OneDrive, Box, and URL providers
 * - **Dynamic Adapter Loading**: Lazy-loaded adapters with caching for optimal performance
 * - **Authentication Management**: Seamless credential handling across all providers
 * - **Advanced Upload Features**: Presigned URLs, multipart uploads, progress tracking
 * - **Monitoring & Analytics**: Health checks, usage statistics, webhook processing
 * - **Database Integration**: Full StorageLocation lifecycle management
 *
 * ## Architecture
 * ```
 * StorageManager (Orchestration Layer)
 *     ↓
 * Dynamic Adapter Loading & Caching
 *     ↓
 * Provider-Specific Adapters (S3, GDrive, etc.)
 *     ↓
 * External Storage APIs
 * ```
 *
 * ## Usage Examples
 *
 * ### Basic File Upload
 * ```typescript
 * const manager = new StorageManager('org_123')
 *
 * const result = await manager.uploadFile({
 *   provider: 'S3',
 *   key: 'documents/report.pdf',
 *   content: fileBuffer,
 *   mimeType: 'application/pdf',
 *   credentialId: 'aws_cred_123'
 * })
 * ```
 *
 * ### Large File Upload with Progress
 * ```typescript
 * const result = await manager.uploadLargeFile(
 *   {
 *     provider: 'S3',
 *     key: 'videos/large-video.mp4',
 *     content: videoStream,
 *     partSize: 50 * 1024 * 1024 // 50MB parts
 *   },
 *   (progress) => console.log(`Progress: ${progress.percentage}%`)
 * )
 * ```
 *
 * ### Provider Health Monitoring
 * ```typescript
 * const healthChecks = await manager.performHealthCheck()
 * healthChecks.forEach(check => {
 *   console.log(`${check.provider}: ${check.healthy ? 'OK' : 'FAILED'}`)
 * })
 * ```
 *
 * @see {@link StorageAdapter} for provider-specific implementations
 * @see `files/storage/locations.ts` / `location-queries.ts` for `StorageLocation` persistence
 * @since 1.0.0
 */
export class StorageManager {
  protected readonly organizationId?: string

  constructor(organizationId?: string) {
    this.organizationId = organizationId
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
   * Upload content directly to storage from server
   *
   * This method handles server-side uploads where content is already
   * available in memory or as a stream. Unlike presigned URLs, this
   * uploads content directly through the server.
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
   *   metadata: { preset: 'medium', originalId: 'file123' }
   * })
   * ```
   */
  async uploadContent(params: StorageContentUploadParams): Promise<StorageLocation> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await getStorageAdapter(params.provider)

    // Check if adapter supports direct uploads
    if (!adapter.putObject) {
      throw new StorageAdapterError(
        `Provider ${params.provider} does not support direct server uploads`,
        params.provider,
        'uploadContent'
      )
    }

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await resolveProviderAuth({
      provider: params.provider,
      organizationId: this.organizationId,
      credentialId: params.credentialId,
    })

    try {
      // Upload content using adapter
      const result = await adapter.putObject({
        key: params.key,
        content: params.content,
        mimeType: params.mimeType,
        size: params.size,
        metadata: {
          ...params.metadata,
          organizationId: params.organizationId! || this.organizationId!,
        },
        visibility: params.visibility, // Route to correct bucket
        bucket: params.bucket, // Explicit bucket override
        auth,
      })

      // Build external URL using adapter if it supports it
      const externalUrlAuth =
        params.provider === 'S3'
          ? this.withResolvedS3Bucket({
              auth,
              bucket: params.bucket,
              visibility: params.visibility,
            })
          : auth

      const externalUrl = adapter.buildExternalUrl
        ? adapter.buildExternalUrl(params.key, externalUrlAuth)
        : params.key

      // Create storage location record
      const storageLocation = await this.createStorageLocation({
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
        bucket: params.bucket,
        visibility: params.visibility,
      })

      return storageLocation
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
   * @example
   * ```typescript
   * // Get a 1-hour download URL
   * const downloadRef = await manager.getDownloadRef({
   *   locationId: 'loc_abc123',
   *   ttlSec: 3600
   * })
   *
   * // Use URL for client download
   * window.open(downloadUrl)
   * ```
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
   * @example
   * ```typescript
   * // Download file content for processing
   * const content = await manager.getContent('loc_abc123')
   * const text = content.toString('utf-8')
   * console.log(`File contains: ${text.substring(0, 100)}...`)
   * ```
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
          console.warn('Range support not yet implemented - returning full stream')
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
   *
   * @example
   * ```typescript
   * const externalUrl = storageManager.buildExternalUrl('S3', 'org-123/file.pdf', {
   *   bucket: session.bucket,
   *   visibility: session.visibility,
   * })
   * ```
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
      visibility?: 'PUBLIC' | 'PRIVATE'
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

      const metadata = (await this.prepareLocationMetadata(params)) ?? {}
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
    visibility?: 'PUBLIC' | 'PRIVATE'
  }): Promise<Record<string, any> | undefined> {
    const metadata: Record<string, any> = {
      ...(params.metadata ?? {}),
    }

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

    return Object.keys(metadata).length > 0 ? metadata : undefined
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
   * Determine S3 bucket for storage metadata
   */
  private async resolveS3BucketForLocation(params: {
    bucket?: string
    metadata: Record<string, any>
    credentialId?: string
    visibility?: 'PUBLIC' | 'PRIVATE'
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

    // Platform bucket resolution now happens via getProviderAuth → adapter.resolvePlatformAuth(),
    // which returns auth.bucket from configService. No separate configService fallback needed.

    return bucket || undefined
  }

  /**
   * Resolve the S3 bucket from auth using the requested visibility when available.
   */
  private resolveS3BucketFromAuth(
    auth?: ProviderAuth,
    visibility?: 'PUBLIC' | 'PRIVATE'
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

  /**
   * Ensure S3 URL generation uses the bucket that matches the requested visibility.
   */
  private withResolvedS3Bucket(params: {
    auth?: ProviderAuth
    bucket?: string
    visibility?: 'PUBLIC' | 'PRIVATE'
  }): ProviderAuth | undefined {
    let bucket = params.bucket

    if (!bucket && params.visibility) {
      bucket = bucketForVisibility(params.visibility) || undefined
    }

    if (!bucket) {
      bucket = this.resolveS3BucketFromAuth(params.auth, params.visibility)
    }

    if (!bucket) {
      return params.auth
    }

    return {
      ...(params.auth ?? {}),
      bucket,
    }
  }

  // ============= File Operations =============

  // ============= Presigned URLs =============

  /**
   * Centralized policy enforcement for upload operations
   */
  private enforcePolicy(config: UploadPreparedConfig) {
    if (!config.storageKey.startsWith(config.policy.keyPrefix)) {
      throw new StorageAdapterError(
        `Key must start with '${config.policy.keyPrefix}'`,
        config.provider,
        'presign'
      )
    }

    if (config.ttlSec > config.policy.maxTtl) {
      throw new StorageAdapterError(
        `TTL exceeds ${config.policy.maxTtl}s`,
        config.provider,
        'presign'
      )
    }

    const [min, max] = config.policy.contentLengthRange
    if (config.expectedSize < min || config.expectedSize > max) {
      throw new StorageAdapterError(
        `Size ${config.expectedSize} outside [${min}, ${max}]`,
        config.provider,
        'presign'
      )
    }

    // MIME: support exact and wildcard families (image/*)
    const allowed = config.policy.allowedMimeTypes.some((allowed) => {
      if (allowed === '*/*') return true
      if (allowed.endsWith('/*')) return config.mimeType.startsWith(allowed.slice(0, -2))
      return config.mimeType === allowed
    })

    if (!allowed) {
      throw new StorageAdapterError(
        `MIME '${config.mimeType}' not allowed`,
        config.provider,
        'presign'
      )
    }
  }

  /**
   * Generate presigned upload URL with policy enforcement (New Unified API)
   *
   * This method enforces upload policies defined by processors and provides
   * centralized security validation. This is the new API that replaces the
   * basic generatePresignedUploadUrl for all upload flows.
   */
  async generatePresignedUploadUrl(
    config: UploadPreparedConfig & { metadata?: Record<string, string> }
  ): Promise<PresignedUpload> {
    // Validate storage parameters
    this.validateStorageParams({ provider: config.provider })

    this.enforcePolicy(config) // ✅ Add policy enforcement

    // Get adapter for the provider
    const adapter = await getStorageAdapter(config.provider)

    // Check if adapter supports presigned uploads
    const capabilities = adapter.getCapabilities()
    if (!capabilities.presignUpload) {
      throw new StorageAdapterError(
        `Provider ${config.provider} does not support presigned uploads`,
        config.provider,
        'generatePresignedUploadUrl'
      )
    }

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await resolveProviderAuth({
      provider: config.provider,
      organizationId: this.organizationId,
      credentialId: config.credentialId,
    })

    try {
      // Use adapter to generate presigned upload URL
      return await (adapter as any).presignUpload({
        key: config.storageKey,
        mimeType: config.mimeType,
        size: config.expectedSize,
        ttlSec: config.ttlSec,
        metadata: {
          orgId: config.organizationId,
          uploader: config.userId,
          entityType: config.entityType,
          entityId: config.entityId ?? '',
          ...config.metadata,
        },
        visibility: config.visibility, // Route to correct bucket
        bucket: config.bucket, // Explicit bucket override
        auth,
      })
    } catch (error) {
      this.handleStorageError(error, 'generatePresignedUploadUrl', config.provider)
    }
  }

  /**
   * Start multipart upload with policy enforcement
   */
  async startMultipartUploadFromConfig(
    config: UploadPreparedConfig & { metadata?: Record<string, string> }
  ): Promise<MultipartUpload> {
    // Validate storage parameters
    this.validateStorageParams({ provider: config.provider })

    this.enforcePolicy(config) // ✅ Add policy enforcement

    // Get adapter for the provider
    const adapter = await getStorageAdapter(config.provider)

    // Check if adapter supports multipart uploads
    const capabilities = adapter.getCapabilities()
    if (!capabilities.multipart) {
      throw new StorageAdapterError(
        `Provider ${config.provider} does not support multipart uploads`,
        config.provider,
        'startMultipartUploadFromConfig'
      )
    }

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await resolveProviderAuth({
      provider: config.provider,
      organizationId: this.organizationId,
      credentialId: config.credentialId,
    })

    try {
      // Use adapter to start multipart upload
      return await (adapter as any).startMultipartUpload({
        key: config.storageKey,
        mimeType: config.mimeType,
        metadata: {
          orgId: config.organizationId,
          uploader: config.userId,
          entityType: config.entityType,
          entityId: config.entityId ?? '',
          ...config.metadata,
        },
        visibility: config.visibility, // Route to correct bucket
        bucket: config.bucket, // Explicit bucket override
        auth,
      })
    } catch (error) {
      this.handleStorageError(error, 'startMultipartUploadFromConfig', config.provider)
    }
  }

  // ============= S3-Only Operations (No Persistence) =============

  /**
   * Complete multipart upload without creating DB record
   * Returns S3 metadata only for use in transactions
   *
   * @param params.bucket - The bucket the multipart upload was initiated in
   *   (the upload session's `bucket`). Completing against a different bucket
   *   fails with `NoSuchUpload`.
   */
  async completeMultipartUploadOnly(params: {
    provider: ProviderId
    key: string
    uploadId: string
    parts: Array<{ partNumber: number; etag: string }>
    credentialId?: string
    bucket?: string
  }): Promise<{ etag: string; size?: number }> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await getStorageAdapter(params.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await resolveProviderAuth({
      provider: params.provider,
      organizationId: this.organizationId,
      credentialId: params.credentialId,
    })

    const bucket =
      params.bucket ??
      this.resolveFallbackBucket(adapter, auth, {
        provider: params.provider,
        key: params.key,
        operation: 'completeMultipartUploadOnly',
      })

    try {
      // Use adapter to complete multipart upload without creating DB record
      if ((adapter as any).completeMultipart) {
        return await (adapter as any).completeMultipart({
          key: params.key,
          uploadId: params.uploadId,
          parts: params.parts,
          bucket,
          auth,
        })
      } else {
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support multipart upload completion`,
          params.provider,
          'completeMultipartUploadOnly'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'completeMultipartUploadOnly', params.provider)
    }
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
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await getStorageAdapter(params.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    try {
      auth = await resolveProviderAuth({
        provider: params.provider,
        organizationId: this.organizationId,
        credentialId: params.credentialId,
      })
    } catch (error) {
      // Log but don't fail - some adapters might work without explicit credentials
      logger.warn(
        'Failed to get provider authentication for deleteByKey, continuing without auth',
        {
          provider: params.provider,
          error: error instanceof Error ? error.message : String(error),
        }
      )
    }

    const bucket =
      params.bucket ??
      this.resolveFallbackBucket(adapter, auth, {
        provider: params.provider,
        key: params.key,
        operation: 'deleteByKey',
      })

    try {
      // Build location reference for adapter. The bucket travels on metadata —
      // adapters no longer resolve a default, so a missing bucket throws rather
      // than silently deleting nothing.
      const locationRef: StorageLocationRef = {
        provider: params.provider,
        externalId: params.key,
        credentialId: params.credentialId,
        metadata: bucket ? { bucket, key: params.key } : undefined,
      }

      if (adapter.deleteFile) {
        await adapter.deleteFile(locationRef, auth)
      } else {
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support file deletion`,
          params.provider,
          'deleteByKey'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'deleteByKey', params.provider)
    }
  }

  // ============= Multipart Uploads (Legacy) =============

  /**
   * Generate presigned URL for upload part
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
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await getStorageAdapter(params.provider)

    // Check if adapter supports multipart uploads
    const capabilities = adapter.getCapabilities()
    if (!capabilities.presignUpload) {
      throw new StorageAdapterError(
        `Provider ${params.provider} does not support part upload URLs`,
        params.provider,
        'generatePartUploadUrl'
      )
    }

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await resolveProviderAuth({
      provider: params.provider,
      organizationId: this.organizationId,
      credentialId: params.credentialId,
    })

    const bucket =
      params.bucket ??
      this.resolveFallbackBucket(adapter, auth, {
        provider: params.provider,
        key: params.key,
        operation: 'generatePartUploadUrl',
      })

    try {
      // Use adapter to generate part upload URL
      if ((adapter as any).presignPart) {
        return await (adapter as any).presignPart({
          key: params.key,
          uploadId: params.uploadId,
          partNumber: params.partNumber,
          size: params.size,
          bucket,
          auth,
        })
      } else {
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support part upload URLs`,
          params.provider,
          'generatePartUploadUrl'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'generatePartUploadUrl', params.provider)
    }
  }

  // ============= Provider Operations =============

  // ============= Webhook Processing =============

  // ============= Monitoring & Health =============

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
   * Use this method for direct storage verification when you have provider/key
   * but no storage location record. For files with existing location records,
   * use getFileMetadata() instead for full metadata.
   *
   * This is essential for upload verification and integrity checking before
   * creating storage location records.
   *
   * @param params - Parameters for the head request
   *   bucket (optional) provides an explicit S3 bucket, bypassing environment resolution
   * @returns Promise resolving to basic file metadata (size, mimeType, etagOrRev)
   *
   * @throws {StorageFileNotFoundError} When file doesn't exist
   * @throws {StorageAuthError} When authentication is invalid
   * @throws {StorageAdapterError} When operation fails
   *
   * @example
   * ```typescript
   * const metadata = await manager.headByKey({
   *   provider: 'S3',
   *   key: 'org-123/file.pdf',
   *   credentialId: 's3_cred_id'
   * })
   *
   * console.log(`File size: ${metadata.size} bytes`)
   * console.log(`MIME type: ${metadata.mimeType}`)
   * console.log(`ETag: ${metadata.etagOrRev}`)
   * ```
   */
  async headByKey(params: {
    provider: ProviderId
    key: string
    credentialId?: string
    bucket?: string
  }): Promise<{ size: number; mimeType: string; etagOrRev: string }> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await getStorageAdapter(params.provider)

    // Always try to get authentication (credential manager handles system credential fallback)
    let auth: ProviderAuth | undefined
    try {
      auth = await resolveProviderAuth({
        provider: params.provider,
        organizationId: this.organizationId,
        credentialId: params.credentialId,
      })
    } catch (error) {
      // Log but don't fail - adapter might work without explicit credentials
      logger.warn('Failed to get provider authentication for headByKey, continuing without auth', {
        provider: params.provider,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    try {
      // Use adapter's getMeta method (equivalent to HEAD operation)
      if ((adapter as any).getMeta) {
        // ✅ CRITICAL FIX: Construct StorageLocationRef with the key as externalId
        // The adapter (especially S3) will handle bucket resolution internally
        // Never try to parse bucket from the key - always use configured bucket
        const locationRef = {
          provider: params.provider,
          externalId: params.key, // This is the storage key, NOT bucket/key format
          credentialId: params.credentialId,
          metadata: params.bucket
            ? {
                bucket: params.bucket,
                key: params.key,
              }
            : undefined,
        }

        const metadata = await (adapter as any).getMeta(locationRef, auth)

        return {
          size: metadata.size || 0,
          mimeType: metadata.mimeType || 'application/octet-stream',
          etagOrRev:
            metadata.etagOrRev ||
            metadata.etag ||
            metadata.revision ||
            metadata.lastModified?.toISOString() ||
            '',
        }
      } else {
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support metadata retrieval`,
          params.provider,
          'headByKey'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'headByKey', params.provider)
    }
  }

  /**
   * Handle storage operation errors
   *
   * Processes and categorizes storage operation errors, ensuring consistent
   * error handling across all storage operations. Preserves existing storage
   * errors and wraps unknown errors in StorageAdapterError.
   *
   * @param error - The original error that occurred
   * @param operation - The operation that was being performed
   * @param provider - The provider where the error occurred
   * @throws {StorageAdapterError|StorageAuthError|StorageFileNotFoundError} Categorized error
   *
   * @internal
   */
  private handleStorageError(error: any, operation: string, provider: ProviderId): never {
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

// Export singleton instance (with no specific organization)
// export const storageManager = new StorageManager()

// Factory function to create service instances for specific organizations
export const createStorageManager = (organizationId?: string) => new StorageManager(organizationId)
