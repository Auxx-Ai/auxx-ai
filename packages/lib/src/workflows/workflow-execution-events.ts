// packages/lib/src/workflows/workflow-execution-events.ts

import { safeJsonStringify } from '@auxx/lib/workflow-engine'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('workflow-execution-events')

export interface WorkflowEvent {
  event: string
  workflowRunId: string
  taskId?: string
  data: any
}

// Flexible response interface that works with both Next.js Response and custom SSE implementations
export interface SSEResponse {
  write: (data: string) => void
  // Optional properties for compatibility with Next.js Response
  body?: ReadableStream<Uint8Array> | null
  headers?: Headers
}

// Type guard to check if a response is a Next.js Response
function isNextResponse(response: any): response is Response {
  return response && typeof response === 'object' && 'body' in response && 'headers' in response
}

// Adapter to convert Next.js Response to SSEResponse
function adaptResponse(response: Response | SSEResponse): SSEResponse {
  if (isNextResponse(response)) {
    return {
      write: (data: string) => {
        const encoder = new TextEncoder()
        const writer = response.body?.getWriter()
        if (writer) {
          writer.write(encoder.encode(data))
        }
      },
      body: response.body,
      headers: response.headers,
    }
  }
  return response as SSEResponse
}

export class WorkflowExecutionEvents {
  private clients = new Map<string, SSEResponse>()
  private eventQueues = new Map<string, WorkflowEvent[]>()
  private connectionWaiters = new Map<string, { resolve: () => void; timeout: NodeJS.Timeout }>()
  private connectionStates = new Map<string, 'waiting' | 'connected' | 'disconnected'>()

  // Max events to queue per run
  private readonly MAX_QUEUE_SIZE = 1000
  // Max time to wait for client connection
  private readonly CONNECTION_TIMEOUT = 10000 // 10 seconds

  /**
   * Subscribe a client to receive events for a specific run
   */
  subscribe(runId: string, response: Response | SSEResponse) {
    const adaptedResponse = adaptResponse(response)
    logger.info('Client subscribed to workflow run events', {
      runId,
      timestamp: new Date().toISOString(),
      hadWaiter: this.connectionWaiters.has(runId),
      currentState: this.connectionStates.get(runId),
      allWaiters: Array.from(this.connectionWaiters.keys()),
    })

    this.clients.set(runId, adaptedResponse)
    this.connectionStates.set(runId, 'connected')

    // Resolve any waiting promises
    const waiter = this.connectionWaiters.get(runId)
    if (waiter) {
      clearTimeout(waiter.timeout)
      waiter.resolve()
      this.connectionWaiters.delete(runId)
    }

    // Send initial connection event
    this.sendEvent(runId, {
      event: 'connected',
      workflowRunId: runId,
      data: { runId: runId, timestamp: new Date().toISOString() },
    })

    // Send any queued events
    const queuedEvents = this.eventQueues.get(runId)
    if (queuedEvents && queuedEvents.length > 0) {
      logger.info('Sending queued events to client', { runId, count: queuedEvents.length })
      queuedEvents.forEach((event) => this.sendEvent(runId, event))
      this.eventQueues.delete(runId)
    }
  }

  /**
   * Unsubscribe a client
   */
  unsubscribe(runId: string) {
    this.clients.delete(runId)
    this.eventQueues.delete(runId)
    this.connectionStates.set(runId, 'disconnected')

    // Cancel any pending waiters
    const waiter = this.connectionWaiters.get(runId)
    if (waiter) {
      clearTimeout(waiter.timeout)
      this.connectionWaiters.delete(runId)
    }
  }

  /**
   * Pre-register a run that expects a connection
   */
  expectConnection(runId: string) {
    logger.info('Expecting client connection for run', {
      runId,
      timestamp: new Date().toISOString(),
    })
    // Only set to waiting if not already connected
    const currentState = this.connectionStates.get(runId)
    if (currentState !== 'connected') {
      this.connectionStates.set(runId, 'waiting')
    }
  }

  /**
   * Wait for a client to connect with timeout
   */
  async waitForConnection(runId: string): Promise<boolean> {
    const currentState = this.connectionStates.get(runId)
    logger.info('[DEBUG] waitForConnection called', {
      runId,
      currentState,
      hasClient: this.clients.has(runId),
      allStates: Object.fromEntries(this.connectionStates.entries()),
    })

    // If already connected, return immediately
    if (currentState === 'connected') {
      logger.info('Client already connected', { runId })
      return true
    }

    // If not already waiting and not connected, set the state to waiting
    if (currentState !== 'waiting' && currentState !== 'connected') {
      this.connectionStates.set(runId, 'waiting')
      logger.info('Set connection state to waiting', { runId, currentState })
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Timeout waiting for client connection', { runId })
        this.connectionWaiters.delete(runId)
        this.connectionStates.delete(runId)
        resolve(false)
      }, this.CONNECTION_TIMEOUT)

