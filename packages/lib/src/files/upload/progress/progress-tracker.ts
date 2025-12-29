// packages/lib/src/files/utils/progress-tracker.ts

import { createScopedLogger } from '@auxx/logger'
import { FileUploadEventPublisher } from './sse-publisher'

const logger = createScopedLogger('file-upload-progress-tracker')

/**
 * Configuration for a processing stage
 */
export interface StageConfig {
  name: string
  weight: number // Percentage of total progress this stage represents
  subStages?: { name: string; weight: number }[]
}

/**
 * Progress tracker status
 */
export interface ProgressStatus {
  currentStage: string
  stageProgress: number // 0-100 progress within current stage
  overallProgress: number // 0-100 overall progress across all stages
  isComplete: boolean
  totalStages: number
  currentStageIndex: number
}

/**
 * File upload progress tracker
 * Manages progress across multiple stages with automatic SSE event publishing
 */
export class FileUploadProgressTracker {
  private stages: StageConfig[]
  private currentStageIndex: number = 0
  private currentStageProgress: number = 0
  private publisher?: FileUploadEventPublisher
  private sessionId?: string
  private organizationId?: string
  private startTime: Date

  constructor(stages: StageConfig[], sessionId?: string, organizationId?: string) {
    this.stages = stages.map((stage) => ({
      ...stage,
      weight: Math.max(0, Math.min(100, stage.weight)), // Clamp to 0-100
    }))

    // Normalize weights to sum to 100
    this.normalizeWeights()

    this.sessionId = sessionId
    this.organizationId = organizationId
    this.startTime = new Date()

    if (sessionId && organizationId) {
      this.publisher = FileUploadEventPublisher.getInstance()
    }

    logger.debug('Progress tracker initialized', {
      sessionId,
      stageCount: stages.length,
      stages: stages.map((s) => ({ name: s.name, weight: s.weight })),
    })
  }

  /**
   * Start a specific stage by name
   */
  async startStage(stageName: string, message?: string): Promise<void> {
    const stageIndex = this.stages.findIndex((s) => s.name === stageName)
    if (stageIndex === -1) {
      throw new Error(`Stage '${stageName}' not found in configuration`)
    }

    this.currentStageIndex = stageIndex
    this.currentStageProgress = 0

    logger.info('Stage started', {
      sessionId: this.sessionId,
      stage: stageName,
      stageIndex,
      totalStages: this.stages.length,
      message,
    })

    // Emit processing started event
    if (this.publisher && this.sessionId && this.organizationId) {
      await this.publisher.emitProcessingStarted(this.sessionId, this.organizationId, stageName, {
        message,
        entityType: 'file-upload', // Generic entity type for progress tracking
        entityId: this.sessionId,
      })
    }
  }

  /**
   * Update progress within the current stage
   */
  async updateStageProgress(
    progress: number,
    message?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    this.currentStageProgress = Math.max(0, Math.min(100, progress))

    const currentStage = this.getCurrentStage()
    const overallProgress = this.calculateOverallProgress()

    logger.debug('Stage progress updated', {
      sessionId: this.sessionId,
      stage: currentStage?.name,
      stageProgress: this.currentStageProgress,
      overallProgress,
      message,
    })

    // Emit processing progress event
    if (this.publisher && this.sessionId && this.organizationId && currentStage) {
      await this.publisher.emitProcessingProgress(
        this.sessionId,
        this.organizationId,
        currentStage.name,
        {
          stageProgress: this.currentStageProgress,
          overallProgress,
          message,
          metadata,
        }
      )
    }
  }

  /**
   * Complete the current stage and optionally advance to the next
   */
  async completeStage(message?: string, autoAdvance: boolean = true): Promise<void> {
    this.currentStageProgress = 100
    const currentStage = this.getCurrentStage()

    if (currentStage) {
      logger.info('Stage completed', {
        sessionId: this.sessionId,
        stage: currentStage.name,
        stageIndex: this.currentStageIndex,
        message,
      })
    }

    // Emit stage completion
    if (this.publisher && this.sessionId && this.organizationId && currentStage) {
      await this.publisher.emitProcessingCompleted(
        this.sessionId,
        this.organizationId,
        currentStage.name,
        {
          message,
          overallProgress: this.calculateOverallProgress(),
        }
      )
    }

    // Auto-advance to next stage if requested and available
    if (autoAdvance && this.currentStageIndex < this.stages.length - 1) {
      this.currentStageIndex++
      this.currentStageProgress = 0

      const nextStage = this.getCurrentStage()
      if (nextStage) {
        await this.startStage(nextStage.name, `Starting ${nextStage.name}`)
      }
    }
  }

  /**
   * Complete all remaining stages
   */
  async completeAll(message?: string): Promise<void> {
    // Set to final stage at 100%
    this.currentStageIndex = this.stages.length - 1
    this.currentStageProgress = 100

    const duration = Date.now() - this.startTime.getTime()

    logger.info('All stages completed', {
      sessionId: this.sessionId,
      totalStages: this.stages.length,
      duration,
      message,
    })

    // Emit final completion event
    if (this.publisher && this.sessionId && this.organizationId) {
      await this.publisher.emitProcessingCompleted(this.sessionId, this.organizationId, 'all', {
        message: message || 'All processing stages completed',
        overallProgress: 100,
      })
    }
  }

