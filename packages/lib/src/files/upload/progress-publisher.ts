// packages/lib/src/files/upload/progress-publisher.ts

import { createScopedLogger } from '@auxx/logger'
import { getPublishingClient } from '@auxx/redis'

const logger = createScopedLogger('upload-progress')

/**
 * Progress update structure for SSE
 */
export interface ProgressUpdate {
  sessionId: string
  status: 'uploading' | 'processing' | 'completed' | 'failed'
  progress?: number // 0-100 for upload progress
  message?: string
  timestamp: string
  details?: Record<string, any>
}

/**
 * Publisher for upload progress updates via Redis pub/sub
 */
export class ProgressPublisher {
  /**
   * Publish a progress update to subscribers
   */
  static async publishUpdate(update: ProgressUpdate): Promise<void> {
    try {
      const redis = await getPublishingClient(false)
      if (!redis) {
        logger.warn('Redis not available for progress publishing', { sessionId: update.sessionId })
        return
      }

      const channel = `upload:status:${update.sessionId}`
      await redis.publish(channel, JSON.stringify(update))

      logger.info('Published progress update', {
        sessionId: update.sessionId,
        status: update.status,
        progress: update.progress,
      })
    } catch (error) {
      logger.error('Failed to publish progress update', {
        sessionId: update.sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Publish a status change event
   */
  static async publishStatusChange(
    sessionId: string,
    status: ProgressUpdate['status'],
    message?: string
  ): Promise<void> {
    await ProgressPublisher.publishUpdate({
      sessionId,
      status,
      message,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Publish upload progress (client-side should handle byte-level progress)
   */
  static async publishProgress(
    sessionId: string,
    progress: number,
    message?: string
  ): Promise<void> {
    await ProgressPublisher.publishUpdate({
      sessionId,
      status: 'uploading',
      progress: Math.round(progress),
      message,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Publish processing started event
   */
  static async publishProcessingStarted(sessionId: string): Promise<void> {
    await ProgressPublisher.publishStatusChange(sessionId, 'processing', 'Processing uploaded file')
  }

  /**
   * Publish completion event
   */
  static async publishCompleted(sessionId: string, details?: Record<string, any>): Promise<void> {
    await ProgressPublisher.publishUpdate({
      sessionId,
      status: 'completed',
      message: 'Upload and processing completed successfully',
      timestamp: new Date().toISOString(),
      details,
    })
  }

  /**
   * Publish failure event
   */
  static async publishFailed(
    sessionId: string,
    message: string,
    details?: Record<string, any>
  ): Promise<void> {
    await ProgressPublisher.publishUpdate({
      sessionId,
      status: 'failed',
      message,
      timestamp: new Date().toISOString(),
      details,
    })
  }
}
