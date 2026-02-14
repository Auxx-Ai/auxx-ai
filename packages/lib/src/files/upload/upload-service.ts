// packages/lib/src/files/upload/enhanced-upload-service.ts

import { createScopedLogger } from '@auxx/logger'
import { createStorageManager, type StorageManager } from '../storage/storage-manager'
import type {
  BatchUploadOptions,
  BatchUploadResult,
  OptimizedBatch,
  UploadRequest,
  UploadResult,
  UploadServiceConfig,
  UploadStrategy,
  UploadStrategyHandler,
} from './enhanced-types'
import { UploadError } from './enhanced-types'
import { enhancedProgressTracker } from './progress/enhanced-progress-tracker'
import { fileUploadEventPublisher } from './progress/sse-publisher'
import { DirectUploadStrategy } from './strategies/direct-upload'
import { MultipartUploadStrategy } from './strategies/multipart-upload'
import { PresignedUploadStrategy } from './strategies/presigned-upload'
import { UploadStrategySelector } from './strategies/strategy-selector'

const logger = createScopedLogger('enhanced-upload-service')

/**
 * Enhanced FileUploadService with StorageManager integration
 * Provides intelligent upload strategies, real progress tracking, and modern features
 */
export class FileUploadService {
  private readonly storageManager: StorageManager
  private readonly strategySelector: UploadStrategySelector
  private readonly strategies: Map<UploadStrategy, UploadStrategyHandler>
  private readonly config: UploadServiceConfig

  constructor(organizationId: string, config: UploadServiceConfig = {}) {
    this.storageManager = createStorageManager(organizationId)
    this.strategySelector = new UploadStrategySelector(this.storageManager)
    this.config = {
      // Default configuration
      defaultStrategy: 'auto',
      chunkSize: 5 * 1024 * 1024, // 5MB
      maxConcurrentUploads: 5,
      maxRetries: 3,
      maxFileSize: 1024 * 1024 * 1024, // 1GB
      enableMultipartUploads: true,
      enableResumableUploads: true,
      enableBatchOptimization: true,
      enableAutoStrategy: true,
      defaultUrlTtl: 3600, // 1 hour
      progressUpdateInterval: 250, // 250ms
      enableDetailedMetrics: true,
      ...config,
    }

    // Initialize upload strategies
    this.strategies = new Map([
      ['direct', new DirectUploadStrategy(this.storageManager)],
      ['multipart', new MultipartUploadStrategy(this.storageManager)],
      ['presigned', new PresignedUploadStrategy(this.storageManager)],
    ])

    logger.info('Enhanced FileUploadService initialized', {
      organizationId,
      config: {
        defaultStrategy: this.config.defaultStrategy,
        maxFileSize: this.config.maxFileSize,
        enableMultipart: this.config.enableMultipartUploads,
        enableResumable: this.config.enableResumableUploads,
      },
    })
  }

  // ============= Main Upload Methods =============

  /**
   * Upload a file with automatic strategy selection
   */
  async upload(request: UploadRequest): Promise<UploadResult> {
    const uploadId = this.generateUploadId()
    const tracker = enhancedProgressTracker.create(uploadId, request)

    logger.info('Starting enhanced upload', {
      uploadId,
      filename: request.filename,
      size: request.size,
      entityType: request.entityType,
      provider: request.provider,
      strategy: request.strategy,
    })

    try {
      // Stage 1: Validation & Preparation
      await this.validateRequest(request, tracker)

      // Stage 2: Strategy Selection
      const strategy = await this.selectUploadStrategy(request, tracker)

      // Stage 3: Execute Upload
      const result = await this.executeUpload(request, strategy, tracker, uploadId)

      // Stage 4: Post-processing
      await this.postProcessUpload(result, request, tracker)

      // Complete tracking
      enhancedProgressTracker.complete(uploadId, 'Upload completed successfully')

      logger.info('Enhanced upload completed', {
        uploadId,
        fileId: result.fileId,
        strategy: result.strategy,
        duration: result.uploadDuration,
        throughput: Math.round(result.throughput),
      })

      return result
    } catch (error) {
      await this.handleUploadError(error, uploadId, tracker, request)
      throw error
    }
  }

