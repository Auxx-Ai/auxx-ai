// packages/lib/src/files/upload/progress/enhanced-progress-tracker.ts

import { createScopedLogger } from '@auxx/logger'
import { EventEmitter } from 'events'
import type {
  ProgressContext,
  UploadError,
  UploadProgress,
  UploadProgressState,
  UploadRequest,
  UploadStage,
} from '../enhanced-types'
import { fileUploadEventPublisher } from './sse-publisher'

const logger = createScopedLogger('enhanced-progress-tracker')

/**
 * Enhanced progress tracking system for uploads
 * Integrates with existing SSE publisher and provides real-time metrics
 */
export class EnhancedProgressTracker {
  private activeUploads = new Map<string, UploadProgressState>()
  private eventEmitter = new EventEmitter()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Create a new upload progress tracker
   */
  create(uploadId: string, request: UploadRequest): ProgressContext {
    const state: UploadProgressState = {
      uploadId,
      stage: 'initializing',
      bytesUploaded: 0,
      totalBytes: request.size || this.estimateFileSize(request.content),
      startTime: Date.now(),
      lastUpdate: Date.now(),
      speed: 0,
      eta: 0,
      percentage: 0,
      message: 'Starting upload...',
      errors: [],
      organizationId: request.organizationId,
    }

    this.activeUploads.set(uploadId, state)

    logger.debug('Created enhanced progress tracker', {
      uploadId,
      filename: request.filename,
      totalBytes: state.totalBytes,
      strategy: request.strategy,
    })

    return new EnhancedProgressContextImpl(uploadId, state, this)
  }

  /**
   * Restore a progress tracker from saved state (for resumable uploads)
   */
  restore(uploadId: string, savedState: Partial<UploadProgressState>): ProgressContext {
    const state: UploadProgressState = {
      uploadId,
      stage: savedState.stage || 'initializing',
      bytesUploaded: savedState.bytesUploaded || 0,
      totalBytes: savedState.totalBytes || 0,
      startTime: savedState.startTime || Date.now(),
      lastUpdate: Date.now(),
      speed: 0,
      eta: 0,
      percentage: 0,
      message: 'Resuming upload...',
      errors: savedState.errors || [],
      organizationId: savedState.organizationId,
    }

    // Recalculate percentage and metrics
    this.recalculateMetrics(state)

    this.activeUploads.set(uploadId, state)

    logger.info('Restored enhanced progress tracker', {
      uploadId,
      bytesUploaded: state.bytesUploaded,
      totalBytes: state.totalBytes,
      percentage: state.percentage,
    })

    return new EnhancedProgressContextImpl(uploadId, state, this)
  }

  /**
   * Update upload progress with enhanced metrics
   */
  update(uploadId: string, updates: Partial<UploadProgressState>): void {
    const state = this.activeUploads.get(uploadId)
    if (!state) {
      logger.warn('Attempted to update non-existent enhanced progress tracker', { uploadId })
      return
    }

    const now = Date.now()
    const timeDelta = now - state.lastUpdate

    // Calculate enhanced metrics if bytes updated
    if (updates.bytesUploaded !== undefined && updates.bytesUploaded !== state.bytesUploaded) {
      this.updateSpeedMetrics(state, updates.bytesUploaded, timeDelta)
    }

    // Apply updates
    Object.assign(state, updates, { lastUpdate: now })

    // Recalculate all metrics
    this.recalculateMetrics(state)

    // Emit progress event
    this.eventEmitter.emit('progress', uploadId, state)

    // Notify via SSE with enhanced data
    this.notifyProgress(uploadId, state)
  }

  /**
   * Get current progress for an upload
   */
  getProgress(uploadId: string): UploadProgress | null {
    const state = this.activeUploads.get(uploadId)
    if (!state) return null

    return this.stateToProgress(state)
  }

  /**
   * Get all active uploads with metrics
   */
  getActiveUploads(): UploadProgress[] {
    return Array.from(this.activeUploads.values()).map((state) => this.stateToProgress(state))
  }

  /**
   * Get upload metrics for monitoring
   */
  getUploadMetrics(uploadId: string): {
    averageSpeed: number
    peakSpeed: number
    estimatedTimeRemaining: number
    efficiency: number
  } | null {
    const state = this.activeUploads.get(uploadId)
    if (!state) return null

    const elapsed = Date.now() - state.startTime
    const averageSpeed = elapsed > 0 ? (state.bytesUploaded / elapsed) * 1000 : 0

    return {
      averageSpeed,
      peakSpeed: state.speed, // Current speed as peak for now
      estimatedTimeRemaining: state.eta,
      efficiency: state.totalBytes > 0 ? (state.bytesUploaded / state.totalBytes) * 100 : 0,
    }
  }

