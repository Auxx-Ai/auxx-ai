// packages/lib/src/workflow-engine/events/redis-event-publisher.ts

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import type { NodeRunningStatus } from '../types'
import { safeJsonStringify } from '../utils/serialization'
import { type WorkflowEvent, WorkflowEventType } from './types'

const logger = createScopedLogger('workflow-event-publisher')

/**
 * Redis-based workflow event publisher
 * Replaces the in-memory WorkflowExecutionEvents system with scalable Redis pub/sub
 */
export class WorkflowEventPublisher {
  private static instance: WorkflowEventPublisher
  private redisClient: any = null

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): WorkflowEventPublisher {
    if (!WorkflowEventPublisher.instance) {
      WorkflowEventPublisher.instance = new WorkflowEventPublisher()
    }
    return WorkflowEventPublisher.instance
  }

  /**
   * Get Redis client for publishing (not subscriber mode)
   */
  private async getClient(): Promise<any> {
    if (!this.redisClient) {
      // Get a regular Redis client (not subscriber) for publishing
      const client = await getRedisClient(true)
      if (!client) {
        throw new Error('Redis client is required for event publishing')
      }
      this.redisClient = client
    }
    return this.redisClient
  }

  /**
   * Publish a workflow event to Redis
   * Events are ephemeral - not stored in database
   */
  async publishEvent(event: WorkflowEvent): Promise<void> {
    try {
      // Type safety is enforced at compile-time by method signatures
      // Runtime validation skipped for performance

      // Get Redis client for publishing
      const redis = await this.getClient()

      // Publish to run-specific channel
      const channel = `workflow:run:${event.workflowRunId}`
      const message = safeJsonStringify(event)

      logger.info('Publishing workflow event', {
        event: event.event,
        runId: event.workflowRunId,
        channel,
        messageSize: message.length,
      })

      const result = await redis.publish(channel, message)

      logger.debug('Published workflow event successfully', {
        event: event.event,
        runId: event.workflowRunId,
        channel,
        subscriberCount: result,
      })
    } catch (error) {
      logger.error('Failed to publish workflow event', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        event: event?.event,
        runId: event?.workflowRunId,
      })
      // Don't throw - events are best-effort for real-time updates
    }
  }

  /**
   * Emit workflow started event
   */
  async emitWorkflowStarted(
    runId: string,
    data: { id: string; workflowId: string; inputs?: Record<string, any>; createdAt: number }
  ): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.WORKFLOW_STARTED,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit workflow finished event
   */
  async emitWorkflowFinished(
    runId: string,
    data: {
      id: string
      workflowId: string
      status: 'succeeded' | 'failed'
      outputs?: Record<string, any>
      error?: string
      elapsedTime: number
      totalTokens: number
      totalSteps: number
      createdAt: number
      finishedAt: number
    }
  ): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.WORKFLOW_FINISHED,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit node started event
   */
  async emitNodeStarted(
    runId: string,
    data: {
      id: string
      nodeId: string
      nodeType: string
      title: string
      index: number
      predecessorNodeId?: string | null
      inputs?: Record<string, any>
      createdAt: number
    }
  ): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.NODE_STARTED,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit node finished event
   */
  async emitNodeFinished(
    runId: string,
    data: {
      id: string
      nodeId: string
      nodeType: string
      title: string
      index: number
      predecessorNodeId?: string | null
      inputs?: Record<string, any>
      outputs?: Record<string, any>
      status: NodeRunningStatus
      error?: string | null
      elapsedTime?: number
      createdAt: number
      finishedAt: number
    }
  ): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.NODE_FINISHED,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit loop started event
   */
  async emitLoopStarted(
    runId: string,
    data: { loopId: string; nodeId: string; iterationCount: number; items?: any[] }
  ): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.LOOP_STARTED,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit loop-next event (iteration starting)
   */
  async emitLoopNext(
    runId: string,
    data: {
      loopId: string
      loopNodeId: string
      iterationIndex: number
      totalIterations: number
      item?: any
      variables?: Record<string, any>
    }
  ): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.LOOP_NEXT,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit loop completed event
   */
  async emitLoopCompleted(
    runId: string,
    data: {
      loopId: string
      nodeId: string
      totalIterations: number
      outputs?: Record<string, any>
    }
  ): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.LOOP_COMPLETED,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit workflow failed event
   */
  async emitWorkflowFailed(runId: string, data: { failedAt: Date; error: string }): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.WORKFLOW_FAILED,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit workflow resumed event
   */
  async emitWorkflowResumed(
    runId: string,
    data: { fromNodeId: string; resumedAt: Date; nodeOutput?: any }
  ): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.WORKFLOW_RESUMED,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit workflow stopped event
   */
  async emitWorkflowStopped(
    runId: string,
    data: { status: 'stopped'; stoppedBy: string; stoppedAt: number; message: string }
  ): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.WORKFLOW_STOPPED,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Emit workflow paused event
   */
  async emitWorkflowPaused(
    runId: string,
    data: {
      nodeId: string
      reason: { type: string; message?: string; metadata?: Record<string, any> }
      pausedAt: Date
    }
  ): Promise<void> {
    await this.publishEvent({
      event: WorkflowEventType.WORKFLOW_PAUSED,
      workflowRunId: runId,
      taskId: `task_${runId}`,
      timestamp: new Date().toISOString(),
      data,
    })
  }

  /**
   * Clean up Redis connection
   */
  async disconnect(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.quit()
        this.redisClient = null
        logger.info('Redis client disconnected')
      } catch (error) {
        logger.error('Error disconnecting Redis client', { error })
      }
    }
  }
}

// Export singleton instance
export const workflowEventPublisher = WorkflowEventPublisher.getInstance()
