// packages/lib/src/files/shared-types/uploads.ts

/**
 * Shared upload types for file upload progress and results
 * Safe for import by both frontend and backend - contains no server dependencies
 */

/**
 * Upload status enumeration
 */
export type UploadStatus =
  | 'pending' // File queued for upload
  | 'uploading' // File upload in progress
  | 'processing' // File uploaded, being processed
  | 'completed' // Upload and processing completed
  | 'failed' // Upload or processing failed
  | 'cancelled' // Upload cancelled by user

/**
 * Processing stage status
 */
export type StageStatus =
  | 'pending' // Stage not yet started
  | 'active' // Stage currently in progress
  | 'completed' // Stage completed successfully
  | 'failed' // Stage failed with error
  | 'skipped' // Stage skipped

/**
 * Processing stage information
 */
export interface ProcessingStage {
  name: string
  displayName: string
  progress: number // 0-100 percentage
  status: StageStatus
  message?: string
  startedAt?: Date
  completedAt?: Date
  error?: string
  estimatedDuration?: number // seconds
}

/**
 * Complete upload progress tracking
 */
export interface UploadProgress {
  fileId: string
  filename: string

  // Overall progress
  overallProgress: number
  status: UploadStatus

  // Upload phase
  uploadProgress: number
  bytesUploaded: number
  totalBytes: number
  uploadSpeed?: number // bytes per second

  // Processing phases
  stages: ProcessingStage[]
  currentStage?: string

  // Timing
  startedAt?: Date
  completedAt?: Date
  estimatedTimeRemaining?: number // seconds

  // Results
  url?: string
  error?: string
  checksum?: string
}

/**
 * Upload result for individual files
 */
export interface UploadResult {
  success: boolean
  fileId?: string
  filename: string
  url?: string
  size?: number
  checksum?: string
  error?: string
  metadata?: Record<string, any>
}

/**
 * Batch upload result
 */
export interface BatchUploadResult {
  totalFiles: number
  successCount: number
  failedCount: number
  results: UploadResult[]
  overallProgress: number
  estimatedTimeRemaining?: number
}

/**
 * Queued file information
 */
export interface QueuedFile {
  id: string
  file: File
  progress: UploadProgress
  priority?: number
  // REMOVED: retryCount, maxRetries (offline retry functionality)
}

/**
 * Queue statistics
 */
export interface QueueStats {
  total: number
  pending: number
  uploading: number
  processing: number
  completed: number
  failed: number
  totalBytes: number
  uploadedBytes: number
  overallProgress: number
  averageSpeed?: number // bytes per second
  estimatedTimeRemaining?: number // seconds
}

/**
 * Queue configuration
 */
export interface QueueConfig {
  maxConcurrent?: number // Maximum concurrent uploads
  autoStart?: boolean // Auto-start uploads when files added
  maxFileSize?: number // Maximum file size in bytes
  allowedTypes?: string[] // Allowed MIME types
  chunkSize?: number // Upload chunk size for large files
  priorityThreshold?: number // File size threshold for priority
  // REMOVED: maxRetries, retryDelay (offline retry functionality)
}

/**
 * File validation result
 */
export interface FileValidationResult {
  valid: boolean
  error?: string
  warnings?: string[]
}

/**
 * Upload file extended with UI state
 */
export interface UploadFile {
  id: string
  name: string
  size: number
  type: string
  file: File
  progress: UploadProgress
  validationResult?: FileValidationResult
  lastModified?: number
}

/**
 * Multi-file progress tracking
 */
export interface MultiFileProgress {
  overallProgress: number
  completedFiles: number
  totalFiles: number
  currentOperations: Array<{
    filename: string
    stage: string
    progress: number
  }>
  totalBytes: number
  uploadedBytes: number
  averageSpeed?: number
  estimatedTimeRemaining?: number
  errors: Array<{
    filename: string
    error: string
    recoverable: boolean
  }>
}

/**
 * Upload metrics for analytics
 */
export interface UploadMetrics {
  sessionId: string
  totalFiles: number
  totalSize: number
  successCount: number
  failedCount: number
  averageSpeed: number
  totalDuration: number // seconds
  peakConcurrency: number
  retryCount: number
  errorTypes: Record<string, number>
  stageTimings: Record<string, number>
}

/**
 * Progress callback function types
 */
export type ProgressCallback = (progress: UploadProgress) => void
export type BatchProgressCallback = (progress: MultiFileProgress) => void
export type CompletionCallback = (result: BatchUploadResult) => void
export type ErrorCallback = (error: string, recoverable?: boolean) => void

/**
 * Upload event callbacks
 */
export interface UploadCallbacks {
  onProgress?: ProgressCallback
  onBatchProgress?: BatchProgressCallback
  onFileComplete?: (result: UploadResult) => void
  onComplete?: CompletionCallback
  onError?: ErrorCallback
  onCancel?: () => void
  onRetry?: (fileId: string) => void
}

/**
 * Connection configuration for uploads
 */
export interface ConnectionConfig {
  timeout?: number // Request timeout (ms)
  retryAttempts?: number // Connection retry attempts
  retryDelay?: number // Delay between connection retries (ms)
  keepAlive?: boolean // Keep connection alive
  maxRedirects?: number // Maximum redirects to follow
}