  /**
   * Report an error at the current stage
   */
  async reportError(
    error: Error,
    recoverable: boolean = false,
    metadata?: Record<string, any>
  ): Promise<void> {
    const currentStage = this.getCurrentStage()

    logger.error('Stage error reported', {
      sessionId: this.sessionId,
      stage: currentStage?.name || 'unknown',
      error: error.message,
      recoverable,
      metadata,
    })

    if (this.publisher && this.sessionId && this.organizationId) {
      await this.publisher.emitError(this.sessionId, this.organizationId, {
        stage: currentStage?.name || 'unknown',
        error: error.message,
        recoverable,
        details: {
          stageProgress: this.currentStageProgress,
          overallProgress: this.calculateOverallProgress(),
          ...metadata,
        },
      })
    }
  }

  /**
   * Jump to a specific stage (useful for retries or non-linear processing)
   */
  async jumpToStage(stageName: string, progress: number = 0, message?: string): Promise<void> {
    const stageIndex = this.stages.findIndex((s) => s.name === stageName)
    if (stageIndex === -1) {
      throw new Error(`Stage '${stageName}' not found`)
    }

    this.currentStageIndex = stageIndex
    this.currentStageProgress = Math.max(0, Math.min(100, progress))

    logger.info('Jumped to stage', {
      sessionId: this.sessionId,
      stage: stageName,
      stageIndex,
      progress: this.currentStageProgress,
      message,
    })

    await this.startStage(stageName, message)
    if (progress > 0) {
      await this.updateStageProgress(progress, message)
    }
  }

  /**
   * Get current progress status
   */
  getStatus(): ProgressStatus {
    const currentStage = this.getCurrentStage()

    return {
      currentStage: currentStage?.name || 'unknown',
      stageProgress: this.currentStageProgress,
      overallProgress: this.calculateOverallProgress(),
      isComplete: this.isComplete(),
      totalStages: this.stages.length,
      currentStageIndex: this.currentStageIndex,
    }
  }

  /**
   * Get estimated time remaining (basic calculation)
   */
  getEstimatedTimeRemaining(): number | undefined {
    if (this.currentStageProgress === 0) return undefined

    const elapsed = Date.now() - this.startTime.getTime()
    const overallProgress = this.calculateOverallProgress()

    if (overallProgress === 0) return undefined

    const totalEstimatedTime = (elapsed / overallProgress) * 100
    return Math.round(totalEstimatedTime - elapsed)
  }

  /**
   * Get processing duration
   */
  getDuration(): number {
    return Date.now() - this.startTime.getTime()
  }

  /**
   * Reset progress tracker to initial state
   */
  reset(): void {
    this.currentStageIndex = 0
    this.currentStageProgress = 0
    this.startTime = new Date()

    logger.debug('Progress tracker reset', {
      sessionId: this.sessionId,
    })
  }

  /**
   * Get current stage configuration
   */
  private getCurrentStage(): StageConfig | undefined {
    return this.stages[this.currentStageIndex]
  }

  /**
   * Calculate overall progress across all stages
   */
  private calculateOverallProgress(): number {
    let totalProgress = 0

    // Add completed stages
    for (let i = 0; i < this.currentStageIndex; i++) {
      totalProgress += this.stages[i]!.weight
    }

    // Add current stage progress
    if (this.currentStageIndex < this.stages.length) {
      const currentStageWeight = this.stages[this.currentStageIndex]!.weight
      totalProgress += (currentStageWeight * this.currentStageProgress) / 100
    }

    return Math.round(Math.min(100, totalProgress))
  }

  /**
   * Check if all stages are complete
   */
  private isComplete(): boolean {
    return this.currentStageIndex >= this.stages.length - 1 && this.currentStageProgress >= 100
  }

  /**
   * Normalize stage weights to sum to 100%
   */
  private normalizeWeights(): void {
    const totalWeight = this.stages.reduce((sum, stage) => sum + stage.weight, 0)

    if (totalWeight === 0) {
      // Equal weights if all are zero
      const equalWeight = 100 / this.stages.length
      this.stages.forEach((stage) => {
        stage.weight = equalWeight
      })
    } else if (totalWeight !== 100) {
      // Scale weights to sum to 100
      const scaleFactor = 100 / totalWeight
      this.stages.forEach((stage) => {
        stage.weight = Math.round(stage.weight * scaleFactor)
      })

      // Handle rounding errors by adjusting the last stage
      const newTotal = this.stages.reduce((sum, stage) => sum + stage.weight, 0)
      if (newTotal !== 100 && this.stages.length > 0) {
        this.stages[this.stages.length - 1]!.weight += 100 - newTotal
      }
    }

    logger.debug('Stage weights normalized', {
      sessionId: this.sessionId,
      stages: this.stages.map((s) => ({ name: s.name, weight: s.weight })),
    })
  }
}
