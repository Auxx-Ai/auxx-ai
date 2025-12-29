// packages/lib/src/services/message-processing-service.ts
import { RealTimeService } from '../realtime/realtime-service'
import { database as db, schema } from '@auxx/database'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { JobStatus as JobStatusEnum } from '@auxx/database/enums'
import type { JobStatus } from '@auxx/database/types'
// Conditional logger import for server-side only
let logger: any = { info: console.log, error: console.error, debug: console.debug }
if (typeof window === 'undefined') {
  try {
    const { createScopedLogger } = require('../logger')
    logger = createScopedLogger('service:message-processing')
  } catch {
    // Fallback to console logging
  }
}
/**
 * Service for managing EmailProcessingJob lifecycle with real-time events
 */
export class MessageProcessingService {
  private realTimeService: RealTimeService
  constructor() {
    this.realTimeService = new RealTimeService()
  }
  /**
   * Create or update a processing job in the database
   */
  async createOrUpdateProcessingJob(
    messageId: string,
    organizationId: string,
    status: JobStatus,
    metadata?: {
      isSpam?: boolean
      matchedRuleCount?: number
      executedActionCount?: number
      error?: string
      attempts?: number
    }
  ) {
    try {
      // Get the message to find the threadId
      const [message] = await db
        .select({ threadId: schema.Message.threadId })
        .from(schema.Message)
        .where(eq(schema.Message.id, messageId))
        .limit(1)
      if (!message) {
        throw new Error(`Message not found: ${messageId}`)
      }

      const jobData = {
        messageId,
        threadId: message.threadId, // Add threadId for UI association
        organizationId,
        status,
        attempts: metadata?.attempts ?? 0,
        lastAttempt: new Date(),
        updatedAt: new Date(),
        isSpam: metadata?.isSpam,
        matchedRuleCount: metadata?.matchedRuleCount ?? 0,
        executedActionCount: metadata?.executedActionCount ?? 0,
        error: metadata?.error,
        completedAt: [
          JobStatusEnum.COMPLETED_SUCCESS,
          JobStatusEnum.COMPLETED_FAILURE,
          JobStatusEnum.COMPLETED_PARTIAL,
          JobStatusEnum.FAILED,
        ].includes(status)
          ? new Date()
          : null,
      }
      // Upsert the processing job using compound unique key
      const [job] = await db
        .insert(schema.EmailProcessingJob)
        .values({ ...jobData, createdAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.EmailProcessingJob.organizationId, schema.EmailProcessingJob.messageId],
          set: { ...jobData },
        })
        .returning({
          id: schema.EmailProcessingJob.id,
          isSpam: schema.EmailProcessingJob.isSpam,
          matchedRuleCount: schema.EmailProcessingJob.matchedRuleCount,
          executedActionCount: schema.EmailProcessingJob.executedActionCount,
          error: schema.EmailProcessingJob.error,
          completedAt: schema.EmailProcessingJob.completedAt,
        })

      logger.info('Processing job updated', {
        jobId: job!.id,
        messageId,
        status,
        threadId: message.threadId,
      })

      // Emit real-time event
      await this.emitProcessingStatusEvent({
        messageId,
        threadId: message.threadId,
        organizationId,
        status,
        jobId: job!.id,
        metadata: {
          isSpam: job!.isSpam ?? undefined,
          matchedRuleCount: job!.matchedRuleCount,
          executedActionCount: job!.executedActionCount,
          error: job!.error ?? undefined,
          completedAt: job!.completedAt?.toISOString(),
        },
      })
      return job
    } catch (error) {
      logger.error('Failed to create/update processing job', {
        messageId,
        organizationId,
        status,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
  /**
   * Update job status with real-time events
   */
  async updateJobStatus(
    messageId: string,
    status: JobStatus,
    metadata?: {
      isSpam?: boolean
      matchedRuleCount?: number
      executedActionCount?: number
      error?: string
      attempts?: number
    }
  ) {
    try {
      // First find the job to get the organizationId if not provided
      const [job] = await db
        .select({
          id: schema.EmailProcessingJob.id,
          organizationId: schema.EmailProcessingJob.organizationId,
        })
        .from(schema.EmailProcessingJob)
        .where(eq(schema.EmailProcessingJob.messageId, messageId))
        .limit(1)
      if (!job) {
        throw new Error(`Processing job not found for message: ${messageId}`)
      }
      const [msg] = await db
        .select({ threadId: schema.Message.threadId })
        .from(schema.Message)
        .where(eq(schema.Message.id, messageId))
        .limit(1)

      const completedAt = [
        JobStatusEnum.COMPLETED_SUCCESS,
        JobStatusEnum.COMPLETED_FAILURE,
        JobStatusEnum.COMPLETED_PARTIAL,
        JobStatusEnum.FAILED,
      ].includes(status)
        ? new Date()
        : null

      const [updatedJob] = await db
        .update(schema.EmailProcessingJob)
        .set({
          status,
          threadId: msg?.threadId || null,
          attempts: metadata?.attempts ?? undefined,
          lastAttempt: new Date(),
          updatedAt: new Date(),
          isSpam: metadata?.isSpam ?? undefined,
          matchedRuleCount: metadata?.matchedRuleCount ?? undefined,
          executedActionCount: metadata?.executedActionCount ?? undefined,
          error: metadata?.error ?? undefined,
          completedAt: completedAt ?? undefined,
        })
        .where(
          and(
            eq(schema.EmailProcessingJob.organizationId, job.organizationId),
            eq(schema.EmailProcessingJob.messageId, messageId)
          )
        )
        .returning({
          id: schema.EmailProcessingJob.id,
          isSpam: schema.EmailProcessingJob.isSpam,
          matchedRuleCount: schema.EmailProcessingJob.matchedRuleCount,
          executedActionCount: schema.EmailProcessingJob.executedActionCount,
          error: schema.EmailProcessingJob.error,
          completedAt: schema.EmailProcessingJob.completedAt,
        })
      logger.info('Processing job status updated', {
        jobId: updatedJob!.id,
        messageId,
        status,
        threadId: msg?.threadId,
      })

      // Emit real-time event
      await this.emitProcessingStatusEvent({
        messageId,
        threadId: msg?.threadId!,
        organizationId: job.organizationId,
        status,
        jobId: updatedJob!.id,
        metadata: {
          isSpam: updatedJob!.isSpam ?? undefined,
          matchedRuleCount: updatedJob!.matchedRuleCount,
          executedActionCount: updatedJob!.executedActionCount,
          error: updatedJob!.error ?? undefined,
          completedAt: updatedJob!.completedAt?.toISOString(),
        },
      })
      return updatedJob
    } catch (error) {
      logger.error('Failed to update job status', {
        messageId,
        status,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
  /**
   * Get current processing status for a message
   */
  async getProcessingStatus(messageId: string) {
    try {
      const [job] = await db
        .select()
        .from(schema.EmailProcessingJob)
        .where(eq(schema.EmailProcessingJob.messageId, messageId))
        .limit(1)
      return job
    } catch (error) {
      logger.error('Failed to get processing status', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
  /**
   * Get processing status for latest message in thread
   */
  async getThreadProcessingStatus(threadId: string) {
    try {
      // Get the latest message in the thread
      const [latestMessage] = await db
        .select({
          id: schema.Message.id,
          subject: schema.Message.subject,
          sentAt: schema.Message.sentAt,
        })
        .from(schema.Message)
        .where(eq(schema.Message.threadId, threadId))
        .orderBy(desc(schema.Message.sentAt))
        .limit(1)

      if (!latestMessage) {
        return { threadId, latestMessageJob: null, hasActiveProcessing: false }
      }

      // Get processing job for the latest message
      const [job] = await db
        .select()
        .from(schema.EmailProcessingJob)
        .where(eq(schema.EmailProcessingJob.messageId, latestMessage.id))
        .limit(1)

      return {
        threadId,
        latestMessageId: latestMessage.id,
        latestMessageJob: job
          ? {
              ...job,
              message: latestMessage,
            }
          : null,
        hasActiveProcessing: job
          ? [JobStatusEnum.PENDING, JobStatusEnum.PROCESSING].includes(job.status)
          : false,
      }
    } catch (error) {
      logger.error('Failed to get thread processing status', {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      })
      return { threadId, latestMessageJob: null, hasActiveProcessing: false }
    }
  }
  /**
   * Emit real-time processing status event - emits both message and thread events
   */
  private async emitProcessingStatusEvent(eventData: {
    messageId: string
    threadId: string
    organizationId: string
    status: JobStatus
    jobId: string
    metadata?: {
      isSpam?: boolean
      matchedRuleCount?: number
      executedActionCount?: number
      error?: string
      completedAt?: string
    }
  }) {
    try {
      if (!this.realTimeService.isPusherInitialized()) {
        logger.debug('Pusher not initialized, skipping real-time event')
        return
      }
      const baseEvent = {
        ...eventData,
        timestamp: new Date().toISOString(),
      }
      console.log('Emitting message processing status event:', baseEvent)
      // Emit message-level event (existing)
      const messageSuccess = await this.realTimeService.sendToOrganization(
        eventData.organizationId,
        'message:processing:status_changed',
        baseEvent
      )
      console.log('Message-level event sent:', messageSuccess)
      // Also emit thread-level event for UI components that track by thread
      const threadSuccess = await this.realTimeService.sendToOrganization(
        eventData.organizationId,
        'thread:processing:status_changed',
        baseEvent
      )
      console.log('Thread-level event sent:', threadSuccess)
      if (messageSuccess || threadSuccess) {
        logger.debug('Thread-aware processing events sent', {
          threadId: eventData.threadId,
          messageId: eventData.messageId,
          status: eventData.status,
        })
      }
    } catch (error) {
      logger.error('Failed to emit thread-aware processing events', {
        messageId: eventData.messageId,
        threadId: eventData.threadId,
        status: eventData.status,
        error: error instanceof Error ? error.message : String(error),
      })
      // Don't throw error - real-time events are not critical
    }
  }
  /**
   * Emit progress event for long-running processing
   */
  async emitProgressEvent(
    messageId: string,
    organizationId: string,
    progress: number,
    stage: string
  ) {
    try {
      if (!this.realTimeService.isPusherInitialized()) {
        return
      }
      // Get threadId
      const [message] = await db
        .select({ threadId: schema.Message.threadId })
        .from(schema.Message)
        .where(eq(schema.Message.id, messageId))
        .limit(1)
      if (!message) return
      const [job] = await db
        .select({ id: schema.EmailProcessingJob.id })
        .from(schema.EmailProcessingJob)
        .where(eq(schema.EmailProcessingJob.messageId, messageId))
        .limit(1)
      if (!job) return
      await this.realTimeService.sendToOrganization(organizationId, 'message:processing:progress', {
        messageId,
        threadId: message.threadId,
        organizationId,
        jobId: job.id,
        progress,
        stage,
      })
      logger.debug('Real-time processing progress event sent', {
        messageId,
        progress,
        stage,
      })
    } catch (error) {
      logger.error('Failed to emit processing progress event', {
        messageId,
        progress,
        stage,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
// Singleton instance
let messageProcessingService: MessageProcessingService | null = null
/**
 * Get or create the message processing service instance
 */
export function getMessageProcessingService(): MessageProcessingService {
  if (!messageProcessingService) {
    messageProcessingService = new MessageProcessingService()
  }
  return messageProcessingService
}
