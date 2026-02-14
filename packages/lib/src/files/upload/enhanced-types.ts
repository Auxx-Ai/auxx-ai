// packages/lib/src/files/upload/enhanced-types.ts

import type { ProviderId } from '../adapters/base-adapter'
import type { EntityType, FileVisibility } from './types'

/**
 * Enhanced upload parameters with StorageManager integration
 */
export interface UploadRequest {
  // File Data
  content: File | Buffer | NodeJS.ReadableStream
  filename: string
  mimeType?: string
  size?: number

  // Entity Association
  entityType: EntityType
  entityId?: string

  // Storage Configuration
  provider?: ProviderId // Auto-select if not specified
  credentialId?: string
  visibility?: FileVisibility
  metadata?: Record<string, any>

  // Upload Strategy
  strategy?: UploadStrategy // 'direct' | 'multipart' | 'presigned' | 'auto'

  // Progress & Session
  uploadId?: string // For resumable uploads
  sessionId?: string
  progressCallback?: UploadProgressCallback

  // Organization & User Context
  organizationId: string
  userId: string
}

/**
 * Comprehensive upload result with StorageManager integration
 */
export interface UploadResult {
  // File Identification
  fileId: string
  storageLocationId: string
  uploadId: string

  // File Metadata
  filename: string
  size: number
  mimeType: string
  checksum: string

  // Storage Information
  provider: ProviderId
  storageKey: string

  // Access URLs
  downloadUrl?: string
  downloadExpiresAt?: Date
  publicUrl?: string

  // Upload Metadata
  strategy: UploadStrategy
  uploadDuration: number
  throughput: number // bytes/second

  // Entity Associations
  entityAttachments?: EntityAttachment[]

  // Processing Results
  processingResults?: ProcessingResult[]

  // Presigned upload information (for presigned strategy)
  presignedUpload?: {
    url: string
    fields?: Record<string, string>
    expiresAt?: Date
  }
}

/**
 * Real-time progress information
 */
export interface UploadProgress {
  // Progress Tracking
  stage: UploadStage
  bytesUploaded: number
  totalBytes: number
  percentage: number

  // Performance Metrics
  speed: number // bytes/second
  eta: number // milliseconds

  // Current Operation
  message: string
  currentChunk?: number
  totalChunks?: number

  // Error Information
  errors?: UploadError[]
  retryCount?: number
}

/**
 * Upload strategies for different scenarios
 */
export type UploadStrategy =
  | 'direct' // Direct upload to storage (small files)
  | 'multipart' // Multipart upload (large files)
  | 'presigned' // Client-side presigned upload
  | 'chunked' // Chunked upload with resume support
  | 'auto' // Auto-select based on file size and provider

/**
 * Upload stages for progress tracking
 */
export type UploadStage =
  | 'initializing'
  | 'validating'
  | 'preparing'
  | 'uploading'
  | 'processing'
  | 'finalizing'
  | 'completed'
  | 'failed'

/**
 * Enhanced error types for uploads
 */
