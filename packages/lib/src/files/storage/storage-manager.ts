// packages/lib/src/files/storage/storage-manager.ts

import { credentialManager } from '@auxx/credentials'
import type { StorageLocationEntity as StorageLocation } from '@auxx/database/models'
import { createScopedLogger } from '@auxx/logger'
import type {
  DownloadRef,
  FileMetadata,
  MultipartUpload,
  PresignedUpload,
  ProviderAuth,
  ProviderId,
  StorageAdapter,
  StorageCapabilities,
  StorageLocationRef,
  WebhookEvent,
} from '../adapters/base-adapter'
import {
  StorageAdapterError,
  StorageAuthError,
  StorageFileNotFoundError,
} from '../adapters/base-adapter'
import type { UploadPreparedConfig } from '../upload/init-types'
import { getBucketForVisibility } from '../upload/util'
import { storageLocationService } from './storage-location-service'

const logger = createScopedLogger('storage-manager')

/**
 * Parameters for uploading files to storage providers
 *
 * @example
 * ```typescript
 * const uploadParams: StorageUploadParams = {
 *   provider: 'S3',
 *   key: 'org123/documents/file.pdf',
 *   content: fileBuffer,
 *   mimeType: 'application/pdf',
 *   size: 1024000,
 *   metadata: { category: 'documents', author: 'user123' },
 *   credentialId: 'cred_aws_s3_prod'
 * }
 * ```
 */
export interface StorageUploadParams {
  provider: ProviderId
  key: string
  content: Buffer | NodeJS.ReadableStream
  mimeType?: string
  size?: number
  metadata?: Record<string, string>
  credentialId?: string
}

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
 * Storage copy parameters
 */
export interface StorageCopyParams {
  sourceLocationId: string
  targetProvider: ProviderId
  targetKey?: string
  targetCredentialId?: string
}

/**
 * Storage migration parameters
 */
export interface StorageMigrationParams {
  locationId: string
  targetProvider: ProviderId
  targetCredentialId?: string
  deleteSource?: boolean
}

/**
 * Callback function for tracking file upload progress
 *
 * @example
 * ```typescript
 * const onProgress: UploadProgressCallback = (progress) => {
 *   console.log(`Upload: ${progress.percentage}% (${progress.bytesUploaded}/${progress.totalBytes})`)
 *   updateProgressBar(progress.percentage)
 * }
 * ```
 */
export type UploadProgressCallback = (progress: {
  bytesUploaded: number
  totalBytes: number
  percentage: number
  stage: 'preparing' | 'uploading' | 'completing' | 'completed'
}) => void

/**
 * Storage usage statistics
 */
export interface StorageUsageStats {
  totalFiles: number
  totalSize: bigint
  byProvider: Record<ProviderId, { files: number; size: bigint }>
  byOrganization: Record<string, { files: number; size: bigint }>
}

/**
 * Storage health check result
 */
export interface StorageHealthCheck {
  provider: ProviderId
  healthy: boolean
  latency?: number
  error?: string
  capabilities: StorageCapabilities
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
 * @see {@link StorageLocationService} for database operations
 * @since 1.0.0
 */
export class StorageManager {
  protected readonly organizationId?: string

  constructor(organizationId?: string) {
    this.organizationId = organizationId
  }

  /**
   * Get organization ID, throwing error if required but not provided
   *
   * @returns The organization ID for this manager instance
   * @throws {Error} When organization ID is required but not provided
   *
   * @internal
   */
  protected requireOrganization(): string {
    if (!this.organizationId) {
      throw new Error('Organization ID is required for this operation')
    }
    return this.organizationId
  }

  // ============= Core Storage Operations =============

