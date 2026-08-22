// packages/lib/src/files/adapters/s3-adapter.ts

import { Readable } from 'node:stream'
import { configService } from '@auxx/credentials'
import { encodeRFC5987ValueChars } from '@auxx/utils'
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { assertBucket, bucketForVisibility, buildExternalUrl } from '../storage/buckets'
import {
  BaseStorageAdapter,
  type DownloadRef,
  type FileMetadata,
  type MultipartUpload,
  type PresignedUpload,
  type ProviderAuth,
  StorageAdapterError,
  StorageAuthError,
  type StorageCapabilities,
  StorageFileNotFoundError,
  type StorageLocationRef,
  StorageQuotaError,
} from './base-adapter'

// ============= Configuration Interfaces =============

/**
 * S3 configuration for client initialization
 */
export interface S3Config {
  region?: string
  endpoint?: string // For S3-compatible services
  forcePathStyle?: boolean // Required for some S3-compatible services like MinIO
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
  maxRetries?: number
  timeout?: number
}

/**
 * S3-specific metadata stored in StorageLocationRef.metadata
 */
export interface S3Metadata {
  bucket: string
  key: string
  region?: string
  endpoint?: string
  etag?: string
  versionId?: string
  encryptionMethod?: 'AES256' | 'aws:kms'
  kmsKeyId?: string
  storageClass?: string
}

/**
 * S3 error code mapping
 */
const S3_ERROR_MAP: Record<string, string> = {
  NoSuchKey: 'FileNotFound',
  NoSuchBucket: 'FileNotFound',
  AccessDenied: 'Auth',
  InvalidAccessKeyId: 'Auth',
  SignatureDoesNotMatch: 'Auth',
  TokenRefreshRequired: 'Auth',
  QuotaExceeded: 'Quota',
  ServiceUnavailable: 'Adapter',
  SlowDown: 'Adapter',
  RequestTimeout: 'Adapter',
  InternalError: 'Adapter',
}

/**
 * S3-compatible storage adapter
 * Supports AWS S3, DigitalOcean Spaces, Cloudflare R2, and other S3-compatible providers
 */
export class S3Adapter extends BaseStorageAdapter {
  private clientCache = new Map<string, S3Client>()
  readonly id = 'S3' as const
  readonly credentialProviderId = 'S3' as const
  readonly name = 'Amazon S3'
  readonly description = 'AWS S3 and S3-compatible storage providers'

  /**
   * Get S3 adapter capabilities
   */
  getCapabilities(): StorageCapabilities {
    return {
      presignUpload: true,
      presignDownload: true,
      multipart: true,
    }
  }

  /**
   * Resolve platform-level S3 auth from configService.
   * SST: returns { region, bucket, publicBucket } — S3Client uses IAM role.
   * Self-hosted: also includes accessKeyId/secretAccessKey from env vars.
   */
  resolvePlatformAuth(): ProviderAuth | null {
    const region = configService.get<string>('S3_REGION')
    const bucket = configService.get<string>('S3_PRIVATE_BUCKET')
    const publicBucket = configService.get<string>('S3_PUBLIC_BUCKET')

    if (!region || !bucket) {
      return null
    }

    const accessKeyId = configService.get<string>('S3_ACCESS_KEY_ID')
    const secretAccessKey = configService.get<string>('S3_SECRET_ACCESS_KEY')
    const endpoint = configService.get<string>('S3_ENDPOINT')

    return {
      region,
      bucket,
      publicBucket,
      ...(accessKeyId && secretAccessKey && { accessKeyId, secretAccessKey }),
      ...(endpoint && { endpoint }),
    } as ProviderAuth
  }

  /**
   * Resolve default bucket name from platform config.
   */
  resolveBucket(): string | undefined {
    return (
      configService.get<string>('S3_PRIVATE_BUCKET') ||
      configService.get<string>('S3_PUBLIC_BUCKET') ||
      undefined
    )
  }

  /**
   * Build external URL for S3 object.
   *
   * Delegates to `storage/buckets.ts` so the adapter, the `StoragePort` and the
   * `StorageManager` facade all render the same URL from the same rules.
   */
  buildExternalUrl(key: string, auth?: ProviderAuth): string {
    return buildExternalUrl({
      provider: this.id,
      key,
      bucket: (auth as any)?.bucket,
      region: (auth as any)?.region,
    })
  }

