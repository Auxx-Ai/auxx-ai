// packages/lib/src/files/events/file-upload-event-publisher.ts

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { safeJsonStringify } from '../../../workflow-engine/utils/serialization'
import {
  type ErrorData,
  FileUploadChannels,
  type FileUploadEvent,
  FileUploadEventType,
  type JobUpdateData,
  type ProcessingProgressData,
  type SessionEventData as SessionData,
  type UploadProgressData,
} from '../../types'
import { FileUploadEventSchemaValidator } from './event-schemas'

const logger = createScopedLogger('file-upload-event-publisher')

/**
 * Redis-based file upload event publisher
 * Manages real-time event publishing for file upload progress and status updates
 */
export class FileUploadEventPublisher {
  private static instance: FileUploadEventPublisher
  private redisClient: any = null

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): FileUploadEventPublisher {
    if (!FileUploadEventPublisher.instance) {
      FileUploadEventPublisher.instance = new FileUploadEventPublisher()
    }
    return FileUploadEventPublisher.instance
  }

  /**
   * Get Redis client for publishing (not subscriber mode)
   */
  private async getClient(): Promise<any> {
    if (!this.redisClient) {
      const client = await getRedisClient(true)
      if (!client) {
        throw new Error('Redis client is required for file upload event publishing')
      }
      this.redisClient = client
    }
    return this.redisClient
  }

  /**
   * Publish a file upload event to Redis
   * Events are ephemeral - not stored in database
   */
  async publishEvent(event: FileUploadEvent): Promise<void> {
    try {
      // Validate event schema
      const validationResult = FileUploadEventSchemaValidator.validate(event)
      if (!validationResult.success) {
        logger.error('Invalid file upload event schema', {
          event: event.event,
          sessionId: event.sessionId,
          errors: validationResult.error.issues,
        })
        return // Don't throw - events are best-effort
      }

      const validatedEvent = validationResult.data

      // Get Redis client for publishing
      const redis = await this.getClient()

      // Publish to session-specific channel
      const channel = FileUploadChannels.session(validatedEvent.sessionId)
      const message = safeJsonStringify(validatedEvent)

      logger.info('Publishing file upload event', {
        event: validatedEvent.event,
        sessionId: validatedEvent.sessionId,
        organizationId: validatedEvent.organizationId,
        channel,
        messageSize: message.length,
      })

      const result = await redis.publish(channel, message)

      logger.debug('Published file upload event successfully', {
        event: validatedEvent.event,
        sessionId: validatedEvent.sessionId,
        channel,
        subscriberCount: result,
      })

      // Also publish to organization channel for monitoring
      if (validatedEvent.organizationId) {
        const orgChannel = FileUploadChannels.organization(validatedEvent.organizationId)
        await redis.publish(orgChannel, message)
      }
    } catch (error) {
      logger.error('Failed to publish file upload event', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        event: event?.event,
        sessionId: event?.sessionId,
      })
      // Don't throw - events are best-effort for real-time updates
    }
  }

  /**
   * Emit upload started event
   */
  async emitUploadStarted(
    sessionId: string,
    organizationId: string,
    data: {
      files: Array<{ id: string; name: string; size: number; type: string }>
      entityType: string
      entityId?: string
    }
  ): Promise<void> {
    await this.publishEvent({
      event: FileUploadEventType.UPLOAD_STARTED,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit upload progress event
   */
  async emitUploadProgress(
    sessionId: string,
    organizationId: string,
    progressData: UploadProgressData
  ): Promise<void> {
    await this.publishEvent({
      event: FileUploadEventType.UPLOAD_PROGRESS,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data: progressData,
    })
  }

  /**
   * Emit upload completed event
   */
  async emitUploadCompleted(
    sessionId: string,
    organizationId: string,
    data: {
      fileId: string
      filename: string
      url: string
      size: number
      checksum: string
    }
  ): Promise<void> {
    await this.publishEvent({
      event: FileUploadEventType.UPLOAD_COMPLETED,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit upload failed event
   */
  async emitUploadFailed(
    sessionId: string,
    organizationId: string,
    error: ErrorData
  ): Promise<void> {
    await this.publishEvent({
      event: FileUploadEventType.ERROR,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data: error,
    })
  }

  /**
   * Emit processing started event
   */
  async emitProcessingStarted(
    sessionId: string,
    organizationId: string,
    stage: string,
    data: {
      message?: string
      entityType: string
      entityId?: string
    }
  ): Promise<void> {
    await this.publishEvent({
      event: FileUploadEventType.PROCESSING_STARTED,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data: {
        stage,
        ...data,
      },
    })
  }

  /**
   * Emit processing progress event
   */
  async emitProcessingProgress(
    sessionId: string,
    organizationId: string,
    stage: string,
    progressData: Omit<ProcessingProgressData, 'stage'>
  ): Promise<void> {
    await this.publishEvent({
      event: FileUploadEventType.PROCESSING_PROGRESS,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data: {
        stage,
        ...progressData,
      },
    })
  }

  /**
   * Emit processing completed event
   */
  async emitProcessingCompleted(
    sessionId: string,
    organizationId: string,
    stage: string,
    data: {
      message?: string
      result?: any
      overallProgress: number
    }
  ): Promise<void> {
    await this.publishEvent({
      event: FileUploadEventType.PROCESSING_COMPLETED,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data: {
        stage,
        ...data,
      },
    })
  }

  /**
   * Emit job update event
   */
  async emitJobUpdate(
    sessionId: string,
    organizationId: string,
    jobData: JobUpdateData
  ): Promise<void> {
    const eventType = this.getJobEventType(jobData.status)

    await this.publishEvent({
      event: eventType,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data: jobData,
    })
  }

  /**
   * Emit error event
   */
  async emitError(sessionId: string, organizationId: string, errorData: ErrorData): Promise<void> {
    await this.publishEvent({
      event: FileUploadEventType.ERROR,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data: errorData,
    })
  }

  /**
   * Emit session connected event
   */
  async emitSessionConnected(
    sessionId: string,
    organizationId: string,
    data: {
      connectionId: string
      reconnected: boolean
    }
  ): Promise<void> {
    await this.publishEvent({
      event: FileUploadEventType.SESSION_CONNECTED,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit session created event
   */
  async emitSessionCreated(
    sessionId: string,
    organizationId: string,
    sessionData: Omit<SessionData, 'sessionId' | 'organizationId'>
  ): Promise<void> {
    await this.publishEvent({
      event: FileUploadEventType.SESSION_CONNECTED,
      sessionId,
      organizationId,
      timestamp: new Date().toISOString(),
      data: {
        connectionId: `conn_${Date.now()}`,
        reconnected: false,
      },
    })
  }

  /**
   * Get appropriate job event type based on status
   */
  private getJobEventType(status: JobUpdateData['status']): FileUploadEventType {
    switch (status) {
      case 'queued':
        return FileUploadEventType.JOB_QUEUED
      case 'started':
        return FileUploadEventType.JOB_STARTED
      case 'progress':
        return FileUploadEventType.JOB_PROGRESS
      case 'completed':
        return FileUploadEventType.JOB_COMPLETED
      case 'failed':
        return FileUploadEventType.JOB_FAILED
      default:
        return FileUploadEventType.JOB_PROGRESS
    }
  }

  /**
   * Batch publish multiple events
   * Useful for reducing Redis roundtrips when publishing many events
   */
  async publishEvents(events: FileUploadEvent[]): Promise<void> {
    if (events.length === 0) return

    try {
      const redis = await this.getClient()
      const pipeline = redis.pipeline()

      for (const event of events) {
        // Validate each event
        const validationResult = FileUploadEventSchemaValidator.validate(event)
        if (!validationResult.success) {
          logger.warn('Skipping invalid event in batch', {
            event: event.event,
            sessionId: event.sessionId,
            errors: validationResult.error.issues,
          })
          continue
        }

        const validatedEvent = validationResult.data
        const channel = FileUploadChannels.session(validatedEvent.sessionId)
        const message = safeJsonStringify(validatedEvent)

        pipeline.publish(channel, message)

        // Also add to org channel
        if (validatedEvent.organizationId) {
          const orgChannel = FileUploadChannels.organization(validatedEvent.organizationId)
          pipeline.publish(orgChannel, message)
        }
      }

      await pipeline.exec()

      const sessionIds = events.map((e) => e.sessionId)
      const uniqueSessionIds = Array.from(new Set(sessionIds))

      logger.info('Batch published file upload events', {
        eventCount: events.length,
        sessionIds: uniqueSessionIds,
      })
    } catch (error) {
      logger.error('Failed to batch publish file upload events', {
        error: error instanceof Error ? error.message : String(error),
        eventCount: events.length,
      })
    }
  }

  /**
   * Clean up Redis connection
   */
  async disconnect(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.quit()
        this.redisClient = null
        logger.info('File upload event publisher Redis client disconnected')
      } catch (error) {
        logger.error('Error disconnecting file upload event publisher Redis client', { error })
      }
    }
  }
}

// Export singleton instance
export const fileUploadEventPublisher = FileUploadEventPublisher.getInstance()