  /**
   * Upload multiple files with batch optimization
   */
  async uploadBatch(
    requests: UploadRequest[],
    options: BatchUploadOptions = {}
  ): Promise<BatchUploadResult> {
    const batchId = this.generateBatchId()
    const results: UploadResult[] = []
    const errors: UploadError[] = []

    logger.info('Starting batch upload', {
      batchId,
      fileCount: requests.length,
      concurrency: options.concurrency || this.config.maxConcurrentUploads,
    })

    // Optimize batch by grouping by provider and strategy
    const optimizedBatches = this.optimizeBatch(requests)

    for (const batch of optimizedBatches) {
      try {
        if (batch.parallel && batch.requests.length > 1) {
          // Execute parallel uploads
          const batchResults = await this.executeParallelBatch(batch, options)
          results.push(...batchResults.successes)
          errors.push(...batchResults.errors)
        } else {
          // Execute sequential uploads
          const batchResults = await this.executeSequentialBatch(batch, options)
          results.push(...batchResults.successes)
          errors.push(...batchResults.errors)
        }
      } catch (error) {
        if (error instanceof UploadError) {
          errors.push(error)
        } else {
          errors.push(
            new UploadError(
              `Batch processing failed: ${error instanceof Error ? error.message : String(error)}`,
              'PROVIDER_ERROR',
              'uploading'
            )
          )
        }

        if (!options.continueOnError) {
          break
        }
      }
    }

    const summary = this.generateBatchSummary(results, errors)

    logger.info('Batch upload completed', {
      batchId,
      totalFiles: requests.length,
      successCount: summary.successCount,
      errorCount: summary.errorCount,
      totalDuration: summary.totalDuration,
    })

    return { batchId, results, errors, summary }
  }

  /**
   * Resume a previously failed upload
   */
  async resumeUpload(uploadId: string): Promise<UploadResult> {
    // This would integrate with upload registry for state persistence
    throw new Error('Resume functionality requires upload registry implementation')
  }

  /**
   * Cancel an in-progress upload
   */
  async cancelUpload(uploadId: string): Promise<void> {
    enhancedProgressTracker.cancel(uploadId, 'Upload cancelled by user')

    // Additional cleanup would go here (abort multipart uploads, etc.)
    logger.info('Upload cancelled', { uploadId })
  }

  /**
   * Get upload progress for active uploads
   */
  getUploadProgress(uploadId: string) {
    return enhancedProgressTracker.getProgress(uploadId)
  }

  /**
   * Get all active uploads for this organization
   */
  getActiveUploads() {
    return enhancedProgressTracker.getActiveUploads()
  }

  // ============= Strategy Selection =============

  private async selectUploadStrategy(
    request: UploadRequest,
    tracker: any
  ): Promise<UploadStrategy> {
    tracker.updateStage('preparing', 'Selecting optimal upload strategy...')

    if (request.strategy && request.strategy !== 'auto') {
      const strategy = this.strategies.get(request.strategy)
      if (strategy?.canHandle(request)) {
        return request.strategy
      }

      logger.warn('Requested strategy cannot handle request, falling back to auto selection', {
        requestedStrategy: request.strategy,
        filename: request.filename,
        size: request.size,
      })
    }

    // Auto-select optimal strategy
    const provider = request.provider || (await this.selectOptimalProvider(request))
    const capabilities = await this.storageManager.getProviderCapabilities(provider)

    const strategy = await this.strategySelector.selectStrategy(
      { ...request, provider },
      capabilities,
      this.config
    )

    logger.info('Upload strategy selected', {
      strategy,
      filename: request.filename,
      size: request.size,
      provider,
    })

    return strategy
  }

  private async selectOptimalProvider(request: UploadRequest): Promise<any> {
    // Auto-select provider based on organization preferences, health checks, etc.
    const healthChecks = await this.storageManager.performHealthCheck()
    const healthyProviders = healthChecks.filter((check) => check.healthy)

    if (healthyProviders.length === 0) {
      throw new UploadError(
        'No healthy storage providers available',
        'PROVIDER_ERROR',
        'initializing'
      )
    }

    // Use first healthy provider as default (could be more sophisticated)
    return healthyProviders[0].provider
  }

  // ============= Upload Execution =============

