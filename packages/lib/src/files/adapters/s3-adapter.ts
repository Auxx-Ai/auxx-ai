// packages/lib/src/files/adapters/s3-adapter.ts

import {
  AbortMultipartUploadCommand,
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
import {
  BaseStorageAdapter,
  type DownloadRef,
  type FileMetadata,
  type FileRevision,
  type MultipartUpload,
  type PresignedUpload,
  type ProviderAuth,
  StorageAdapterError,
  StorageAuthError,
  type StorageCapabilities,
  StorageFileNotFoundError,
  type StorageLocationRef,
  StorageQuotaError,
  type WebhookEvent,
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
      serverSideDownload: true,
      versioning: true,
      webhooks: false, // S3 events require SNS/SQS setup
      folders: false, // S3 uses prefixes, not true folders
      search: false, // No native search, requires external indexing
      metadata: true,
      multipart: true,
    }
  }

  /**
   * Build external URL for S3 object
   */
  buildExternalUrl(key: string, auth?: ProviderAuth): string {
    const bucket = (auth as any)?.bucket || process.env.S3_BUCKET
    const region = (auth as any)?.region || process.env.AWS_REGION || 'us-west-1'

    if (bucket) {
      // Use virtual-hosted-style URL for S3
      return `https://${bucket}.s3.${region}.amazonaws.com/${key}`
    }

    // If no bucket available, just return the key
    return key
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
      const s3Location = this.parseS3Location(loc, auth!)
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
      const s3Location = this.parseS3Location(loc, auth!)
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
    const encoded = encodeURIComponent(fileName)

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
      // Determine bucket: explicit > visibility-based > auth > env default
      let bucket = params.bucket

      if (!bucket && params.visibility) {
        // Import getBucketForVisibility dynamically
        const { getBucketForVisibility } = await import('../upload/util')
        bucket = getBucketForVisibility(params.visibility)
      }

      if (!bucket) {
        bucket = (params.auth as any)?.bucket
      }

      if (!bucket) {
        throw new StorageAdapterError(
          'S3 bucket name is required for presigned upload. Please provide a bucket via params, credentials, or set S3_BUCKET environment variable.',
          this.id,
          'presignUpload'
        )
      }

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
      // Determine bucket: explicit > visibility-based > auth > env default
      let bucket = params.bucket

      if (!bucket && params.visibility) {
        const { getBucketForVisibility } = await import('../upload/util')
        bucket = getBucketForVisibility(params.visibility)
      }

      if (!bucket) {
        bucket = (params.auth as any)?.bucket || process.env.S3_BUCKET
      }

      if (!bucket) {
        throw new StorageAdapterError(
          'S3 bucket name is required for direct upload. Please provide a bucket via params, credentials, or set S3_BUCKET environment variable.',
          this.id,
          'putObject'
        )
      }

      const client = this.createS3Client(params.auth)

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.content,
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
      // Determine bucket: explicit > visibility-based > auth > env default
      let bucket = params.bucket

      if (!bucket && params.visibility) {
        const { getBucketForVisibility } = await import('../upload/util')
        bucket = getBucketForVisibility(params.visibility)
      }

      if (!bucket) {
        bucket = (params.auth as any)?.bucket || process.env.S3_BUCKET
      }

      if (!bucket) {
        throw new StorageAdapterError(
          'S3 bucket name is required for multipart upload. Please provide a bucket via params, credentials, or set S3_BUCKET environment variable.',
          this.id,
          'startMultipart'
        )
      }

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
   * Generate S3 presigned URL for multipart upload part
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
      const bucket = params.bucket || (params.auth as any)?.bucket || process.env.S3_BUCKET
      if (!bucket) {
        throw new StorageAdapterError(
          'S3 bucket name is required for part upload. Please provide a bucket via params, credentials, or set S3_BUCKET environment variable.',
          this.id,
          'presignPart'
        )
      }

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
   * Complete S3 multipart upload
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
      const bucket = params.bucket || (params.auth as any)?.bucket || process.env.S3_BUCKET
      if (!bucket) {
        throw new StorageAdapterError(
          'S3 bucket name is required to complete multipart upload. Please provide a bucket via params, credentials, or set S3_BUCKET environment variable.',
          this.id,
          'completeMultipart'
        )
      }

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

  /**
   * Abort S3 multipart upload
   */
  async abortMultipart(params: {
    key: string
    uploadId: string
    bucket?: string
    auth?: ProviderAuth
  }): Promise<void> {
    try {
      const bucket = params.bucket || (params.auth as any)?.bucket || process.env.S3_BUCKET
      if (!bucket) {
        throw new StorageAdapterError(
          'S3 bucket name is required to abort multipart upload. Please provide a bucket via params, credentials, or set S3_BUCKET environment variable.',
          this.id,
          'abortMultipart'
        )
      }

      const client = this.createS3Client(params.auth)

      const command = new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: params.key,
        UploadId: params.uploadId,
      })

      await client.send(command)
    } catch (error) {
      this.handleS3Error(error, 'abortMultipart')
    }
  }

  // ============= File Management =============

  /**
   * Create S3 object
   */
  async createFile(params: {
    name: string
    parentFolderId?: string
    content: NodeJS.ReadableStream | Buffer
    mimeType?: string
    auth: ProviderAuth
  }): Promise<{ id: string; name: string }> {
    await this.validateAuth(params.auth)

    // TODO: Implement S3 PutObjectCommand
    // Handle parentFolderId as key prefix
    throw new Error('Not implemented')
  }

  /**
   * Update S3 object
   */
  async updateFile(params: {
    fileId: string
    content?: NodeJS.ReadableStream | Buffer
    name?: string
    auth: ProviderAuth
  }): Promise<{ id: string; rev?: string }> {
    await this.validateAuth(params.auth)

    // TODO: Implement S3 object update
    // S3 doesn't have true updates, requires PUT with new content
    throw new Error('Not implemented')
  }

  /**
   * Delete S3 object
   */
  async deleteFile(loc: StorageLocationRef, auth?: ProviderAuth): Promise<void> {
    try {
      const s3Location = this.parseS3Location(loc, auth!)
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

  // ============= Folder Management =============

  /**
   * Create S3 "folder" (prefix) - Not supported for S3 adapter
   */
  async createFolder(params: {
    name: string
    parentFolderId?: string
    auth: ProviderAuth
  }): Promise<{ id: string; name: string }> {
    this.requireCapability('folders')
    // This will throw since S3 has folders: false in capabilities
  }

  /**
   * List S3 objects with prefix - Not supported for S3 adapter
   */
  async listFolder(params: {
    folderId?: string
    auth: ProviderAuth
    limit?: number
    cursor?: string
  }): Promise<{
    files: FileMetadata[]
    nextCursor?: string
  }> {
    this.requireCapability('folders')
    // This will throw since S3 has folders: false in capabilities
  }

  // ============= Versioning =============

  /**
   * List S3 object versions
   */
  async listRevisions(loc: StorageLocationRef, auth?: ProviderAuth): Promise<FileRevision[]> {
    this.validateLocation(loc)
    this.requireCapability('versioning')

    // TODO: Implement S3 ListObjectVersionsCommand
    throw new Error('Not implemented')
  }

  /**
   * Get specific S3 object version
   */
  async getRevision(
    loc: StorageLocationRef,
    revisionId: string,
    auth?: ProviderAuth
  ): Promise<NodeJS.ReadableStream> {
    this.validateLocation(loc)
    this.requireCapability('versioning')

    // TODO: Implement S3 GetObjectCommand with VersionId
    throw new Error('Not implemented')
  }

  // ============= Authentication Management =============

  /**
   * Refresh S3 credentials (if using STS)
   */
  async refreshAuth(auth: ProviderAuth): Promise<ProviderAuth> {
    // For most S3 use cases, credentials don't need refreshing
    // STS token refresh would be handled by the credential provider
    // This is more relevant for OAuth-based providers like Google Drive
    return auth
  }

  /**
   * Validate S3 authentication
   */
  async validateAuth(auth?: ProviderAuth): Promise<boolean> {
    try {
      const client = this.createS3Client(auth)

      // Try a simple operation to test credentials
      // Use ListBuckets as a lightweight test
      const { ListBucketsCommand } = await import('@aws-sdk/client-s3')
      const command = new ListBucketsCommand({})

      await client.send(command)
      return true
    } catch (error: any) {
      // If it's an auth error, return false
      const errorCode = error.name || error.Code || error.$metadata?.errorCode
      if (
        [
          'AccessDenied',
          'InvalidAccessKeyId',
          'SignatureDoesNotMatch',
          'TokenRefreshRequired',
        ].includes(errorCode)
      ) {
        return false
      }
      // Re-throw other errors (network, etc.)
      throw error
    }
  }

  // ============= Webhook Support =============

  /**
   * Validate S3 event notification webhook
   */
  async validateWebhook(payload: unknown, signature?: string): Promise<boolean> {
    // TODO: Implement S3 event notification validation
    // Validate SNS signature if using SNS notifications
    throw new Error('Not implemented')
  }

  /**
   * Process S3 event notification
   */
  async processWebhook(payload: unknown): Promise<WebhookEvent[]> {
    // TODO: Implement S3 event processing
    // Parse S3 event notification format
    throw new Error('Not implemented')
  }

  // ============= Helper Methods =============

  /**
   * Extract S3 bucket and key from storage location
   */
  private parseS3Location(loc: StorageLocationRef, auth: ProviderAuth): S3Metadata {
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

    // ✅ ALWAYS use configured bucket - don't try to parse bucket from key
    // The externalId is the storage key, not bucket/key format
    // Priority: auth.bucket > env.S3_BUCKET
    const bucket = (auth as any)?.bucket || process.env.S3_BUCKET

    if (bucket) {
      return {
        bucket,
        key: externalId, // ✅ Use full externalId as the key
        ...loc.metadata,
      }
    }

    throw new StorageAdapterError(
      `Invalid S3 location format: ${externalId}. Either provide s3://bucket/key format, bucket/key format, or set S3_BUCKET environment variable.`,
      this.id,
      'parseLocation'
    )
  }

  /**
   * Create S3 client instance with caching
   */
  private createS3Client(auth?: ProviderAuth, config?: Partial<S3Config>): S3Client {
    // Create secure cache key without secret leakage
    const region = config?.region || (auth as any)?.region || process.env.S3_REGION
    const endpoint = config?.endpoint || (auth as any)?.endpoint || ''
    const accessKeyIdPrefix = (auth as any)?.accessKeyId?.substring(0, 8) || ''

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
    if (config?.endpoint || (auth as any)?.endpoint) {
      clientConfig.endpoint = config?.endpoint || (auth as any)?.endpoint
      clientConfig.forcePathStyle = config?.forcePathStyle ?? true
    }

    // Set credentials - AWS standard format only
    if ((auth as any)?.accessKeyId && (auth as any)?.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: (auth as any).accessKeyId,
        secretAccessKey: (auth as any).secretAccessKey,
        sessionToken: (auth as any).sessionToken,
      }
    } else if (config?.credentials) {
      clientConfig.credentials = config.credentials

      // Config credentials in use
    }
    // If no explicit credentials, SDK will use default credential chain

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
