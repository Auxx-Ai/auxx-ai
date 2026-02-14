// packages/lib/src/files/session/file-upload-session.ts

import { createScopedLogger } from '@auxx/logger'
import type {
  EntityType,
  FileInfo,
  SessionConfig,
  SessionData,
  SessionProgress,
  SessionStatus,
  SessionUpdate,
} from '../types'
import type { FileUploadProgressTracker } from './progress/progress-tracker'
import { fileUploadEventPublisher } from './progress/sse-publisher'

const logger = createScopedLogger('file-upload-session')

/**
 * File upload session management class
 * Handles session lifecycle, progress tracking, and event publishing
 */
export class FileUploadSession {
  readonly id: string
  readonly entityType: EntityType
  readonly entityId?: string
  readonly organizationId: string
  readonly userId: string

  private _status: SessionStatus = 'created'
  private _files: FileInfo[] = []
  private _metadata: Record<string, any> = {}
  private _createdAt: Date
  private _updatedAt: Date
  private _expiresAt: Date
  private _startedAt?: Date
  private _completedAt?: Date
  private _failedAt?: Date

  public progressTracker?: FileUploadProgressTracker

  constructor(config: SessionConfig) {
    this.id = config.id
    this.entityType = config.entityType
    this.entityId = config.entityId
    this.organizationId = config.organizationId
    this.userId = config.userId

    const now = new Date()
    this._createdAt = now
    this._updatedAt = now
    this._expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 24 hours default

    logger.info('File upload session created', {
      sessionId: this.id,
      entityType: this.entityType,
      entityId: this.entityId,
      organizationId: this.organizationId,
      userId: this.userId,
    })
  }

  /**
   * Session property getters
   */
  get status(): SessionStatus {
    return this._status
  }
  get files(): FileInfo[] {
    return [...this._files]
  }
  get metadata(): Record<string, any> {
    return { ...this._metadata }
  }
  get createdAt(): Date {
    return this._createdAt
  }
  get updatedAt(): Date {
    return this._updatedAt
  }
  get expiresAt(): Date {
    return this._expiresAt
  }
  get startedAt(): Date | undefined {
    return this._startedAt
  }
  get completedAt(): Date | undefined {
    return this._completedAt
  }
  get failedAt(): Date | undefined {
    return this._failedAt
  }

  /**
   * Check if session is expired
   */
  get isExpired(): boolean {
    return new Date() > this._expiresAt
  }

  /**
   * Check if session is active
   */
  get isActive(): boolean {
    return this._status === 'active' && !this.isExpired
  }

  /**
   * Get session duration
   */
  get duration(): number | undefined {
    if (!this._startedAt) return undefined
    const endTime = this._completedAt || this._failedAt || new Date()
    return endTime.getTime() - this._startedAt.getTime()
  }

  /**
   * Start the upload session
   */
  async start(files: FileInfo[]): Promise<void> {
    if (this._status !== 'created') {
      throw new Error(`Cannot start session in ${this._status} status`)
    }

    if (this.isExpired) {
      throw new Error('Cannot start expired session')
    }

    this._files = files
    this._status = 'active'
    this._startedAt = new Date()
    this._updatedAt = new Date()

    logger.info('Upload session started', {
      sessionId: this.id,
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
    })

    // Emit session started event
    await fileUploadEventPublisher.emitUploadStarted(this.id, this.organizationId, {
      files: files.map((f) => ({
        id: f.id || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: f.name,
        size: f.size,
        type: f.type,
      })),
      entityType: this.entityType,
      entityId: this.entityId,
    })
  }

  /**
   * Update session status and data
   */
  async update(updates: SessionUpdate): Promise<void> {
    this._updatedAt = new Date()

    if (updates.status && updates.status !== this._status) {
      const oldStatus = this._status
      this._status = updates.status

      // Set timestamps based on status changes
      if (updates.status === 'active' && !this._startedAt) {
        this._startedAt = updates.startedAt || new Date()
      } else if (updates.status === 'completed') {
        this._completedAt = updates.completedAt || new Date()
      } else if (updates.status === 'failed') {
        this._failedAt = updates.failedAt || new Date()
      }

      logger.info('Session status updated', {
        sessionId: this.id,
        oldStatus,
        newStatus: this._status,
      })
    }

    if (updates.files) {
      this._files = updates.files
    }

    if (updates.metadata) {
      this._metadata = { ...this._metadata, ...updates.metadata }
    }
  }

  /**
   * Update progress for specific file
   */
  async updateFileProgress(
    fileId: string,
    progress: number,
    status?: FileInfo['status'],
    error?: string
  ): Promise<void> {
    const fileIndex = this._files.findIndex((f) => f.id === fileId || f.name === fileId)
    if (fileIndex === -1) {
      logger.warn('Attempted to update progress for unknown file', {
        sessionId: this.id,
        fileId,
      })
      return
    }

    const file = this._files[fileIndex]
    const updatedFile: FileInfo = {
      ...file,
      progress,
      status: status || file.status,
      error: error || file.error,
    }

    this._files[fileIndex] = updatedFile
    this._updatedAt = new Date()

    // Emit progress event
    await fileUploadEventPublisher.emitUploadProgress(this.id, this.organizationId, {
      fileId: file.id || file.name,
      tempFileId: fileId, // Pass through the temp ID if provided
      filename: file.name,
      bytesUploaded: Math.round((file.size * progress) / 100),
      totalBytes: file.size,
      progress,
    })
  }