  private async executeUpload(
    request: UploadRequest,
    strategy: UploadStrategy,
    tracker: any,
    uploadId: string
  ): Promise<UploadResult> {
    const handler = this.strategies.get(strategy)
    if (!handler) {
      throw new UploadError(`Strategy ${strategy} not available`, 'PROVIDER_ERROR', 'preparing')
    }

    if (!handler.canHandle(request)) {
      throw new UploadError(
        `Strategy ${strategy} cannot handle this request`,
        'PROVIDER_ERROR',
        'preparing'
      )
    }

    tracker.updateStage('uploading', 'Executing upload strategy...')

    const enhancedRequest = {
      ...request,
      strategy,
      uploadId,
    }

    return handler.execute(enhancedRequest, tracker)
  }

  // ============= Post-processing =============

  private async postProcessUpload(
    result: UploadResult,
    request: UploadRequest,
    tracker: any
  ): Promise<void> {
    tracker.updateStage('processing', 'Post-processing upload...')

    // Only create StorageLocation - no file records here
    // File records will be created by processors in the completion endpoint

    // Generate access URLs if needed
    if (request.visibility === 'public') {
      const publicDownloadRef = await this.storageManager.getDownloadRef({
        locationId: result.storageLocationId,
        ttlSec: undefined, // Public URLs don't expire
        filename: result.filename,
        mimeType: result.mimeType,
      })
      result.publicUrl = publicDownloadRef.type === 'url' ? publicDownloadRef.url : undefined
    }

    const downloadRef = await this.storageManager.getDownloadRef({
      locationId: result.storageLocationId,
      ttlSec: this.config.defaultUrlTtl || 3600,
      filename: result.filename,
      mimeType: result.mimeType,
    })
    result.downloadUrl = downloadRef.type === 'url' ? downloadRef.url : undefined
    result.downloadExpiresAt = downloadRef.type === 'url' ? downloadRef.expiresAt : undefined

    tracker.updateStage('storage-complete', 'File stored successfully, ready for processing')
  }

  /**
   * Complete upload for session-based uploads (used by processors)
   */
  async completeUpload(sessionId: string): Promise<{
    storageLocationId: string
    size: number
    mimeType: string
    checksum?: string
  }> {
    // This method will be used by the completion endpoint
    // to validate that upload occurred and return storage info

    // For now, return placeholder - this would integrate with session management
    throw new Error('Session-based upload completion not yet implemented')
  }

  // ============= Batch Processing =============

  private optimizeBatch(requests: UploadRequest[]): OptimizedBatch[] {
    const batches: OptimizedBatch[] = []

    // Group by provider for efficiency
    const providerGroups = new Map<string, UploadRequest[]>()

    for (const request of requests) {
      const provider = request.provider || 'S3' // Default provider
      if (!providerGroups.has(provider)) {
        providerGroups.set(provider, [])
      }
      providerGroups.get(provider)!.push(request)
    }

    // Create optimized batches
    for (const [provider, groupRequests] of Array.from(providerGroups.entries())) {
      // Small files: batch together for parallel processing
      const smallFiles = groupRequests.filter((r) => (r.size || 0) < 50 * 1024 * 1024)
      if (smallFiles.length > 0) {
        batches.push({
          provider: provider as any,
          strategy: 'direct',
          requests: smallFiles,
          parallel: true,
          maxConcurrency: Math.min(smallFiles.length, this.config.maxConcurrentUploads || 5),
        })
      }

      // Large files: process individually with multipart
      const largeFiles = groupRequests.filter((r) => (r.size || 0) >= 50 * 1024 * 1024)
      for (const request of largeFiles) {
        batches.push({
          provider: provider as any,
          strategy: 'multipart',
          requests: [request],
          parallel: false,
          maxConcurrency: 1,
        })
      }
    }

    return batches
  }