  /**
   * Cancel an upload with reason
   */
  cancel(uploadId: string, reason?: string): void {
    const state = this.activeUploads.get(uploadId)
    if (state) {
      state.stage = 'failed'
      state.message = reason || 'Upload cancelled'

      this.eventEmitter.emit('cancelled', uploadId, state)

      // Notify via SSE
      this.notifyProgress(uploadId, state)

      // Clean up after delay
      setTimeout(() => {
        this.activeUploads.delete(uploadId)
      }, 5000) // 5 seconds

      logger.info('Upload cancelled', { uploadId, reason })
    }
  }

  /**
   * Complete an upload with final metrics
   */
  complete(uploadId: string, message?: string): void {
    const state = this.activeUploads.get(uploadId)
    if (state) {
      state.stage = 'completed'
      state.percentage = 100
      state.bytesUploaded = state.totalBytes
      state.message = message || 'Upload completed successfully'

      // Calculate final metrics
      const totalTime = Date.now() - state.startTime
      const averageSpeed = totalTime > 0 ? (state.totalBytes / totalTime) * 1000 : 0

      this.eventEmitter.emit('completed', uploadId, state, {
        totalTime,
        averageSpeed,
        totalBytes: state.totalBytes,
      })

      // Notify via SSE
      this.notifyProgress(uploadId, state)

      // Keep completed uploads for status queries
      setTimeout(() => {
        this.activeUploads.delete(uploadId)
      }, 60000) // 1 minute

      logger.info('Upload completed', {
        uploadId,
        totalTime,
        averageSpeed: Math.round(averageSpeed),
        totalBytes: state.totalBytes,
      })
    }
  }

  /**
   * Mark upload as failed with error details
   */
  fail(uploadId: string, error: UploadError): void {
    const state = this.activeUploads.get(uploadId)
    if (state) {
      state.stage = 'failed'
      state.message = error.message
      state.errors.push(error)

      this.eventEmitter.emit('failed', uploadId, state, error)

      // Notify via SSE
      this.notifyProgress(uploadId, state)

      logger.error('Upload failed', {
        uploadId,
        error: error.message,
        stage: error.stage,
        retryable: error.retryable,
        bytesUploaded: state.bytesUploaded,
        totalBytes: state.totalBytes,
      })
    }
  }

  /**
   * Estimate file size from content
   */
  private estimateFileSize(content: File | Buffer | NodeJS.ReadableStream): number {
    if (content instanceof Buffer) {
      return content.length
    }
    if (content instanceof File) {
      return content.size
    }
    // For streams, size should be provided in request
    return 0
  }

  /**
   * Update speed metrics with smoothing
   */
  private updateSpeedMetrics(
    state: UploadProgressState,
    newBytesUploaded: number,
    timeDelta: number
  ): void {
    const bytesDelta = newBytesUploaded - state.bytesUploaded

    if (timeDelta > 0 && bytesDelta > 0) {
      const instantSpeed = (bytesDelta / timeDelta) * 1000 // bytes/second

      // Apply exponential smoothing to speed for stability
      const alpha = 0.3 // Smoothing factor
      state.speed =
        state.speed === 0 ? instantSpeed : alpha * instantSpeed + (1 - alpha) * state.speed
    }
  }

  /**
   * Recalculate all metrics based on current state
   */
  private recalculateMetrics(state: UploadProgressState): void {
    // Calculate percentage
    if (state.totalBytes > 0) {
      state.percentage = Math.min(100, (state.bytesUploaded / state.totalBytes) * 100)
    }

    // Calculate ETA
    if (state.speed > 0 && state.totalBytes > 0) {
      const remainingBytes = state.totalBytes - state.bytesUploaded
      state.eta = (remainingBytes / state.speed) * 1000 // milliseconds
    } else {
      state.eta = 0
    }
  }