  /**
   * Report processing progress
   */
  async reportProcessingProgress(stage: string, progress: number, message?: string): Promise<void> {
    this._updatedAt = new Date()

    await fileUploadEventPublisher.emitProcessingProgress(this.id, this.organizationId, stage, {
      stageProgress: progress,
      overallProgress: this.calculateOverallProgress(),
      message,
    })
  }

  /**
   * Complete the session successfully
   */
  async complete(results?: any): Promise<void> {
    if (this._status === 'completed') {
      return // Already completed
    }

    this._status = 'completed'
    this._completedAt = new Date()
    this._updatedAt = new Date()

    // Mark all files as completed
    this._files = this._files.map((f) => ({
      ...f,
      status: 'completed',
      progress: 100,
    }))

    logger.info('Upload session completed', {
      sessionId: this.id,
      duration: this.duration,
      fileCount: this._files.length,
    })

    await fileUploadEventPublisher.emitProcessingCompleted(this.id, this.organizationId, 'all', {
      message: 'All files processed successfully',
      overallProgress: 100,
      result: results,
    })
  }

  /**
   * Fail the session with error
   */
  async fail(error: Error, stage?: string): Promise<void> {
    if (this._status === 'failed') {
      return // Already failed
    }

    this._status = 'failed'
    this._failedAt = new Date()
    this._updatedAt = new Date()

    logger.error('Upload session failed', {
      sessionId: this.id,
      error: error.message,
      stage,
      duration: this.duration,
    })

    await fileUploadEventPublisher.emitError(this.id, this.organizationId, {
      stage: stage || 'unknown',
      error: error.message,
      recoverable: true,
    })
  }

  /**
   * Cancel the session
   */
  async cancel(reason?: string): Promise<void> {
    if (['completed', 'failed', 'cancelled'].includes(this._status)) {
      return // Already in terminal state
    }

    this._status = 'cancelled'
    this._updatedAt = new Date()

    logger.info('Upload session cancelled', {
      sessionId: this.id,
      reason,
      duration: this.duration,
    })

    // Could emit a cancelled event if needed
  }

  /**
   * Expire the session
   */
  async expire(): Promise<void> {
    if (['completed', 'failed'].includes(this._status)) {
      return // Don't expire completed/failed sessions
    }

    this._status = 'expired'
    this._updatedAt = new Date()

    logger.info('Upload session expired', {
      sessionId: this.id,
      originalStatus: this._status,
      duration: this.duration,
    })
  }

  /**
   * Close the session and clean up resources
   */
  async close(): Promise<void> {
    // If still active, mark as cancelled
    if (this.isActive) {
      await this.cancel('Session closed')
    }

    // Clean up progress tracker if present
    this.progressTracker = undefined

    logger.debug('Upload session closed', {
      sessionId: this.id,
      finalStatus: this._status,
    })
  }

  /**
   * Get current session progress summary
   */
  getProgress(): SessionProgress {
    const completedFiles = this._files.filter((f) => f.status === 'completed').length
    const totalBytes = this._files.reduce((sum, f) => sum + f.size, 0)
    const processedBytes = this._files.reduce((sum, f) => {
      const progress = f.progress || 0
      return sum + Math.round((f.size * progress) / 100)
    }, 0)

    return {
      sessionId: this.id,
      overallProgress: this.calculateOverallProgress(),
      currentStage: this.getCurrentStage(),
      stageProgress: this.progressTracker?.getStatus().stageProgress || 0,
      filesCompleted: completedFiles,
      totalFiles: this._files.length,
      bytesProcessed: processedBytes,
      totalBytes,
      startedAt: this._startedAt,
      lastUpdated: this._updatedAt,
    }
  }

  /**
   * Serialize session to data object
   */
  toData(): SessionData {
    return {
      id: this.id,
      entityType: this.entityType,
      entityId: this.entityId,
      organizationId: this.organizationId,
      userId: this.userId,
      status: this._status,
      files: this._files,
      metadata: this._metadata,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      expiresAt: this._expiresAt.toISOString(),
      startedAt: this._startedAt?.toISOString(),
      completedAt: this._completedAt?.toISOString(),
      failedAt: this._failedAt?.toISOString(),
    }
  }

  /**
   * Create session from data object
   */
  static fromData(data: SessionData): FileUploadSession {
    const session = new FileUploadSession({
      id: data.id,
      entityType: data.entityType,
      entityId: data.entityId,
      organizationId: data.organizationId,
      userId: data.userId,
    })

    session._status = data.status
    session._files = data.files
    session._metadata = data.metadata
    session._createdAt = new Date(data.createdAt)
    session._updatedAt = new Date(data.updatedAt)
    session._expiresAt = new Date(data.expiresAt)
    session._startedAt = data.startedAt ? new Date(data.startedAt) : undefined
    session._completedAt = data.completedAt ? new Date(data.completedAt) : undefined
    session._failedAt = data.failedAt ? new Date(data.failedAt) : undefined

    return session
  }

  /**
   * Calculate overall progress based on files and stages
   */
  private calculateOverallProgress(): number {
    if (this._files.length === 0) return 0

    const fileProgress =
      this._files.reduce((sum, f) => sum + (f.progress || 0), 0) / this._files.length
    const stageProgress = this.progressTracker?.getStatus().overallProgress || 0

    // Weight file upload at 30%, processing at 70%
    return Math.round(fileProgress * 0.3 + stageProgress * 0.7)
  }

  /**
   * Get current processing stage
   */
  private getCurrentStage(): string {
    if (this._status === 'completed') return 'completed'
    if (this._status === 'failed') return 'failed'
    if (this._status === 'cancelled') return 'cancelled'
    if (this._status === 'expired') return 'expired'

    return this.progressTracker?.getStatus().currentStage || 'uploading'
  }
}