  /**
   * Upload a file to storage using the appropriate adapter
   *
   * @deprecated This method is deprecated and will be removed in a future version.
   * Use the presigned upload flow instead:
   * 1. Call generatePresignedUploadUrl() to get upload URL
   * 2. Client uploads file to the URL
   * 3. Create storage location record after successful upload
   *
   * This method only generates a presigned URL and creates a DB record,
   * but doesn't actually upload the file content.
   *
   * @param params - Upload parameters including provider, content, and metadata
   * @returns Promise resolving to the created StorageLocation record
   *
   * @throws {StorageAdapterError} When provider is unavailable or upload fails
   * @throws {StorageAuthError} When authentication is invalid or missing
   */
  async uploadFile(params: StorageUploadParams): Promise<StorageLocation> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await this.getAdapter(params.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await this.getProviderAuth(params.provider, params.credentialId)

    try {
      // Check if adapter supports direct upload
      const capabilities = adapter.getCapabilities()

      if (capabilities.presignUpload) {
        // Use presigned upload for better performance
        const presignedUpload = await (adapter as any).presignUpload({
          key: params.key,
          mimeType: params.mimeType,
          size: params.size,
          metadata: params.metadata,
          auth,
        })

        // TODO: For now, create storage location record
        // In a real implementation, this would be done after successful upload
        const storageLocation = await this.createStorageLocation({
          provider: params.provider as any,
          externalId: params.key,
          externalUrl: presignedUpload.url,
          credentialId: params.credentialId,
          size: params.size ? BigInt(params.size) : undefined,
          mimeType: params.mimeType,
          metadata: {
            ...(params.metadata || {}),
            presignedUpload: true,
            uploadExpiry: presignedUpload.expiresAt,
          },
          externalRev: '',
        })

        return storageLocation
      } else {
        // Fallback to server-side upload (not implemented yet)
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support presigned uploads and server-side upload is not yet implemented`,
          params.provider,
          'uploadFile'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'uploadFile', params.provider)
    }
  }

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
    const adapter = await this.getAdapter(params.provider)

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
    auth = await this.getProviderAuth(params.provider, params.credentialId)

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
      const externalUrl = adapter.buildExternalUrl
        ? adapter.buildExternalUrl(params.key, auth)
        : params.key

      // Create storage location record
      const storageLocation = await this.createStorageLocation({
        provider: params.provider,
        externalId: params.key,
        externalUrl,
        externalRev: result.etag || '',
        credentialId: params.credentialId,
        size: result.size ? BigInt(result.size) : undefined,
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
   * Upload a file with progress tracking
   */
  async uploadFileWithProgress(
    params: StorageUploadParams,
    onProgress?: UploadProgressCallback
  ): Promise<StorageLocation> {
    // TODO: Implement file upload with real-time progress callbacks
    throw new Error('Not implemented')
  }

  /**
   * Upload large file using multipart upload
   */
  async uploadLargeFile(
    params: StorageUploadParams & { partSize?: number },
    onProgress?: UploadProgressCallback
  ): Promise<StorageLocation> {
    // TODO: Implement multipart upload for large files
    throw new Error('Not implemented')
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
    const storageLocation = await storageLocationService.get(params.locationId)
    if (!storageLocation) {
      throw new StorageFileNotFoundError('UNKNOWN' as ProviderId, params.locationId)
    }

    // Build location reference
    const locationRef = this.buildLocationRef(storageLocation)

    // Get adapter for the provider
    const adapter = await this.getAdapter(locationRef.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await this.getProviderAuth(locationRef.provider, locationRef.credentialId)

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
    const storageLocation = await storageLocationService.get(locationId)
    if (!storageLocation) {
      throw new StorageFileNotFoundError('UNKNOWN' as ProviderId, locationId)
    }

    // Build location reference
    const locationRef = this.buildLocationRef(storageLocation)

    // Get adapter for the provider
    const adapter = await this.getAdapter(locationRef.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    if (locationRef.credentialId) {
      auth = await this.getProviderAuth(locationRef.provider, locationRef.credentialId)
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
   * Get file metadata from storage using location ID
   *
   * Use this method when you have a storage location record and need
   * full file metadata. For direct storage verification without a location record,
   * use headByKey() instead.
   */
  async getFileMetadata(locationId: string): Promise<FileMetadata> {
    // Get storage location from database
    const storageLocation = await storageLocationService.get(locationId)
    if (!storageLocation) {
      throw new StorageFileNotFoundError('UNKNOWN' as ProviderId, locationId)
    }

    // Build location reference
    const locationRef = this.buildLocationRef(storageLocation)

    // Get adapter for the provider
    const adapter = await this.getAdapter(locationRef.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    if (locationRef.credentialId) {
      auth = await this.getProviderAuth(locationRef.provider, locationRef.credentialId)
    }

    try {
      // Use adapter to get file metadata
      return await adapter.getMeta(locationRef, auth)
    } catch (error) {
      this.handleStorageError(error, 'getFileMetadata', locationRef.provider)
    }
  }

  /**
   * Delete file from storage
   */
  async deleteFile(locationId: string): Promise<void> {
    // Get storage location from database
    const storageLocation = await storageLocationService.get(locationId)
    if (!storageLocation) {
      throw new StorageFileNotFoundError('UNKNOWN' as ProviderId, locationId)
    }

    // Build location reference
    const locationRef = this.buildLocationRef(storageLocation)

    // Get adapter for the provider
    const adapter = await this.getAdapter(locationRef.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    if (locationRef.credentialId) {
      auth = await this.getProviderAuth(locationRef.provider, locationRef.credentialId)
    }

    try {
      // Use adapter to delete file
      if (adapter.deleteFile) {
        await adapter.deleteFile(locationRef, auth)

        // Remove storage location record from database
        await storageLocationService.delete(locationId)
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
   * Build external URL for a storage location
   *
   * This method provides a public API for building external URLs for storage locations
   * without exposing internal adapter or auth methods.
   *
   * @param provider - The storage provider ID
   * @param key - The storage key/path
   * @param credentialId - Optional credential ID for authentication
   * @returns Promise resolving to the external URL
   *
   * @example
   * ```typescript
   * const externalUrl = await storageManager.buildExternalUrl(
   *   'S3',
   *   'org-123/file.pdf',
   *   's3_cred_id'
   * )
   * ```
   */
  async buildExternalUrl(
    provider: ProviderId,
    key: string,
    credentialId?: string
  ): Promise<string> {
    // Get adapter for the provider
    const adapter = await this.getAdapter(provider)

    // Check if adapter supports building external URLs
    if (!adapter.buildExternalUrl) {
      // Return the key as a fallback for providers without URL building
      return key
    }

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    if (credentialId) {
      try {
        auth = await this.getProviderAuth(provider, credentialId)
      } catch (error) {
        logger.warn('Failed to get auth for building external URL', {
          provider,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    try {
      // Use adapter to build external URL
      return adapter.buildExternalUrl(key, auth)
    } catch (error) {
      logger.warn('Failed to build external URL, returning key as fallback', {
        provider,
        key,
        error: error instanceof Error ? error.message : String(error),
      })
      return key
    }
  }

  /**
   * Create a new storage location record (enhanced to support transactions)
   */
  async createStorageLocation(
    params: {
      provider: ProviderId
      externalId: string
      externalUrl?: string
      externalRev?: string
      credentialId?: string
      size?: bigint
      mimeType?: string
      metadata?: Record<string, any>
      bucket?: string
      visibility?: 'PUBLIC' | 'PRIVATE'
    },
    opts?: { tx?: any }
  ): Promise<StorageLocation> {
    try {
      // Validate provider
      if (!this.isProviderAvailable(params.provider)) {
        throw new StorageAdapterError(
          `Provider ${params.provider} is not available`,
          params.provider,
          'createStorageLocation'
        )
      }

      const metadata = await this.prepareLocationMetadata(params)

      // Use service method with optional transaction
      return await storageLocationService.create(
        {
          provider: params.provider as any, // Type cast for DB enum
          externalId: params.externalId,
          externalUrl: params.externalUrl || '',
          externalRev: params.externalRev || '',
          credentialId: params.credentialId,
          size: params.size,
          mimeType: params.mimeType,
          metadata,
        },
        opts?.tx
      )
    } catch (error) {
      this.handleStorageError(error, 'createStorageLocation', params.provider)
    }
  }

  /**
   * Get storage location by ID
   */
  async getStorageLocation(id: string): Promise<StorageLocation | null> {
    try {
      return await storageLocationService.get(id)
    } catch (error) {
      this.handleStorageError(error, 'getStorageLocation', 'UNKNOWN' as ProviderId)
    }
  }

  /**
   * Update storage location metadata
   */
  async updateStorageLocation(
    id: string,
    updates: {
      externalUrl?: string
      externalRev?: string
      size?: bigint
      mimeType?: string
      metadata?: Record<string, any>
    }
  ): Promise<StorageLocation> {
    try {
      return await storageLocationService.update(id, updates)
    } catch (error) {
      this.handleStorageError(error, 'updateStorageLocation', 'UNKNOWN' as ProviderId)
    }
  }

  /**
   * Find storage locations by criteria
   */
  async findStorageLocations(criteria: {
    provider?: ProviderId
    credentialId?: string
    externalId?: string
    limit?: number
    offset?: number
  }): Promise<StorageLocation[]> {
    try {
      // For now, use available service methods
      if (criteria.provider && !criteria.credentialId && !criteria.externalId) {
        return await storageLocationService.getLocationsByProvider(criteria.provider as any)
      }

      if (criteria.credentialId && !criteria.provider && !criteria.externalId) {
        return await storageLocationService.getLocationsByCredential(criteria.credentialId)
      }

      if (criteria.provider && criteria.externalId) {
        return await storageLocationService.findByExternalId(
          criteria.provider as any,
          criteria.externalId
        )
      }

      // TODO: Implement more complex search with limit/offset when service methods are ready
      throw new Error('Complex search criteria not yet implemented')
    } catch (error) {
      this.handleStorageError(error, 'findStorageLocations', 'UNKNOWN' as ProviderId)
    }
  }

  // ============= Provider Authentication =============

  /**
   * Get provider authentication for a specific adapter (provider-aware)
   */
  private async getProviderAuth(
    adapterId: ProviderId,
    credentialId?: string
  ): Promise<ProviderAuth> {
    const adapter = await this.getAdapter(adapterId)
    const credentialProviderId = adapter.credentialProviderId

    try {
      const auth = await credentialManager.getCredentials(
        credentialProviderId!,
        this.organizationId,
        credentialId
      )

      return auth
    } catch (error) {
      // Enhanced error handling with fallback information
      const errorMessage = error instanceof Error ? error.message : String(error)

      throw new StorageAuthError(
        adapterId,
        'getProviderAuth',
        `Failed to get credentials for ${adapterId}: ${errorMessage}.`
      )
    }
  }

  /**
   * Refresh provider authentication tokens
   */
  async refreshProviderAuth(adapterId: ProviderId, credentialId: string): Promise<ProviderAuth> {
    // For now, re-fetch credentials (future: implement actual token refresh)
    return this.getProviderAuth(adapterId, credentialId)
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

    if (!bucket) {
      const visibility = params.visibility || visibilityFromMetadata
      if (visibility === 'PUBLIC' || visibility === 'PRIVATE') {
        bucket = getBucketForVisibility(visibility)
      }
    }

    if (!bucket && params.credentialId) {
      try {
        const auth = await this.getProviderAuth('S3', params.credentialId)
        bucket =
          (auth as any)?.bucket ||
          (auth as any)?.Bucket ||
          (auth as any)?.s3Bucket ||
          (auth as any)?.publicBucket ||
          (auth as any)?.privateBucket
      } catch (error) {
        logger.warn('Failed to resolve bucket from credentials', {
          credentialId: params.credentialId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (!bucket) {
      bucket =
        process.env.S3_PRIVATE_BUCKET ||
        process.env.NEXT_PUBLIC_S3_PRIVATE_BUCKET ||
        process.env.S3_PUBLIC_BUCKET ||
        process.env.NEXT_PUBLIC_S3_PUBLIC_BUCKET ||
        process.env.S3_BUCKET ||
        undefined
    }

    return bucket || undefined
  }

  /**
   * Validate provider authentication for a specific adapter
   */
  async validateProviderAuth(adapterId: ProviderId, credentialId?: string): Promise<boolean> {
    try {
      await this.getProviderAuth(adapterId, credentialId)
      return true
    } catch (error) {
      logger.warn('Provider authentication validation failed', {
        adapterId,
        hasCredentialId: Boolean(credentialId),
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * Test provider connectivity and get capabilities
   */
  async testProviderConnection(
    adapterId: ProviderId,
    credentialId?: string
  ): Promise<{
    connected: boolean
    error?: string
    capabilities?: StorageCapabilities
  }> {
    try {
      // Get the adapter and credential provider ID
      const adapter = await this.getAdapter(adapterId)
      const credentialProviderId = adapter.credentialProviderId || adapterId.toLowerCase()

      // Test connection using CredentialManager
      const connectionResult = await credentialManager.testCredentials(
        credentialProviderId,
        credentialId,
        this.organizationId
      )

      if (connectionResult.success) {
        // Get adapter capabilities
        const capabilities = await this.getProviderCapabilities(adapterId)

        return {
          connected: true,
          capabilities,
        }
      } else {
        return {
          connected: false,
          error: connectionResult.message,
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      logger.error('Provider connection test failed', {
        adapterId,
        credentialId: credentialId ? '***' : undefined,
        error: errorMessage,
      })

      return {
        connected: false,
        error: errorMessage,
      }
    }
  }

  // ============= Credential Management Integration =============

  // ============= Adapter Management =============

  /**
   * Get provider capabilities
   *
   * Retrieves the capabilities of a specific storage provider, indicating
   * which features are supported (presigned URLs, multipart uploads, etc.).
   *
   * @param provider - The provider ID to check capabilities for
   * @returns Promise resolving to the provider's capabilities
   *
   * @example
   * ```typescript
   * const capabilities = await manager.getProviderCapabilities('S3')
   *
   * if (capabilities.presignUpload) {
   *   console.log('Provider supports presigned uploads')
   * }
   *
   * if (capabilities.versioning) {
   *   console.log('Provider supports file versioning')
   * }
   * ```
   *
   * @see {@link isProviderAvailable} for checking provider availability
   * @see {@link getProviderStatus} for health status
   */
  async getProviderCapabilities(provider: ProviderId): Promise<StorageCapabilities> {
    const adapter = await this.getAdapter(provider)
    return adapter.getCapabilities()
  }

  /**
   * Check if provider is available
   */
  isProviderAvailable(provider: ProviderId): boolean {
    return this.hasAdapter(provider)
  }

  // ============= Adapter Registry =============

  /**
   * Dynamic adapter loading registry with lazy loading and caching
   *
   * This registry maps provider IDs to their adapter loading functions.
   * Adapters are loaded lazily when first requested and then cached for
   * performance. This allows the system to only load the adapters that
   * are actually used.
   *
   * @example Adding a new provider:
   * ```typescript
   * // In the adapters object:
   * DROPBOX: async () => (await import('../adapters/dropbox-adapter')).DropboxAdapter,
   * ```
   *
   * @internal
   */
  private static adapters = {
    S3: async () => (await import('../adapters/s3-adapter')).default,
    // GOOGLE_DRIVE: async () => (await import('../adapters/google-drive-adapter')).GoogleDriveAdapter,
    // DROPBOX: async () => (await import('../adapters/dropbox-adapter')).DropboxAdapter,
    // ONEDRIVE: async () => (await import('../adapters/onedrive-adapter')).OneDriveAdapter,
    // BOX: async () => (await import('../adapters/box-adapter')).BoxAdapter,
    // GENERIC_URL: async () => (await import('../adapters/url-adapter')).UrlAdapter,
  } as const

  /**
   * Adapter instance cache
   */
  private static adapterCache = new Map<ProviderId, StorageAdapter>()

  /**
   * Get storage adapter for provider
   *
   * Retrieves or loads the adapter for a specific storage provider.
   * Implements lazy loading and caching to optimize performance.
   *
   * @param provider - The provider ID to get adapter for
   * @returns Promise resolving to the storage adapter instance
   *
   * @throws {StorageAdapterError} When adapter is not available or fails to load
   *
   * @internal
   */
  private async getAdapter(provider: ProviderId): Promise<StorageAdapter> {
    // Return cached adapter if available
    if (StorageManager.adapterCache.has(provider)) {
      return StorageManager.adapterCache.get(provider)!
    }

    // Load adapter dynamically
    const adapterLoader = StorageManager.adapters[provider as keyof typeof StorageManager.adapters]
    if (!adapterLoader) {
      throw new StorageAdapterError(
        `No adapter available for provider: ${provider}`,
        provider,
        'getAdapter'
      )
    }

    try {
      const AdapterClass = await adapterLoader()
      const adapter = new AdapterClass()

      // Cache the adapter instance
      StorageManager.adapterCache.set(provider, adapter)

      return adapter
    } catch (error) {
      throw new StorageAdapterError(
        `Failed to load adapter for provider ${provider}: ${error}`,
        provider,
        'getAdapter',
        error as Error
      )
    }
  }

  /**
   * Preload adapters for faster access
   */
  async preloadAdapters(providers: ProviderId[]): Promise<void> {
    await Promise.all(providers.map((provider) => this.getAdapter(provider)))
  }

  /**
   * Get available adapter providers
   */
  getAvailableProviders(): ProviderId[] {
    return Object.keys(StorageManager.adapters) as ProviderId[]
  }

  /**
   * Check if adapter is available for a provider
   */
  hasAdapter(provider: ProviderId): boolean {
    return provider in StorageManager.adapters
  }

  // ============= File Operations =============

  /**
   * Copy file from one storage location to another
   */
  async copyFile(params: StorageCopyParams): Promise<StorageLocation> {
    // TODO: Implement cross-provider file copying
    throw new Error('Not implemented')
  }

  /**
   * Move file from one storage location to another
   */
  async moveFile(params: StorageCopyParams): Promise<StorageLocation> {
    // TODO: Implement cross-provider file moving
    throw new Error('Not implemented')
  }

  /**
   * Migrate file from one provider to another
   */
  async migrateFile(params: StorageMigrationParams): Promise<StorageLocation> {
    // TODO: Implement provider migration with optional source deletion
    throw new Error('Not implemented')
  }

  /**
   * Duplicate file within the same provider
   */
  async duplicateFile(locationId: string, newKey: string): Promise<StorageLocation> {
    // TODO: Implement file duplication
    throw new Error('Not implemented')
  }

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
    const adapter = await this.getAdapter(config.provider)

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
    auth = await this.getProviderAuth(config.provider, config.credentialId)

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
    const adapter = await this.getAdapter(config.provider)

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
    auth = await this.getProviderAuth(config.provider, config.credentialId)

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
   */
  async completeMultipartUploadOnly(params: {
    provider: ProviderId
    key: string
    uploadId: string
    parts: Array<{ partNumber: number; etag: string }>
    credentialId?: string
  }): Promise<{ etag: string; size?: number }> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await this.getAdapter(params.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await this.getProviderAuth(params.provider, params.credentialId)

    try {
      // Use adapter to complete multipart upload without creating DB record
      if ((adapter as any).completeMultipart) {
        return await (adapter as any).completeMultipart({
          key: params.key,
          uploadId: params.uploadId,
          parts: params.parts,
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
   */
  async deleteByKey(params: {
    provider: ProviderId
    key: string
    credentialId?: string
  }): Promise<void> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await this.getAdapter(params.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    try {
      auth = await this.getProviderAuth(params.provider, params.credentialId)
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

    try {
      // Build location reference for adapter
      const locationRef = {
        provider: params.provider,
        externalId: params.key,
        credentialId: params.credentialId,
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
   * Start multipart upload
   *
   * Initiates a multipart upload session for large files. This allows files
   * to be uploaded in chunks, providing better reliability and the ability
   * to resume failed uploads.
   *
   * The typical multipart upload flow:
   * 1. Start multipart upload (this method)
   * 2. Generate part upload URLs ({@link generatePartUploadUrl})
   * 3. Upload parts to the URLs
   * 4. Complete the upload ({@link completeMultipartUpload})
   *
   * @param params - Multipart upload initialization parameters
   * @returns Promise resolving to multipart upload information
   *
   * @throws {StorageAdapterError} When provider doesn't support multipart uploads
   * @throws {StorageAuthError} When authentication is invalid
   *
   * @example
   * ```typescript
   * // Start multipart upload for a large video file
   * const multipart = await manager.startMultipartUpload({
   *   provider: 'S3',
   *   key: 'videos/large-video.mp4',
   *   mimeType: 'video/mp4',
   *   metadata: { quality: '4K', duration: '120min' },
   *   credentialId: 's3_cred_id'
   * })
   *
   * console.log(`Upload ID: ${multipart.uploadId}`)
   * console.log(`Expires: ${multipart.expiresAt}`)
   * ```
   *
   * @see {@link generatePartUploadUrl} for uploading individual parts
   * @see {@link completeMultipartUpload} for finalizing the upload
   * @see {@link abortMultipartUpload} for canceling the upload
   */
  async startMultipartUpload(params: {
    provider: ProviderId
    key: string
    mimeType?: string
    metadata?: Record<string, string>
    credentialId?: string
  }): Promise<MultipartUpload> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await this.getAdapter(params.provider)

    // Check if adapter supports multipart uploads
    const capabilities = adapter.getCapabilities()
    if (!capabilities.presignUpload) {
      throw new StorageAdapterError(
        `Provider ${params.provider} does not support multipart uploads`,
        params.provider,
        'startMultipartUpload'
      )
    }

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await this.getProviderAuth(params.provider, params.credentialId)

    try {
      // Use adapter to start multipart upload
      if ((adapter as any).startMultipart) {
        return await (adapter as any).startMultipart({
          key: params.key,
          mimeType: params.mimeType,
          metadata: params.metadata,
          auth,
        })
      } else {
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support multipart uploads`,
          params.provider,
          'startMultipartUpload'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'startMultipartUpload', params.provider)
    }
  }