  /**
   * Get S3 object metadata
   */
  async getMeta(loc: StorageLocationRef, auth?: ProviderAuth): Promise<FileMetadata> {
    try {
      const s3Location = this.parseS3Location(loc, auth)

      const client = this.createS3Client(auth, s3Location)

      const command = new HeadObjectCommand({
        Bucket: s3Location.bucket,
        Key: s3Location.key,
        VersionId: s3Location.versionId,
      })

      const response: HeadObjectCommandOutput = await client.send(command)

      return {
        name: s3Location.key.split('/').pop(),
        size: response.ContentLength,
        mimeType: response.ContentType,
        etagOrRev: response.ETag?.replace(/"/g, ''), // Remove quotes from ETag
        updatedAt: response.LastModified,
        createdAt: response.LastModified, // S3 doesn't track creation separately
        isFolder: s3Location.key.endsWith('/'),
      }
    } catch (error) {
      this.handleS3Error(error, 'getMeta')
    }
  }

  /**
   * Check if S3 object exists
   */
  async fileExists(loc: StorageLocationRef, auth?: ProviderAuth): Promise<boolean> {
    try {
      await this.getMeta(loc, auth)
      return true
    } catch (error) {
      // If it's a "not found" error, return false
      if (error instanceof StorageFileNotFoundError) {
        return false
      }
      // Re-throw other errors (auth, network, etc.)
      throw error
    }
  }

  // ============= Download Operations =============

  /**
   * Get S3 download reference (presigned URL)
   */
  async getDownloadRef(
    loc: StorageLocationRef,
    auth?: ProviderAuth,
    options: {
      ttlSec?: number
      disposition?: 'inline' | 'attachment'
      filename?: string
      mimeType?: string
    } = {}
  ): Promise<DownloadRef> {
    this.requireCapability('presignDownload')

    try {
      const s3Location = this.parseS3Location(loc, auth)
      const client = this.createS3Client(auth, s3Location)

      const ttlSec = options.ttlSec ?? 3600
      const responseDisposition = options.disposition
        ? this.buildContentDisposition(options.disposition, options.filename || s3Location.key)
        : undefined

      const command = new GetObjectCommand({
        Bucket: s3Location.bucket,
        Key: s3Location.key,
        VersionId: s3Location.versionId,
        ...(responseDisposition && { ResponseContentDisposition: responseDisposition }),
        ...(options.mimeType && { ResponseContentType: options.mimeType }),
      })

      const url = await getSignedUrl(client, command, {
        expiresIn: ttlSec,
      })

      const expiresAt = new Date(Date.now() + ttlSec * 1000)

      return {
        type: 'url',
        url,
        expiresAt,
      }
    } catch (error) {
      this.handleS3Error(error, 'getDownloadRef')
    }
  }

  /**
   * Open S3 object download stream
   */
  async openDownloadStream(
    loc: StorageLocationRef,
    auth?: ProviderAuth
  ): Promise<NodeJS.ReadableStream> {
    try {
      const s3Location = this.parseS3Location(loc, auth)
      const client = this.createS3Client(auth, s3Location)

      const command = new GetObjectCommand({
        Bucket: s3Location.bucket,
        Key: s3Location.key,
        VersionId: s3Location.versionId,
      })

      const response: GetObjectCommandOutput = await client.send(command)

      if (!response.Body) {
        throw new StorageAdapterError('S3 response body is empty', this.id, 'openDownloadStream')
      }

      // The Body can be a ReadableStream or other stream types
      // For Node.js, it should be a Readable stream
      return response.Body as NodeJS.ReadableStream
    } catch (error) {
      this.handleS3Error(error, 'openDownloadStream')
    }
  }

  /**
   * Build a RFC 6266 compliant Content-Disposition header
   */
  private buildContentDisposition(
    disposition: 'inline' | 'attachment',
    keyOrFilename: string
  ): string {
    const fileName = keyOrFilename.split('/').pop() || 'file'
    const quoted = fileName.replace(/"/g, '')
    // RFC 5987 ext-value encoding — bare encodeURIComponent leaves !'()* unencoded,
    // and ' is the ext-value delimiter itself.
    const encoded = encodeRFC5987ValueChars(fileName)

    // Include both filename and filename* for UTF-8 compliance
    return `${disposition}; filename="${quoted}"; filename*=UTF-8''${encoded}`
  }

  // ============= Upload Operations - Single Shot =============

  /**
   * Generate S3 presigned upload URL
   */
  async presignUpload(params: {
    key: string
    mimeType?: string
    size?: number
    ttlSec?: number
    metadata?: Record<string, string>
    bucket?: string // Allow explicit bucket override
    visibility?: 'PUBLIC' | 'PRIVATE' // Auto-select bucket based on visibility
    auth?: ProviderAuth
  }): Promise<PresignedUpload> {
    this.requireCapability('presignUpload')
    try {
      // Determine bucket: explicit > visibility-based > auth. No configured default.
      const bucket = assertBucket(
        params.bucket ||
          (params.visibility ? bucketForVisibility(params.visibility) : '') ||
          (params.auth as any)?.bucket,
        'S3 presignUpload'
      )

      const client = this.createS3Client(params.auth)
      const ttlSec = params.ttlSec || 3600

      // Use presigned POST for form uploads (better for browsers)
      if (params.size && params.size > 0) {
        const conditions: any[] = []

        if (params.mimeType) {
          conditions.push({ 'Content-Type': params.mimeType })
        }

        if (params.size) {
          conditions.push(['content-length-range', 0, params.size])
        }

        const { url, fields } = await createPresignedPost(client, {
          Bucket: bucket,
          Key: params.key,
          Conditions: conditions,
          Fields: {
            ...(params.mimeType && { 'Content-Type': params.mimeType }),
            ...params.metadata,
          },
          Expires: ttlSec,
        })

        return {
          url,
          fields,
          method: 'POST',
          expiresAt: new Date(Date.now() + ttlSec * 1000),
        }
      }

      // Use presigned PUT for direct uploads
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        ContentType: params.mimeType,
        Metadata: params.metadata,
      })

      const url = await getSignedUrl(client, command, {
        expiresIn: ttlSec,
      })

      return {
        url,
        method: 'PUT',
        headers: {
          ...(params.mimeType && { 'Content-Type': params.mimeType }),
        },
        expiresAt: new Date(Date.now() + ttlSec * 1000),
      }
    } catch (error) {
      this.handleS3Error(error, 'presignUpload')
    }
  }

