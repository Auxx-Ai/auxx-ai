// packages/lib/src/files/adapters/base-adapter.ts

/**
 * Base storage adapter interface and types for unified multi-provider storage
 * Defines the contract that all storage providers must implement
 */

// ============= Core Types =============

export type ProviderId = 'S3' | 'GOOGLE_DRIVE' | 'DROPBOX' | 'ONEDRIVE' | 'BOX' | 'GENERIC_URL'

/**
 * Download reference for content access
 */
export type DownloadRef =
  | { type: 'url'; url: string; expiresAt?: Date }
  | {
      type: 'stream'
      stream: NodeJS.ReadableStream
      size?: number
      mimeType?: string
      etag?: string
    }

/**
 * Provider authentication information
 * Maps credential data from the credential store to adapter-specific format
 */
export interface ProviderAuth {
  accessToken?: string
  refreshToken?: string
  expiresAt?: Date
  accountEmail?: string
  scopes?: string[]
  // Provider-specific fields
  [key: string]: unknown
}

/**
 * Storage provider capabilities
 * Defines what operations each provider supports
 */
export interface StorageCapabilities {
  presignUpload: boolean // Can generate presigned upload URLs
  presignDownload: boolean // Can generate presigned download URLs
  multipart: boolean // Supports multipart upload
}

/**
 * File metadata information
 * Standardized metadata across all providers
 */
export interface FileMetadata {
  name?: string
  size?: number
  mimeType?: string
  etagOrRev?: string
  updatedAt?: Date
  createdAt?: Date
  permissions?: string[]
  parentFolderId?: string
  isFolder?: boolean
}

/**
 * Storage location reference
 * Uniform interface for identifying files across all providers
 */
export interface StorageLocationRef {
  provider: ProviderId

  // Universal identifier for the file in the provider system
  externalId: string

  // Optional external URL (for URL providers or public files)
  externalUrl?: string

  // Authentication
  credentialId?: string

  // Provider-specific metadata (e.g., S3: {bucket, region, etag}, Drive: {fileId, parentId})
  metadata?: Record<string, any>
}

/**
 * Presigned upload information
 * Used for direct client uploads to storage providers
 */
export interface PresignedUpload {
  url: string
  /** HTTP verb the client must use: POST for form uploads, PUT for direct uploads. */
  method?: 'POST' | 'PUT'
  fields?: Record<string, string>
  headers?: Record<string, string>
  expiresAt: Date
}

/**
 * Multipart upload information
 * Used for large file uploads
 */
export interface MultipartUpload {
  uploadId: string
  expiresAt: Date
}

// ============= Storage Adapter Interface =============

/**
 * Core StorageAdapter interface
 * Defines the contract all storage providers must implement
 */
export interface StorageAdapter {
  readonly id: ProviderId
  readonly credentialProviderId?: ProviderId
  readonly name: string
  readonly description: string

  /**
   * Get adapter capabilities
   */
  getCapabilities(): StorageCapabilities

  /**
   * Build external URL for a storage location
   * Each adapter knows how to construct URLs for its provider
   */
  buildExternalUrl?(key: string, auth?: ProviderAuth): string

  /**
   * Get file metadata
   */
  getMeta(loc: StorageLocationRef, auth?: ProviderAuth): Promise<FileMetadata>

  /**
   * Check if file exists in storage
   */
  fileExists(loc: StorageLocationRef, auth?: ProviderAuth): Promise<boolean>

  // ============= Download Operations =============

  /**
   * Get download reference (presigned URL or stream) for content access
   */
  getDownloadRef?(
    loc: StorageLocationRef,
    auth?: ProviderAuth,
    options?: {
      ttlSec?: number
      disposition?: 'inline' | 'attachment'
      filename?: string
      mimeType?: string
    }
  ): Promise<DownloadRef>

  /**
   * Open download stream (for providers that require server-side downloads)
   */
  openDownloadStream?(loc: StorageLocationRef, auth?: ProviderAuth): Promise<NodeJS.ReadableStream>

  // ============= Upload Operations - Single Shot =============

  /**
   * Generate presigned upload URL for direct client uploads
   */
  presignUpload?(params: {
    key: string
    mimeType?: string
    size?: number
    ttlSec?: number
    metadata?: Record<string, string>
  }): Promise<PresignedUpload>

  /**
   * Upload content directly to storage (server-side upload)
   * Used when content is generated/processed on the server
   */
  putObject?(params: {
    key: string
    content: Buffer | NodeJS.ReadableStream
    mimeType?: string
    size?: number
    metadata?: Record<string, string>
    /** Explicit bucket override, for providers that are bucket-addressed. */
    bucket?: string
    /** Routes the object to the provider's public or private bucket. */
    visibility?: 'PUBLIC' | 'PRIVATE'
    auth?: ProviderAuth
  }): Promise<{
    etag?: string
    versionId?: string
    size?: number
  }>

  // ============= Upload Operations - Multipart =============