  private async executeParallelBatch(
    batch: OptimizedBatch,
    options: BatchUploadOptions
  ): Promise<{ successes: UploadResult[]; errors: UploadError[] }> {
    const successes: UploadResult[] = []
    const errors: UploadError[] = []

    // Process in chunks based on concurrency limit
    const chunkSize = batch.maxConcurrency
    for (let i = 0; i < batch.requests.length; i += chunkSize) {
      const chunk = batch.requests.slice(i, i + chunkSize)

      const promises = chunk.map(async (request) => {
        try {
          const result = await this.upload(request)
          successes.push(result)
        } catch (error) {
          if (error instanceof UploadError) {
            errors.push(error)
          } else {
            errors.push(
              new UploadError(
                `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
                'PROVIDER_ERROR',
                'uploading'
              )
            )
          }
        }
      })

      await Promise.all(promises)
    }

    return { successes, errors }
  }

  private async executeSequentialBatch(
    batch: OptimizedBatch,
    options: BatchUploadOptions
  ): Promise<{ successes: UploadResult[]; errors: UploadError[] }> {
    const successes: UploadResult[] = []
    const errors: UploadError[] = []

    for (const request of batch.requests) {
      try {
        const result = await this.upload(request)
        successes.push(result)
      } catch (error) {
        if (error instanceof UploadError) {
          errors.push(error)
        } else {
          errors.push(
            new UploadError(
              `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
              'PROVIDER_ERROR',
              'uploading'
            )
          )
        }

        if (!options.continueOnError) {
          break
        }
      }
    }

    return { successes, errors }
  }

  private generateBatchSummary(results: UploadResult[], errors: UploadError[]) {
    const totalSize = results.reduce((sum, result) => sum + result.size, 0)
    const totalDuration = results.reduce((sum, result) => sum + result.uploadDuration, 0)
    const averageThroughput =
      results.length > 0
        ? results.reduce((sum, result) => sum + result.throughput, 0) / results.length
        : 0

    return {
      totalFiles: results.length + errors.length,
      successCount: results.length,
      errorCount: errors.length,
      totalSize,
      totalDuration,
      averageThroughput,
    }
  }

  // ============= Validation =============

  private async validateRequest(request: UploadRequest, tracker: any): Promise<void> {
    tracker.updateStage('validating', 'Validating upload request...')

    if (!request.content) {
      throw new UploadError('Content is required', 'VALIDATION_FAILED', 'validating')
    }

    if (!request.filename) {
      throw new UploadError('Filename is required', 'VALIDATION_FAILED', 'validating')
    }

    if (!request.organizationId) {
      throw new UploadError('Organization ID is required', 'VALIDATION_FAILED', 'validating')
    }

    if (!request.userId) {
      throw new UploadError('User ID is required', 'VALIDATION_FAILED', 'validating')
    }

    // File size validation
    const fileSize = request.size || this.getFileSize(request.content, request.size)
    if (fileSize > (this.config.maxFileSize || Infinity)) {
      throw new UploadError(
        `File size ${fileSize} exceeds maximum allowed size ${this.config.maxFileSize}`,
        'FILE_TOO_LARGE',
        'validating'
      )
    }

    tracker.updateProgress(0, 'Validation completed')
  }

  // ============= Error Handling =============

  private async handleUploadError(
    error: any,
    uploadId: string,
    tracker: any,
    request: UploadRequest
  ): Promise<void> {
    const uploadError =
      error instanceof UploadError
        ? error
        : new UploadError(
            `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
            'PROVIDER_ERROR',
            'uploading',
            true,
            error instanceof Error ? error : undefined
          )

    enhancedProgressTracker.fail(uploadId, uploadError)

    logger.error('Enhanced upload failed', {
      uploadId,
      filename: request.filename,
      error: uploadError.message,
      code: uploadError.code,
      stage: uploadError.stage,
      retryable: uploadError.retryable,
    })

    // Emit error via SSE if organization ID available
    if (request.organizationId) {
      await fileUploadEventPublisher.emitUploadFailed(uploadId, request.organizationId, {
        stage: uploadError.stage,
        error: uploadError.message,
        recoverable: uploadError.retryable,
        fileId: request.filename,
        suggestedAction: uploadError.retryable ? 'retry' : 'contact_support',
      })
    }
  }

  // ============= Utility Methods =============

  private generateUploadId(): string {
    return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
  }

  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
  }

  private getFileSize(
    content: File | Buffer | NodeJS.ReadableStream,
    providedSize?: number
  ): number {
    // Feature-detect File type (browser environment)
    if (typeof (global as any).File !== 'undefined' && content instanceof (global as any).File) {
      return (content as any).size
    }
    if (Buffer.isBuffer(content)) {
      return content.length
    }
    if (providedSize != null) {
      return providedSize
    }
    // For streams without provided size, this is a validation error
    // Streams must have size specified for proper validation
    throw new Error('Size is required for stream uploads in Node.js environment')
  }
}

// Factory function to create service instances for specific organizations
export const createFileUploadService = (organizationId: string, config?: UploadServiceConfig) =>
  new FileUploadService(organizationId, config)