      this.connectionWaiters.set(runId, { resolve: () => resolve(true), timeout })
    })
  }

  /**
   * Send an event to a subscribed client
   */
  private sendEvent(runId: string, event: WorkflowEvent) {
    const response = this.clients.get(runId)
    if (!response) {
      // Queue the event if no client is connected
      const queue = this.eventQueues.get(runId) || []

      // Check queue size limit
      if (queue.length >= this.MAX_QUEUE_SIZE) {
        logger.warn('Event queue full, dropping oldest events', {
          runId,
          queueSize: queue.length,
          droppedCount: queue.length - this.MAX_QUEUE_SIZE + 1,
        })
        // Remove oldest events to make room
        queue.splice(0, queue.length - this.MAX_QUEUE_SIZE + 1)
      }

      logger.info('No client connected for run, queuing event', {
        runId,
        event: event.event,
        timestamp: new Date().toISOString(),
        queueSize: queue.length + 1,
        connectionState: this.connectionStates.get(runId) || 'unknown',
      })

      queue.push(event)
      this.eventQueues.set(runId, queue)
      return
    }

    try {
      const data = `data: ${safeJsonStringify(event)}\n\n`
      response.write(data)
      logger.debug('Sent event to client', {
        runId,
        event: event.event,
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      logger.error('Failed to send event', { error, runId, event: event.event })
      this.unsubscribe(runId)
    }
  }

  /**
   * Emit workflow started event
   */
  emitWorkflowStarted(runId: string, data: any) {
    this.sendEvent(runId, {
      event: 'workflow-started',
      workflowRunId: runId,
      taskId: `task_${runId}`,
      data,
    })
  }

  /**
   * Emit workflow finished event
   */
  emitWorkflowFinished(runId: string, data: any) {
    this.sendEvent(runId, {
      event: 'workflow-finished',
      workflowRunId: runId,
      taskId: `task_${runId}`,
      data,
    })
  }

  /**
   * Emit node started event
   */
  emitNodeStarted(runId: string, data: any) {
    this.sendEvent(runId, {
      event: 'node-started',
      workflowRunId: runId,
      taskId: `task_${runId}`,
      data,
    })
  }

  /**
   * Emit node finished event
   */
  emitNodeFinished(runId: string, data: any) {
    this.sendEvent(runId, {
      event: 'node-finished',
      workflowRunId: runId,
      taskId: `task_${runId}`,
      data,
    })
  }

  /**
   * Emit loop started event
   */
  emitLoopStarted(runId: string, data: any) {
    this.sendEvent(runId, {
      event: 'loop-started',
      workflowRunId: runId,
      taskId: `task_${runId}`,
      data,
    })
  }

  /**
   * Emit loop completed event
   */
  emitLoopCompleted(runId: string, data: any) {
    this.sendEvent(runId, {
      event: 'loop-completed',
      workflowRunId: runId,
      taskId: `task_${runId}`,
      data,
    })
  }

  emitWorkflowFailed(runId: string, data: any) {
    this.sendEvent(runId, {
      event: 'workflow-failed',
      workflowRunId: runId,
      taskId: `task_${runId}`,
      data,
    })
  }

  emitWorkflowResumed(runId: string, data: any) {
    this.sendEvent(runId, {
      event: 'workflow-resumed',
      workflowRunId: runId,
      taskId: `task_${runId}`,
      data,
    })
  }

  /**
   * Emit workflow stopped event (for cancellation)
   */
  emitWorkflowStopped(runId: string, data: any) {
    this.sendEvent(runId, {
      event: 'workflow-stopped',
      workflowRunId: runId,
      taskId: `task_${runId}`,
      data,
    })
  }

  /**
   * Public method to emit a custom event
   */
  async emit(runId: string, event: WorkflowEvent): Promise<void> {
    this.sendEvent(runId, event)
  }

  /**
   * Get all active client connections
   */
  getActiveClients(): number {
    return this.clients.size
  }

  /**
   * Clean up stale event queues
   */
  cleanupQueues(maxAgeMs: number = 5 * 60 * 1000) {
    // This would need timestamps on queued events to implement properly
    // For now, just clear empty queues
    for (const [runId, queue] of this.eventQueues.entries()) {
      if (queue.length === 0) {
        this.eventQueues.delete(runId)
      }
    }
  }
}

// Singleton instance management
let instance: WorkflowExecutionEvents | null = null

/**
 * Get the singleton instance of WorkflowExecutionEvents
 * This ensures we have a single event emitter across the application
 */
export function getWorkflowExecutionEvents(): WorkflowExecutionEvents {
  if (!instance) {
    instance = new WorkflowExecutionEvents()
  }
  return instance
}

// For backward compatibility - export a singleton instance
export const workflowExecutionEvents = getWorkflowExecutionEvents()

// Export the class for testing and custom implementations
export default WorkflowExecutionEvents