  /**
   * Generate presigned URL for upload part
   */
  async generatePartUploadUrl(params: {
    provider: ProviderId
    key: string
    uploadId: string
    partNumber: number
    size?: number
    credentialId?: string
  }): Promise<PresignedUpload> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await this.getAdapter(params.provider)

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
    auth = await this.getProviderAuth(params.provider, params.credentialId)

    try {
      // Use adapter to generate part upload URL
      if ((adapter as any).presignPart) {
        return await (adapter as any).presignPart({
          key: params.key,
          uploadId: params.uploadId,
          partNumber: params.partNumber,
          size: params.size,
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

  /**
   * Complete multipart upload
   */
  async completeMultipartUpload(params: {
    provider: ProviderId
    key: string
    uploadId: string
    parts: Array<{ partNumber: number; etag: string }>
    credentialId?: string
  }): Promise<StorageLocation> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await this.getAdapter(params.provider)

    // Check if adapter supports multipart uploads
    const capabilities = adapter.getCapabilities()
    if (!capabilities.presignUpload) {
      throw new StorageAdapterError(
        `Provider ${params.provider} does not support multipart upload completion`,
        params.provider,
        'completeMultipartUpload'
      )
    }

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await this.getProviderAuth(params.provider, params.credentialId)

    try {
      // Use adapter to complete multipart upload
      if ((adapter as any).completeMultipart) {
        const result = await (adapter as any).completeMultipart({
          key: params.key,
          uploadId: params.uploadId,
          parts: params.parts,
          auth,
        })

        // Create storage location record after successful upload
        const storageLocation = await storageLocationService.create({
          provider: params.provider as any, // Type cast needed for DB enum
          externalId: params.key,
          externalUrl: '', // No URL for multipart uploads initially
          externalRev: result.etag || '',
          credentialId: params.credentialId,
          size: result.size ? BigInt(result.size) : undefined,
          mimeType: undefined, // Not provided in completion
          metadata: { etag: result.etag },
        })

        return storageLocation
      } else {
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support multipart upload completion`,
          params.provider,
          'completeMultipartUpload'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'completeMultipartUpload', params.provider)
    }
  }

  /**
   * Abort multipart upload
   */
  async abortMultipartUpload(params: {
    provider: ProviderId
    key: string
    uploadId: string
    credentialId?: string
  }): Promise<void> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await this.getAdapter(params.provider)

    // Get authentication if credential ID provided
    let auth: ProviderAuth | undefined
    auth = await this.getProviderAuth(params.provider, params.credentialId)

    try {
      // Use adapter to abort multipart upload
      if ((adapter as any).abortMultipart) {
        await (adapter as any).abortMultipart({
          key: params.key,
          uploadId: params.uploadId,
          auth,
        })
      } else {
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support multipart upload abortion`,
          params.provider,
          'abortMultipartUpload'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'abortMultipartUpload', params.provider)
    }
  }

  // ============= Provider Operations =============

  /**
   * Create folder in any provider (uniform interface)
   *
   * Creates a new folder in the specified storage provider. Note that not all
   * providers support true folders (e.g., S3 uses prefixes), but this method
   * provides a uniform interface across all providers.
   *
   * @param params - Folder creation parameters
   * @returns Promise resolving to folder information
   *
   * @throws {StorageAdapterError} When provider doesn't support folders
   * @throws {StorageAuthError} When authentication is invalid or missing
   *
   * @example
   * ```typescript
   * // Create a project folder in Google Drive
   * const folder = await manager.createFolder({
   *   provider: 'GOOGLE_DRIVE',
   *   name: 'Project Alpha Documents',
   *   parentFolderId: 'parent_folder_id',
   *   credentialId: 'gdrive_cred_id'
   * })
   *
   * console.log(`Created folder: ${folder.name} (${folder.id})`)
   * ```
   *
   * @see {@link listFolder} for listing folder contents
   * @see {@link searchFiles} for finding files across folders
   */
  async createFolder(params: {
    provider: ProviderId
    name: string
    parentFolderId?: string
    credentialId?: string // Optional for local, required for external
  }): Promise<{ id: string; name: string }> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await this.getAdapter(params.provider)

    // Check if adapter supports folder creation
    const capabilities = adapter.getCapabilities()
    if (!capabilities.folders) {
      throw new StorageAdapterError(
        `Provider ${params.provider} does not support folder creation`,
        params.provider,
        'createFolder'
      )
    }

    // Get authentication - required for external providers
    if (!params.credentialId) {
      throw new StorageAdapterError(
        'Credential ID is required for folder creation',
        params.provider,
        'createFolder'
      )
    }

    const auth = await this.getProviderAuth(params.provider, params.credentialId)

    try {
      // Use adapter to create folder
      if (adapter.createFolder) {
        return await adapter.createFolder({
          name: params.name,
          parentFolderId: params.parentFolderId,
          auth,
        })
      } else {
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support folder creation`,
          params.provider,
          'createFolder'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'createFolder', params.provider)
    }
  }

  /**
   * List files in provider folder
   */
  async listFolder(params: {
    provider: ProviderId
    folderId?: string
    credentialId?: string
    limit?: number
    cursor?: string
  }): Promise<{ files: FileMetadata[]; nextCursor?: string }> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await this.getAdapter(params.provider)

    // Get authentication - required for external providers
    if (!params.credentialId) {
      throw new StorageAdapterError(
        'Credential ID is required for folder listing',
        params.provider,
        'listFolder'
      )
    }

    const auth = await this.getProviderAuth(params.provider, params.credentialId)

    try {
      // Use adapter to list folder contents
      if (adapter.listFolder) {
        return await adapter.listFolder({
          folderId: params.folderId,
          auth,
          limit: params.limit,
          cursor: params.cursor,
        })
      } else {
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support folder listing`,
          params.provider,
          'listFolder'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'listFolder', params.provider)
    }
  }

  /**
   * Search files in provider
   */
  async searchFiles(params: {
    provider: ProviderId
    query: string
    folderId?: string
    credentialId?: string
    limit?: number
  }): Promise<FileMetadata[]> {
    // Validate parameters
    this.validateStorageParams(params)

    // Get adapter for the provider
    const adapter = await this.getAdapter(params.provider)

    // Check if adapter supports search
    const capabilities = adapter.getCapabilities()
    if (!capabilities.search) {
      throw new StorageAdapterError(
        `Provider ${params.provider} does not support file search`,
        params.provider,
        'searchFiles'
      )
    }

    // Get authentication - required for external providers
    if (!params.credentialId) {
      throw new StorageAdapterError(
        'Credential ID is required for file search',
        params.provider,
        'searchFiles'
      )
    }

    const auth = await this.getProviderAuth(params.provider, params.credentialId)

    try {
      // Use adapter to search files
      if (adapter.search) {
        return await adapter.search({
          query: params.query,
          folderId: params.folderId,
          auth,
          limit: params.limit,
        })
      } else {
        throw new StorageAdapterError(
          `Provider ${params.provider} does not support file search`,
          params.provider,
          'searchFiles'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'searchFiles', params.provider)
    }
  }

  // ============= Webhook Processing =============

  /**
   * Process webhook from provider
   */
  async processWebhook(
    provider: ProviderId,
    payload: unknown,
    signature?: string
  ): Promise<WebhookEvent[]> {
    // Validate provider
    if (!this.isProviderAvailable(provider)) {
      throw new StorageAdapterError(
        `Provider ${provider} is not available`,
        provider,
        'processWebhook'
      )
    }

    // Get adapter for the provider
    const adapter = await this.getAdapter(provider)

    // Check if adapter supports webhooks
    const capabilities = adapter.getCapabilities()
    if (!capabilities.webhooks) {
      throw new StorageAdapterError(
        `Provider ${provider} does not support webhooks`,
        provider,
        'processWebhook'
      )
    }

    try {
      // Validate webhook signature first
      if (adapter.validateWebhook) {
        const isValid = await adapter.validateWebhook(payload, signature)
        if (!isValid) {
          throw new StorageAdapterError('Invalid webhook signature', provider, 'processWebhook')
        }
      }

      // Process webhook payload
      if (adapter.processWebhook) {
        return await adapter.processWebhook(payload)
      } else {
        throw new StorageAdapterError(
          `Provider ${provider} does not support webhook processing`,
          provider,
          'processWebhook'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'processWebhook', provider)
    }
  }

  /**
   * Validate webhook signature
   */
  async validateWebhook(
    provider: ProviderId,
    payload: unknown,
    signature?: string
  ): Promise<boolean> {
    // Validate provider
    if (!this.isProviderAvailable(provider)) {
      throw new StorageAdapterError(
        `Provider ${provider} is not available`,
        provider,
        'validateWebhook'
      )
    }

    // Get adapter for the provider
    const adapter = await this.getAdapter(provider)

    // Check if adapter supports webhooks
    const capabilities = adapter.getCapabilities()
    if (!capabilities.webhooks) {
      throw new StorageAdapterError(
        `Provider ${provider} does not support webhooks`,
        provider,
        'validateWebhook'
      )
    }

    try {
      // Use adapter to validate webhook
      if (adapter.validateWebhook) {
        return await adapter.validateWebhook(payload, signature)
      } else {
        throw new StorageAdapterError(
          `Provider ${provider} does not support webhook validation`,
          provider,
          'validateWebhook'
        )
      }
    } catch (error) {
      this.handleStorageError(error, 'validateWebhook', provider)
    }
  }

  // ============= Monitoring & Health =============

  /**
   * Get storage usage statistics
   */
  async getStorageUsage(): Promise<StorageUsageStats> {
    try {
      // Get statistics from StorageLocationService
      const stats = await storageLocationService.getStats()

      // Transform to match StorageUsageStats interface
      const byProvider: Record<ProviderId, { files: number; size: bigint }> = {}

      // Convert provider stats
      for (const [provider, count] of Object.entries(stats.locationsByProvider)) {
        byProvider[provider as ProviderId] = {
          files: count,
          size: stats.sizeByProvider[provider] || BigInt(0),
        }
      }

      return {
        totalFiles: stats.totalLocations,
        totalSize: stats.totalSize,
        byProvider,
        byOrganization: {} as Record<string, { files: number; size: bigint }>, // TODO: Implement organization-based stats when available
      }
    } catch (error) {
      this.handleStorageError(error, 'getStorageUsage', 'UNKNOWN' as ProviderId)
    }
  }

  /**
   * Perform health check on all providers
   *
   * Executes health checks on all available storage providers to verify
   * their status, connectivity, and capabilities. This is useful for
   * monitoring and alerting systems.
   *
   * @returns Promise resolving to array of health check results
   *
   * @example
   * ```typescript
   * const healthChecks = await manager.performHealthCheck()
   *
   * healthChecks.forEach(check => {
   *   if (!check.healthy) {
   *     console.error(`Provider ${check.provider} failed: ${check.error}`)
   *     alertingSystem.notify(`Storage provider ${check.provider} is down`)
   *   } else {
   *     console.log(`Provider ${check.provider} OK (${check.latency}ms)`)
   *   }
   * })
   *
   * // Filter to healthy providers only
   * const healthyProviders = healthChecks
   *   .filter(check => check.healthy)
   *   .map(check => check.provider)
   * ```
   *
   * @see {@link getProviderStatus} for individual provider checks
   * @see {@link getStorageUsage} for usage statistics
   */
  async performHealthCheck(): Promise<StorageHealthCheck[]> {
    const availableProviders = this.getAvailableProviders()
    const healthChecks: StorageHealthCheck[] = []

    // Perform health check for each available provider
    for (const provider of availableProviders) {
      try {
        const healthCheck = await this.getProviderStatus(provider)
        healthChecks.push(healthCheck)
      } catch (error) {
        // If health check fails, record the error
        healthChecks.push({
          provider,
          healthy: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          capabilities: {
            presignUpload: false,
            presignDownload: false,
            serverSideDownload: false,
            versioning: false,
            webhooks: false,
            folders: false,
            search: false,
            metadata: false,
            multipart: false,
          },
        })
      }
    }

    return healthChecks
  }

  /**
   * Get provider connection status
   */
  async getProviderStatus(provider: ProviderId): Promise<StorageHealthCheck> {
    const startTime = Date.now()

    try {
      // Validate provider is available
      if (!this.isProviderAvailable(provider)) {
        return {
          provider,
          healthy: false,
          error: `Provider ${provider} is not available`,
          capabilities: {
            presignUpload: false,
            presignDownload: false,
            serverSideDownload: false,
            versioning: false,
            webhooks: false,
            folders: false,
            search: false,
            metadata: false,
            multipart: false,
          },
        }
      }

      // Get adapter and capabilities
      const adapter = await this.getAdapter(provider)
      const capabilities = adapter.getCapabilities()

      // Test adapter validation if available
      let isHealthy = true
      let errorMessage: string | undefined

      if (adapter.validateAuth) {
        try {
          // Try to validate with empty auth to test adapter functionality
          await adapter.validateAuth({} as ProviderAuth)
        } catch (error) {
          // Expected to fail without auth, but adapter should be functional
          // Only mark as unhealthy if there's a fundamental adapter issue
          if (error instanceof Error && error.message.includes('Authentication required')) {
            // This is expected - adapter is working
          } else {
            isHealthy = false
            errorMessage = error instanceof Error ? error.message : 'Adapter test failed'
          }
        }
      }

      const latency = Date.now() - startTime

      return {
        provider,
        healthy: isHealthy,
        latency,
        error: errorMessage,
        capabilities,
      }
    } catch (error) {
      const latency = Date.now() - startTime

      return {
        provider,
        healthy: false,
        latency,
        error: error instanceof Error ? error.message : 'Unknown error',
        capabilities: {
          presignUpload: false,
          presignDownload: false,
          serverSideDownload: false,
          versioning: false,
          webhooks: false,
          folders: false,
          search: false,
          metadata: false,
          multipart: false,
        },
      }
    }
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
      const bucketCandidate =
        metadata?.bucket ||
        metadata?.Bucket ||
        metadata?.s3Bucket ||
        metadata?.publicBucket ||
        metadata?.privateBucket ||
        process.env.S3_PRIVATE_BUCKET ||
        process.env.NEXT_PUBLIC_S3_PRIVATE_BUCKET ||
        process.env.S3_PUBLIC_BUCKET ||
        process.env.NEXT_PUBLIC_S3_PUBLIC_BUCKET ||
        process.env.S3_BUCKET

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

    if (!this.isProviderAvailable(params.provider)) {
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
    const adapter = await this.getAdapter(params.provider)

    // Always try to get authentication (credential manager handles system credential fallback)
    let auth: ProviderAuth | undefined
    try {
      auth = await this.getProviderAuth(params.provider, params.credentialId)
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
export const createStorageManager = (organizationId: string) => new StorageManager(organizationId)
