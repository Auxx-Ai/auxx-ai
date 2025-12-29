// packages/lib/src/workflow-engine/execution-reporter.ts

import { getPublishingClient } from '@auxx/redis'
import { createScopedLogger } from '@auxx/logger'
import { WorkflowEventType, type WorkflowEventGeneric } from './events/types'
import { safeJsonStringify } from './utils/serialization'

const logger = createScopedLogger('workflow-execution-reporter')

/**
 * Interface for reporting workflow execution events
 * Implementations can send events to different targets (Redis, logs, metrics, etc.)
 */
export interface WorkflowExecutionReporter {
  /**
   * Emit a workflow execution event
   * @param event The event type
   * @param data The event data (usually a DB model)
   */
  emit(event: WorkflowEventType, data: any): Promise<void>
}

/**
 * Redis-based implementation for SSE streaming
 */
export class RedisWorkflowExecutionReporter implements WorkflowExecutionReporter {
  constructor(
    private workflowRunId: string,
    private redisClient?: any // Optional, will get default if not provided
  ) {
    this.workflowRunId = workflowRunId
    this.redisClient = redisClient
  }

  async emit(event: WorkflowEventType, data: any): Promise<void> {
    try {
      const redis = this.redisClient || (await getPublishingClient())

      if (!redis) {
        throw new Error('Redis client is null or undefined')
      }

      const channel = `workflow:run:${this.workflowRunId}`

      const message: WorkflowEventGeneric = {
        event,
        workflowRunId: this.workflowRunId,
        timestamp: new Date().toISOString(),
        data,
      }

      await redis.publish(channel, safeJsonStringify(message))
    } catch (error) {
      // Log but don't throw - events are best effort
      logger.error(`Failed to emit ${event} event:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        event,
        workflowRunId: this.workflowRunId,
        channel: `workflow:run:${this.workflowRunId}`,
        hasRedisClient: !!this.redisClient,
      })
    }
  }
}

/**
 * Null implementation for when events aren't needed
 */
export class NullWorkflowExecutionReporter implements WorkflowExecutionReporter {
  async emit(event: WorkflowEventType, data: any): Promise<void> {
    // No-op
  }
}

/**
 * Logging implementation for debugging
 */
export class LoggingWorkflowExecutionReporter implements WorkflowExecutionReporter {
  constructor(private workflowRunId: string) {}

  async emit(event: WorkflowEventType, data: any): Promise<void> {
    logger.info(`Workflow Event: ${event}`, { workflowRunId: this.workflowRunId, data })
  }
}

/**
 * Composite reporter that delegates to multiple reporters
 */
export class CompositeWorkflowExecutionReporter implements WorkflowExecutionReporter {
  constructor(private reporters: WorkflowExecutionReporter[]) {}

  async emit(event: WorkflowEventType, data: any): Promise<void> {
    await Promise.all(this.reporters.map((r) => r.emit(event, data)))
  }
}
