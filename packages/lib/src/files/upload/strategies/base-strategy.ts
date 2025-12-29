// packages/lib/src/files/upload/strategies/base-strategy.ts

import type { StorageManager } from '../../storage/storage-manager'
import type { 
  UploadRequest, 
  UploadResult, 
  UploadStrategyHandler, 
  ProgressContext,
  UploadStage,
  UploadErrorCode
} from '../enhanced-types'
import { UploadError } from '../enhanced-types'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('upload-strategy')

/**
 * Abstract base class for upload strategies
 * Provides common functionality for all upload strategies
 */
export abstract class BaseUploadStrategy implements UploadStrategyHandler {
  protected readonly storageManager: StorageManager

  constructor(storageManager: StorageManager) {
    this.storageManager = storageManager
  }

  /**
   * Check if this strategy can handle the given request
   */
  abstract canHandle(request: UploadRequest): boolean

  /**
   * Execute the upload strategy
   */
  abstract execute(request: UploadRequest, progress: ProgressContext): Promise<UploadResult>

  /**
   * Resume a failed upload (optional)
   */
  async resume?(uploadId: string, progress: ProgressContext): Promise<UploadResult>

  /**
   * Cancel an in-progress upload (optional)
   */
  async cancel?(uploadId: string): Promise<void>

  /**
   * Generate a unique upload ID
   */
  protected generateUploadId(): string {
    return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
  }

  /**
   * Generate storage key for the file using new architecture
   * Format: {orgId}/{entity-type}/{entityId}/{timestamp}_{filename}
   */
  protected generateStorageKey(request: UploadRequest): string {
    const { organizationId, entityType, entityId, filename } = request

    // Use the new deriveStorageKey utility for consistent paths
    const { deriveStorageKey } = require('../util')

    return deriveStorageKey(organizationId, filename, {
      entityType: entityType || 'UNKNOWN',
      entityId: entityId || 'temp',
    })
  }

  /**
   * Get file size from different content types
   */
  protected getFileSize(content: File | Buffer | NodeJS.ReadableStream, providedSize?: number): number {
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

  /**
   * Convert content to Buffer if needed
   */
  protected async getContentAsBuffer(content: File | Buffer | NodeJS.ReadableStream): Promise<Buffer> {
    if (content instanceof Buffer) {
      return content
    }
    
    if (typeof File !== 'undefined' && content instanceof File) {
      const arrayBuffer = await content.arrayBuffer()
      return Buffer.from(arrayBuffer)
    }
    
    // Handle ReadableStream (Node.js streams)
    const stream = content as NodeJS.ReadableStream
    const chunks: Buffer[] = []
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  }

  /**
   * Build upload result from storage location and request
   */
  protected buildUploadResult(
    storageLocation: any, // StorageLocation from database
    request: UploadRequest,
    uploadDuration: number,
    uploadId: string
  ): UploadResult {
    const size = request.size || this.getFileSize(request.content, request.size)
    const throughput = uploadDuration > 0 ? (size / uploadDuration) * 1000 : 0 // bytes/second
    
    return {
      fileId: '', // Will be set by calling service after DB record creation
      storageLocationId: storageLocation.id,
      uploadId,
      filename: request.filename,
      size,
      mimeType: request.mimeType || 'application/octet-stream',
      checksum: storageLocation.metadata?.checksum || '',
      provider: request.provider!,
      storageKey: storageLocation.externalId,
      strategy: request.strategy!,
      uploadDuration,
      throughput,
      downloadUrl: undefined, // Will be generated if needed
      publicUrl: undefined, // Will be generated if needed
    }
  }

  /**
   * Handle upload errors with proper categorization
   */
  protected handleUploadError(error: any, stage: UploadStage, operation: string): never {
    logger.error(`Upload strategy error in ${operation}`, {
      error: error instanceof Error ? error.message : String(error),
      stage,
      operation,
    })

    if (error instanceof UploadError) {
      throw error
    }

    // Categorize error based on type
    let errorCode: UploadErrorCode = 'PROVIDER_ERROR'
    let retryable = false

    if (error.message?.includes('network') || error.message?.includes('timeout')) {
      errorCode = 'NETWORK_ERROR'
      retryable = true
    } else if (error.message?.includes('auth') || error.message?.includes('credential')) {
      errorCode = 'AUTHENTICATION_ERROR'
      retryable = false
    } else if (error.message?.includes('size') || error.message?.includes('large')) {
      errorCode = 'FILE_TOO_LARGE'
      retryable = false
    }

    throw new UploadError(
      `Upload failed: ${error.message || error}`,
      errorCode,
      stage,
      retryable,
      error instanceof Error ? error : undefined
    )
  }

  /**
   * Validate upload request
   */
  protected validateRequest(request: UploadRequest): void {
    if (!request.content) {
      throw new UploadError('Content is required', 'VALIDATION_FAILED', 'initializing')
    }
    
    if (!request.filename) {
      throw new UploadError('Filename is required', 'VALIDATION_FAILED', 'initializing')
    }
    
    if (!request.provider) {
      throw new UploadError('Provider is required', 'VALIDATION_FAILED', 'initializing')
    }
    
    if (!request.organizationId) {
      throw new UploadError('Organization ID is required', 'VALIDATION_FAILED', 'initializing')
    }
    
    if (!request.userId) {
      throw new UploadError('User ID is required', 'VALIDATION_FAILED', 'initializing')
    }
  }

  /**
   * Log strategy execution start
   */
  protected logStrategyStart(request: UploadRequest, strategy: string): void {
    logger.info(`Starting ${strategy} upload strategy`, {
      filename: request.filename,
      size: request.size || this.getFileSize(request.content, request.size),
      provider: request.provider,
      entityType: request.entityType,
      entityId: request.entityId,
    })
  }

  /**
   * Log strategy execution completion
   */
  protected logStrategyComplete(result: UploadResult, strategy: string): void {
    logger.info(`Completed ${strategy} upload strategy`, {
      uploadId: result.uploadId,
      filename: result.filename,
      size: result.size,
      duration: result.uploadDuration,
      throughput: Math.round(result.throughput),
    })
  }
}