export class UploadError extends Error {
  constructor(
    message: string,
    public readonly code: UploadErrorCode,
    public readonly stage: UploadStage,
    public readonly retryable: boolean = false,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

export type UploadErrorCode =
  | 'VALIDATION_FAILED'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'PROVIDER_ERROR'
  | 'NETWORK_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'PROCESSING_FAILED'
  | 'ENTITY_NOT_FOUND'
  | 'PERMISSION_DENIED'

/**
 * Callback function for tracking upload progress
 */
export type UploadProgressCallback = (progress: UploadProgress) => void

/**
 * Upload preferences for strategy selection
 */
export interface UploadPreferences {
  preferredProvider?: ProviderId
  defaultStrategy?: UploadStrategy
  enableCompression?: boolean
  generateThumbnails?: boolean
  extractText?: boolean
  maxFileSize?: number
  allowedMimeTypes?: string[]
}

/**
 * Entity attachment information
 */
export interface EntityAttachment {
  id: string
  entityType: EntityType
  entityId: string
  relationshipType: 'attachment' | 'content' | 'resource'
  metadata?: Record<string, any>
}

/**
 * Post-processing result
 */
export interface ProcessingResult {
  success: boolean
  processingSteps: ProcessingStep[]
  metadata: Record<string, any>
}

/**
 * Individual processing step result
 */
export interface ProcessingStep {
  type: 'thumbnail' | 'text_extraction' | 'compression' | 'validation'
  result: any
  success?: boolean
  error?: string
}

/**
 * Batch upload configuration
 */
export interface BatchUploadOptions {
  concurrency?: number
  continueOnError?: boolean
  strategy?: UploadStrategy
}

/**
 * Batch upload result
 */
export interface BatchUploadResult {
  batchId: string
  results: UploadResult[]
  errors: UploadError[]
  summary: BatchUploadSummary
}

/**
 * Batch upload summary statistics
 */
export interface BatchUploadSummary {
  totalFiles: number
  successCount: number
  errorCount: number
  totalSize: number
  totalDuration: number
  averageThroughput: number
}

/**
 * Upload state for resumable uploads
 */
export interface UploadState {
  uploadId: string
  strategy: UploadStrategy
  provider: ProviderId
  multipartUploadId?: string
  uploadedParts?: Array<{ partNumber: number; etag: string }>
  uploadedBytes: number
  totalBytes: number
  lastUpdate: number
  metadata?: Record<string, any>
}

/**
 * Progress tracker context for operations
 */
export interface ProgressContext {
  uploadId: string
  updateStage: (stage: UploadStage, message: string) => void
  updateProgress: (bytesUploaded: number, message?: string) => void
  addError: (error: UploadError) => void
  onProgress: (callback: (progress: UploadProgress) => void) => () => void
}

/**
 * Upload strategy handler interface
 */
export interface UploadStrategyHandler {
  canHandle(request: UploadRequest): boolean
  execute(request: UploadRequest, progress: ProgressContext): Promise<UploadResult>
  resume?(uploadId: string, progress: ProgressContext): Promise<UploadResult>
  cancel?(uploadId: string): Promise<void>
}

/**
 * Upload service configuration
 */
export interface UploadServiceConfig {
  // Provider Configuration
  defaultProvider?: ProviderId
  preferredProvider?: ProviderId
  fallbackProviders?: ProviderId[]

  // Upload Preferences
  defaultStrategy?: UploadStrategy
  chunkSize?: number
  maxConcurrentUploads?: number
  maxRetries?: number

  // File Constraints
  maxFileSize?: number
  maxTotalSize?: number
  allowedMimeTypes?: string[]
  blockedMimeTypes?: string[]

  // Performance Tuning
  enableCompression?: boolean
  compressionLevel?: number
  enableDeduplication?: boolean
  enableChecksumValidation?: boolean

  // Progress & Monitoring
  progressUpdateInterval?: number
  enableDetailedMetrics?: boolean
  enablePerformanceOptimization?: boolean

  // URL Generation
  defaultUrlTtl?: number
  enablePublicUrls?: boolean
  cdnDomain?: string

  // Security
  enableVirusScanning?: boolean
  enableContentValidation?: boolean
  quarantineSuspiciousFiles?: boolean

  // Feature Flags
  enableMultipartUploads?: boolean
  enableResumableUploads?: boolean
  enableBatchOptimization?: boolean
  enableAutoStrategy?: boolean
}

/**
 * Optimized batch for upload processing
 */
export interface OptimizedBatch {
  provider: ProviderId
  strategy: UploadStrategy
  requests: UploadRequest[]
  parallel: boolean
  maxConcurrency: number
}

/**
 * Upload metrics tracking
 */
export interface UploadMetrics {
  uploadId: string
  startTime: number
  endTime?: number
  bytesUploaded: number
  totalBytes: number
  strategy: UploadStrategy
  provider: ProviderId
  chunksUploaded?: number
  totalChunks?: number
  retryCount: number
  errors: UploadError[]
}

/**
 * Validation result for entity associations
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings?: string[]
}

/**
 * Post-processing options
 */
export interface ProcessingOptions {
  generateThumbnails?: boolean
  extractText?: boolean
  enableCompression?: boolean
  compressionLevel?: number
}

/**
 * Thumbnail generation options
 */
export interface ThumbnailOptions {
  size: number
  quality?: number
  format?: 'jpeg' | 'png' | 'webp'
}

/**
 * Progress tracking state
 */
export interface UploadProgressState {
  uploadId: string
  stage: UploadStage
  bytesUploaded: number
  totalBytes: number
  startTime: number
  lastUpdate: number
  speed: number
  eta: number
  percentage: number
  message: string
  errors: UploadError[]
  organizationId?: string
}