  /**
   * Start multipart upload for large files
   */
  startMultipart?(params: {
    key: string
    mimeType?: string
    metadata?: Record<string, string>
    /** Explicit bucket override, for providers that are bucket-addressed. */
    bucket?: string
    /** Routes the upload to the provider's public or private bucket. */
    visibility?: 'PUBLIC' | 'PRIVATE'
  }): Promise<MultipartUpload>

  /**
   * Generate presigned URL for uploading a part.
   *
   * `bucket` MUST name the same bucket the multipart upload was initiated in.
   * Presigning a part against a different bucket yields `NoSuchUpload`.
   */
  presignPart?(params: {
    key: string
    uploadId: string
    partNumber: number
    size?: number
    /** Bucket the multipart upload was initiated in. Required for bucket-addressed providers. */
    bucket?: string
  }): Promise<PresignedUpload>

  /**
   * Complete multipart upload.
   *
   * `bucket` MUST name the same bucket the multipart upload was initiated in.
   */
  completeMultipart?(params: {
    key: string
    uploadId: string
    parts: Array<{ partNumber: number; etag: string }>
    /** Bucket the multipart upload was initiated in. Required for bucket-addressed providers. */
    bucket?: string
  }): Promise<{ etag: string; size?: number }>

  /**
   * Delete a file from external storage.
   *
   * For bucket-addressed providers the bucket travels on `loc.metadata.bucket`.
   * Adapters must NOT silently fall back to a configured default bucket: S3
   * answers 204 for a delete of a key that does not exist, so a wrong-bucket
   * delete looks like a success while the real object leaks.
   */
  deleteFile?(loc: StorageLocationRef, auth?: ProviderAuth): Promise<void>

  // ============= Platform Auth Resolution =============

  /**
   * Resolve platform-level auth from configService.
   * Each adapter knows its own config keys and how to build auth from them.
   * Returns null if this adapter requires explicit credentials (credentialId).
   */
  resolvePlatformAuth?(): ProviderAuth | null

  /**
   * Resolve default bucket name from platform config.
   * Used by StorageManager to enrich StorageLocationRef metadata.
   */
  resolveBucket?(): string | undefined
}

// ============= Base Adapter Class =============

/**
 * Abstract base class for storage adapters
 * Provides common functionality and error handling
 */
export abstract class BaseStorageAdapter implements StorageAdapter {
  abstract readonly id: ProviderId
  abstract readonly name: string
  abstract readonly description: string

  abstract getCapabilities(): StorageCapabilities
  abstract getMeta(loc: StorageLocationRef, auth?: ProviderAuth): Promise<FileMetadata>
  abstract fileExists(loc: StorageLocationRef, auth?: ProviderAuth): Promise<boolean>

  /**
   * Validate storage location reference for this provider
   */
  protected validateLocation(loc: StorageLocationRef): void {
    if (loc.provider !== this.id) {
      throw new Error(`Invalid provider ${loc.provider} for ${this.id} adapter`)
    }
  }

  /**
   * Handle common errors and provide user-friendly messages
   */
  protected handleError(error: any, operation: string): never {
    const message = error?.message || 'Unknown error'
    throw new Error(`${this.name} ${operation} failed: ${message}`)
  }

  /**
   * Check if a capability is supported by this adapter
   */
  protected requireCapability(capability: keyof StorageCapabilities): void {
    const capabilities = this.getCapabilities()
    if (!capabilities[capability]) {
      throw new Error(`${this.name} does not support ${capability}`)
    }
  }
}

// ============= Error Classes =============

/**
 * Base error class for storage adapter errors
 */
export class StorageAdapterError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderId,
    public readonly operation: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'StorageAdapterError'
  }
}

/**
 * Authentication error for storage adapters
 */
export class StorageAuthError extends StorageAdapterError {
  constructor(provider: ProviderId, operation: string, cause?: Error) {
    super(`Authentication failed for ${provider}`, provider, operation, cause)
    this.name = 'StorageAuthError'
  }
}

/**
 * File not found error for storage adapters
 */
export class StorageFileNotFoundError extends StorageAdapterError {
  constructor(provider: ProviderId, fileId: string, cause?: Error) {
    super(`File not found: ${fileId}`, provider, 'getMeta', cause)
    this.name = 'StorageFileNotFoundError'
  }
}

/**
 * Quota exceeded error for storage adapters
 */
export class StorageQuotaError extends StorageAdapterError {
  constructor(provider: ProviderId, operation: string, cause?: Error) {
    super(`Storage quota exceeded for ${provider}`, provider, operation, cause)
    this.name = 'StorageQuotaError'
  }
}

/**
 * Unsupported operation error for storage adapters
 */
export class StorageUnsupportedError extends StorageAdapterError {
  constructor(provider: ProviderId, operation: string) {
    super(`Operation ${operation} not supported by ${provider}`, provider, operation)
    this.name = 'StorageUnsupportedError'
  }
}