  /**
   * Notify progress via SSE publisher with enhanced data
   */
  private async notifyProgress(uploadId: string, state: UploadProgressState): Promise<void> {
    if (!state.organizationId) return

    try {
      // Convert to format expected by existing SSE publisher with enhanced data
      await fileUploadEventPublisher.emitUploadProgress(uploadId, state.organizationId, {
        stage: state.stage,
        progress: state.percentage,
        speed: state.speed,
        eta: state.eta,
        message: state.message,
        bytesUploaded: state.bytesUploaded,
        totalBytes: state.totalBytes,
        // Enhanced metrics
        averageSpeed: this.calculateAverageSpeed(state),
        elapsedTime: Date.now() - state.startTime,
        errorCount: state.errors.length,
      })
    } catch (error) {
      logger.warn('Failed to emit enhanced progress event via SSE', {
        uploadId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Calculate average speed since upload start
   */
  private calculateAverageSpeed(state: UploadProgressState): number {
    const elapsed = Date.now() - state.startTime
    return elapsed > 0 ? (state.bytesUploaded / elapsed) * 1000 : 0
  }

  /**
   * Convert progress state to public progress interface
   */
  private stateToProgress(state: UploadProgressState): UploadProgress {
    return {
      stage: state.stage,
      bytesUploaded: state.bytesUploaded,
      totalBytes: state.totalBytes,
      percentage: state.percentage,
      speed: state.speed,
      eta: state.eta,
      message: state.message,
      errors: state.errors,
    }
  }

  /** Start periodic cleanup of stale uploads. Idempotent. */
  startCleanupInterval(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 60 * 1000)
    // Don't keep Node.js alive solely for this interval
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref()
    }
  }

  /** Stop periodic cleanup (for graceful shutdown). */
  stopCleanupInterval(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Clean up old inactive uploads
   */
  cleanup(): void {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours

    for (const [uploadId, state] of this.activeUploads.entries()) {
      if (now - state.lastUpdate > maxAge) {
        this.activeUploads.delete(uploadId)
        logger.debug('Cleaned up old enhanced upload tracker', { uploadId })
      }
    }
  }

  /**
   * Get system-wide upload statistics
   */
  getSystemStats(): {
    activeUploads: number
    totalBytesUploading: number
    averageUploadSpeed: number
    completedToday: number
  } {
    const activeStates = Array.from(this.activeUploads.values())
    const totalBytes = activeStates.reduce((sum, state) => sum + state.totalBytes, 0)
    const averageSpeed =
      activeStates.length > 0
        ? activeStates.reduce((sum, state) => sum + state.speed, 0) / activeStates.length
        : 0

    return {
      activeUploads: activeStates.length,
      totalBytesUploading: totalBytes,
      averageUploadSpeed: averageSpeed,
      completedToday: 0, // Would need persistence to track this
    }
  }
}

/**
 * Enhanced progress context implementation for upload operations
 */
class EnhancedProgressContextImpl implements ProgressContext {
  constructor(
    public readonly uploadId: string,
    private readonly state: UploadProgressState,
    private readonly tracker: EnhancedProgressTracker
  ) {}

  updateStage(stage: UploadStage, message: string): void {
    this.tracker.update(this.uploadId, { stage, message })
  }

  updateProgress(bytesUploaded: number, message?: string): void {
    const updates: Partial<UploadProgressState> = { bytesUploaded }
    if (message) updates.message = message
    this.tracker.update(this.uploadId, updates)
  }

  addError(error: UploadError): void {
    const errors = [...this.state.errors, error]
    this.tracker.update(this.uploadId, { errors })
  }

  onProgress(callback: (progress: UploadProgress) => void): () => void {
    const handler = (id: string, state: UploadProgressState) => {
      if (id === this.uploadId) {
        callback(this.tracker['stateToProgress'](state))
      }
    }

    this.tracker['eventEmitter'].on('progress', handler)

    return () => this.tracker['eventEmitter'].off('progress', handler)
  }

  /**
   * Get real-time metrics for this upload
   */
  getMetrics(): {
    averageSpeed: number
    currentSpeed: number
    eta: number
    efficiency: number
  } {
    const elapsed = Date.now() - this.state.startTime
    const averageSpeed = elapsed > 0 ? (this.state.bytesUploaded / elapsed) * 1000 : 0
    const efficiency =
      this.state.totalBytes > 0 ? (this.state.bytesUploaded / this.state.totalBytes) * 100 : 0

    return {
      averageSpeed,
      currentSpeed: this.state.speed,
      eta: this.state.eta,
      efficiency,
    }
  }
}

/** Lazy singleton — constructed on first access, not at module load. */
let _instance: EnhancedProgressTracker | null = null
export function getEnhancedProgressTracker(): EnhancedProgressTracker {
  if (!_instance) {
    _instance = new EnhancedProgressTracker()
    _instance.startCleanupInterval()
  }
  return _instance
}