  /**
   * Upload object directly to S3 (server-side upload)
   */
  async putObject(params: {
    key: string
    content: Buffer | NodeJS.ReadableStream
    mimeType?: string
    size?: number
    metadata?: Record<string, string>
    bucket?: string // Explicit bucket override
    visibility?: 'PUBLIC' | 'PRIVATE' // Auto-select bucket
    auth?: ProviderAuth
  }): Promise<{
    etag?: string
    versionId?: string
    size?: number
  }> {
    try {
      // Determine bucket: explicit > visibility-based > auth. No configured default:
      // a wrong-bucket write is invisible and the object leaks (#1816/#1817/#1818).
      const bucket = assertBucket(
        params.bucket ||
          (params.visibility ? bucketForVisibility(params.visibility) : '') ||
          (params.auth as any)?.bucket,
        'S3 putObject'
      )

      const client = this.createS3Client(params.auth)

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: Buffer.isBuffer(params.content) ? params.content : Readable.from(params.content),
        ContentType: params.mimeType,
        ContentLength: params.size,
        Metadata: params.metadata,
      })

      const response = await client.send(command)

      return {
        etag: response.ETag?.replace(/"/g, ''),
        versionId: response.VersionId,
        size: params.size,
      }
    } catch (error) {
      this.handleS3Error(error, 'putObject')
    }
  }

  // ============= Upload Operations - Multipart =============

  /**
   * Start S3 multipart upload
   */
  async startMultipart(params: {
    key: string
    mimeType?: string
    metadata?: Record<string, string>
    bucket?: string // Explicit bucket override
    visibility?: 'PUBLIC' | 'PRIVATE' // Auto-select bucket
    auth?: ProviderAuth
  }): Promise<MultipartUpload> {
    this.requireCapability('presignUpload')

    try {
      // Determine bucket: explicit > visibility-based > auth. No configured default:
      // parts and completion are presigned against whatever bucket this picks, and
      // a mismatch surfaces only as `NoSuchUpload` much later.
      const bucket = assertBucket(
        params.bucket ||
          (params.visibility ? bucketForVisibility(params.visibility) : '') ||
          (params.auth as any)?.bucket,
        'S3 startMultipart'
      )

      const client = this.createS3Client(params.auth)

      const command = new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: params.key,
        ContentType: params.mimeType,
        Metadata: params.metadata,
      })

      const response = await client.send(command)

      if (!response.UploadId) {
        throw new StorageAdapterError(
          'Failed to start multipart upload - no upload ID returned',
          this.id,
          'startMultipart'
        )
      }

      return {
        uploadId: response.UploadId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days (S3 default)
      }
    } catch (error) {
      this.handleS3Error(error, 'startMultipart')
    }
  }

  /**
   * Generate S3 presigned URL for multipart upload part.
   *
   * `params.bucket` is required and must name the bucket `startMultipart` used.
   * There is deliberately no `S3_PRIVATE_BUCKET` fallback here: a PUBLIC upload
   * that initiates in the public bucket and presigns its parts against the
   * private one fails with `NoSuchUpload`.
   */
  async presignPart(params: {
    key: string
    uploadId: string
    partNumber: number
    size?: number
    bucket?: string
    auth?: ProviderAuth
    ttlSec?: number
  }): Promise<PresignedUpload> {
    this.requireCapability('presignUpload')

    try {
      const bucket = assertBucket(params.bucket, 'S3 presignPart')

      const client = this.createS3Client(params.auth)
      const ttlSec = params.ttlSec || 3600

      const command = new UploadPartCommand({
        Bucket: bucket,
        Key: params.key,
        UploadId: params.uploadId,
        PartNumber: params.partNumber,
      })

      const url = await getSignedUrl(client, command, {
        expiresIn: ttlSec,
      })

      return {
        url,
        expiresAt: new Date(Date.now() + ttlSec * 1000),
      }
    } catch (error) {
      this.handleS3Error(error, 'presignPart')
    }
  }

  /**
   * Complete S3 multipart upload.
   *
   * `params.bucket` is required and must name the bucket `startMultipart` used.
   * See {@link presignPart} for why there is no configured-default fallback.
   */
  async completeMultipart(params: {
    key: string
    uploadId: string
    parts: Array<{ partNumber: number; etag: string }>
    bucket?: string
    auth?: ProviderAuth
  }): Promise<{ etag: string; size?: number }> {
    this.requireCapability('presignUpload')

    try {
      const bucket = assertBucket(params.bucket, 'S3 completeMultipart')

      const client = this.createS3Client(params.auth)

      const command = new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: params.key,
        UploadId: params.uploadId,
        MultipartUpload: {
          Parts: params.parts.map((part) => ({
            ETag: part.etag,
            PartNumber: part.partNumber,
          })),
        },
      })

      const response = await client.send(command)

      return {
        etag: response.ETag?.replace(/"/g, '') || '', // Remove quotes
        // S3 doesn't return size in complete response, would need separate HEAD request
      }
    } catch (error) {
      this.handleS3Error(error, 'completeMultipart')
    }
  }

  // ============= File Management =============

  /**
   * Delete S3 object.
   *
   * Unlike the read paths this does NOT fall back to the configured default
   * bucket. S3 returns 204 when the key does not exist, so deleting from the
   * wrong bucket succeeds silently while the real object leaks — the exact
   * failure mode of the upload compensation path for PUBLIC uploads.
   */
  async deleteFile(loc: StorageLocationRef, auth?: ProviderAuth): Promise<void> {
    try {
      const s3Location = this.resolveDeleteTarget(loc)
      const client = this.createS3Client(auth, s3Location)

      const command = new DeleteObjectCommand({
        Bucket: s3Location.bucket,
        Key: s3Location.key,
        VersionId: s3Location.versionId,
      })

      await client.send(command)
    } catch (error) {
      this.handleS3Error(error, 'deleteFile')
    }
  }

  // ============= Versioning =============

  // ============= Authentication Management =============

  // ============= Helper Methods =============

  /**
   * Extract S3 bucket and key from storage location
   */
  private parseS3Location(loc: StorageLocationRef, auth?: ProviderAuth): S3Metadata {
    this.validateLocation(loc)

    // Try to get from metadata first
    if (loc.metadata && typeof loc.metadata === 'object') {
      const metadata = loc.metadata as S3Metadata
      if (metadata.bucket && metadata.key) {
        return metadata
      }
    }

    // Fallback to parsing externalId
    const externalId = loc.externalId

    // Handle s3://bucket/key format
    if (externalId.startsWith('s3://')) {
      const url = new URL(externalId)
      return {
        bucket: url.hostname,
        key: url.pathname.slice(1), // Remove leading slash
        ...loc.metadata,
      }
    }

    // Never parse a bucket out of the key — the externalId IS the storage key.
    // The bucket comes from the pinned auth and nowhere else: falling back to
    // `S3_PRIVATE_BUCKET` here is what made a PUBLIC object read/head against
    // the private bucket and report a phantom 404.
    const bucket = assertBucket((auth as any)?.bucket, `S3 parseLocation for '${externalId}'`)

    return {
      bucket,
      key: externalId,
      ...loc.metadata,
    }
  }

  /**
   * Resolve the bucket + key for a delete, with no default-bucket fallback.
   *
   * The bucket must be explicit: on `loc.metadata.bucket` (what
   * `StorageManager.deleteByKey` and `buildLocationRef` put there) or encoded in
   * an `s3://bucket/key` externalId. Anything else is a programming error.
   */
  private resolveDeleteTarget(loc: StorageLocationRef): S3Metadata {
    this.validateLocation(loc)

    const metadata = loc.metadata as Partial<S3Metadata> | undefined

    if (metadata?.bucket) {
      return { ...metadata, bucket: metadata.bucket, key: metadata.key || loc.externalId }
    }

    if (loc.externalId.startsWith('s3://')) {
      const url = new URL(loc.externalId)
      return { ...metadata, bucket: url.hostname, key: url.pathname.slice(1) }
    }

    throw new StorageAdapterError(
      `Cannot delete S3 object '${loc.externalId}': no bucket on the storage location. Pass \`bucket\` to StorageManager.deleteByKey, or persist it in StorageLocation.metadata.bucket. Deleting against a default bucket would 204 on a missing key and leak the real object.`,
      this.id,
      'deleteFile'
    )
  }

  /**
   * Create S3 client instance with caching
   */
  private createS3Client(auth?: ProviderAuth, config?: Partial<S3Config>): S3Client {
    // Create secure cache key without secret leakage
    const region = config?.region || (auth as any)?.region || configService.get<string>('S3_REGION')
    const endpoint =
      config?.endpoint || (auth as any)?.endpoint || configService.get<string>('S3_ENDPOINT') || ''
    const accessKeyIdPrefix =
      (auth as any)?.accessKeyId?.substring(0, 8) ||
      configService.get<string>('S3_ACCESS_KEY_ID')?.substring(0, 8) ||
      ''

    const cacheKey = `${endpoint}|${region}|${accessKeyIdPrefix}`

    // Return cached client if available
    if (this.clientCache.has(cacheKey)) {
      return this.clientCache.get(cacheKey)!
    }

    // Build S3 client configuration

    const clientConfig: S3ClientConfig = {
      region,
      maxAttempts: config?.maxRetries || 3,
      requestHandler: {
        requestTimeout: config?.timeout || 30000,
      },
      // Enable region redirects to handle cross-region requests
      followRegionRedirects: true,
    }

    // Set endpoint for S3-compatible services
    if (endpoint) {
      clientConfig.endpoint = endpoint
      clientConfig.forcePathStyle = config?.forcePathStyle ?? true
    }

    // Set credentials — priority: explicit auth > config > env vars > IAM role (SDK default)
    if ((auth as any)?.accessKeyId && (auth as any)?.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: (auth as any).accessKeyId,
        secretAccessKey: (auth as any).secretAccessKey,
        sessionToken: (auth as any).sessionToken,
      }
    } else if (config?.credentials) {
      clientConfig.credentials = config.credentials
    } else {
      const envAccessKeyId = configService.get<string>('S3_ACCESS_KEY_ID')
      const envSecretAccessKey = configService.get<string>('S3_SECRET_ACCESS_KEY')
      if (envAccessKeyId && envSecretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: envAccessKeyId,
          secretAccessKey: envSecretAccessKey,
        }
      }
    }
    // If no credentials at all, SDK uses default credential chain (IAM roles, instance profiles)

    const client = new S3Client(clientConfig)

    // Cache the client
    this.clientCache.set(cacheKey, client)

    return client
  }

  /**
   * Handle S3-specific errors and map to appropriate error types
   */
  private handleS3Error(error: any, operation: string): never {
    const errorCode = error.name || error.Code || error.$metadata?.errorCode
    const message = error.message || error.Message || 'Unknown S3 error'

    // Map S3 errors to appropriate error types
    if (errorCode && S3_ERROR_MAP[errorCode]) {
      const errorType = S3_ERROR_MAP[errorCode]

      if (errorType === 'FileNotFound') {
        throw new StorageFileNotFoundError(this.id, '', error)
      } else if (errorType === 'Auth') {
        throw new StorageAuthError(this.id, operation, error)
      } else if (errorType === 'Quota') {
        throw new StorageQuotaError(this.id, operation, error)
      }
    }

    throw new StorageAdapterError(
      `S3 ${operation} failed: ${message} (errorCode: ${errorCode})`,
      this.id,
      operation,
      error
    )
  }
}

// Export default instance
export default S3Adapter
