// packages/lib/src/files/utils/job-progress-helper.ts

import { createScopedLogger } from '@auxx/logger'
import { fileUploadEventPublisher } from './sse-publisher'
import { SessionManager } from '../session-index'
import type { JobUpdateData } from './event-types'

const logger = createScopedLogger('job-progress-helper')

/**
 * Helper utility for background jobs to report progress via file upload SSE
 * Provides a bridge between BullMQ job progress and file upload session events
 */
export class JobProgressHelper {
  private jobId: string
  private jobType: string
  private organizationId: string
  private sessionId?: string
  private fileId?: string

  constructor(
    jobId: string,
    jobType: string,
    organizationId: string,
    options?: {
      sessionId?: string
      fileId?: string
    }
  ) {
    this.jobId = jobId
    this.jobType = jobType
    this.organizationId = organizationId
    this.sessionId = options?.sessionId
    this.fileId = options?.fileId
  }

  /**
   * Report that a job has been queued
   */
  async reportQueued(message?: string): Promise<void> {
    await this.publishJobUpdate({
      status: 'queued',
      queuedAt: new Date(),
      message: message || `${this.jobType} job queued`,
    })
  }

  /**
   * Report that a job has started
   */
  async reportStarted(message?: string): Promise<void> {
    await this.publishJobUpdate({
      status: 'started',
      startedAt: new Date(),
      message: message || `${this.jobType} job started`,
    })
  }

  /**
   * Report job progress with percentage and optional message
   */
  async reportProgress(
    progress: number,
    message?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Ensure progress is within valid range
    const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)))

    await this.publishJobUpdate({
      status: 'progress',
      progress: clampedProgress,
      updatedAt: new Date(),
      message: message || `${this.jobType} job ${clampedProgress}% complete`,
      result: metadata,
    })
  }

  /**
   * Report that a job has completed successfully
   */
  async reportCompleted(result?: any, message?: string): Promise<void> {
    await this.publishJobUpdate({
      status: 'completed',
      progress: 100,
      completedAt: new Date(),
      message: message || `${this.jobType} job completed successfully`,
      result,
    })
  }

  /**
   * Report that a job has failed
   */
  async reportFailed(error: string | Error, message?: string): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error

    await this.publishJobUpdate({
      status: 'failed',
      failedAt: new Date(),
      error: errorMessage,
      message: message || `${this.jobType} job failed: ${errorMessage}`,
    })
  }

  /**
   * Report processing stage progress for document/dataset processing
   * Maps job progress to specific processing stages
   */
  async reportStageProgress(
    stage: string,
    stageProgress: number,
    overallProgress: number,
    message?: string
  ): Promise<void> {
    if (!this.sessionId) {
      logger.warn('Cannot report stage progress without session ID', {
        jobId: this.jobId,
        stage,
      })
      return
    }

    try {
      await fileUploadEventPublisher.emitProcessingProgress(
        this.sessionId,
        this.organizationId,
        stage,
        {
          stageProgress: Math.round(stageProgress),
          overallProgress: Math.round(overallProgress),
          message,
          metadata: {
            jobId: this.jobId,
            jobType: this.jobType,
            fileId: this.fileId,
          },
        }
      )
    } catch (error) {
      logger.error('Failed to report stage progress', {
        error: error instanceof Error ? error.message : 'Unknown error',
        jobId: this.jobId,
        sessionId: this.sessionId,
        stage,
      })
    }
  }

  /**
   * Create a JobProgressHelper from job context
   * Convenience method for jobs that have file/session information
   */
  static fromJobContext(
    jobId: string,
    jobType: string,
    jobData: {
      organizationId: string
      fileId?: string
      sessionId?: string
      documentId?: string
      datasetId?: string
    }
  ): JobProgressHelper {
    return new JobProgressHelper(jobId, jobType, jobData.organizationId, {
      sessionId: jobData.sessionId,
      fileId: jobData.fileId,
    })
  }

  /**
   * Find and set session ID from file ID
   * Useful when job only has file ID but needs to report to session
   */
  async findSessionFromFile(): Promise<boolean> {
    if (!this.fileId || this.sessionId) {
      return !!this.sessionId
    }

    try {
      // Look for recent sessions that might contain this file
      const sessions = await SessionManager.querySessions({
        organizationId: this.organizationId,
        status: 'active',
        limit: 50, // Check recent sessions
      })

      for (const session of sessions) {
        const sessionFiles = session.files
        if (sessionFiles.some((file) => file.id === this.fileId)) {
          this.sessionId = session.id
          logger.info('Found session for file', {
            fileId: this.fileId,
            sessionId: this.sessionId,
            jobId: this.jobId,
          })
          return true
        }
      }

      logger.debug('No active session found for file', {
        fileId: this.fileId,
        jobId: this.jobId,
      })
      return false
    } catch (error) {
      logger.error('Failed to find session from file', {
        error: error instanceof Error ? error.message : 'Unknown error',
        fileId: this.fileId,
        jobId: this.jobId,
      })
      return false
    }
  }

  /**
   * Publish job update event via SSE
   */
  private async publishJobUpdate(updateData: Partial<JobUpdateData>): Promise<void> {
    // If we have a session ID, publish via file upload events
    if (this.sessionId) {
      try {
        await fileUploadEventPublisher.emitJobUpdate(this.sessionId, this.organizationId, {
          jobType: this.jobType,
          jobId: this.jobId,
          status: updateData.status!,
          progress: updateData.progress,
          message: updateData.message,
          result: updateData.result,
          error: updateData.error,
          queuedAt: updateData.queuedAt,
          startedAt: updateData.startedAt,
          updatedAt: updateData.updatedAt,
          completedAt: updateData.completedAt,
          failedAt: updateData.failedAt,
        })
      } catch (error) {
        logger.error('Failed to publish job update via SSE', {
          error: error instanceof Error ? error.message : 'Unknown error',
          jobId: this.jobId,
          sessionId: this.sessionId,
        })
      }
    } else {
      logger.debug('No session ID available for job progress reporting', {
        jobId: this.jobId,
        jobType: this.jobType,
      })
    }
  }

  /**
   * Get current job information
   */
  getJobInfo(): {
    jobId: string
    jobType: string
    organizationId: string
    sessionId?: string
    fileId?: string
  } {
    return {
      jobId: this.jobId,
      jobType: this.jobType,
      organizationId: this.organizationId,
      sessionId: this.sessionId,
      fileId: this.fileId,
    }
  }

  /**
   * Set session ID if it becomes available later
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId
  }

  /**
   * Set file ID if it becomes available later
   */
  setFileId(fileId: string): void {
    this.fileId = fileId
  }
}

/**
 * Factory function for creating JobProgressHelper instances
 */
export function createJobProgressHelper(
  jobId: string,
  jobType: string,
  organizationId: string,
  options?: {
    sessionId?: string
    fileId?: string
  }
): JobProgressHelper {
  return new JobProgressHelper(jobId, jobType, organizationId, options)
}

/**
 * Utility type for job context data
 */
export type JobProgressContext = {
  organizationId: string
  fileId?: string
  sessionId?: string
  documentId?: string
  datasetId?: string
  [key: string]: any
}
