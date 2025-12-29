// apps/web/src/components/file-upload/utils/sse-connection.ts

import type {
  FileUploadEvent,
  ConnectionState,
  ConnectionStatus,
  SSEConfig,
  EventHandlers,
} from '@auxx/lib/files/types'

/**
 * SSE connection manager for file upload events
 * Handles connection lifecycle, reconnection logic, and event parsing
 */
export class SSEConnectionManager {
  private eventSource?: EventSource
  private sessionId: string
  private config: Required<SSEConfig>
  private connectionStatus: ConnectionStatus
  private handlers: EventHandlers = {}
  private reconnectTimeout?: NodeJS.Timeout
  private heartbeatInterval?: NodeJS.Timeout
  private listeners: Array<(event: FileUploadEvent) => void> = []

  constructor(sessionId: string, config: SSEConfig = {}) {
    this.sessionId = sessionId
    this.config = {
      autoConnect: true,
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      heartbeatInterval: 30000,
      timeout: 120000,
      ...config,
    }

    this.connectionStatus = {
      state: 'disconnected',
      reconnectAttempts: 0,
    }
  }

  /**
   * Connect to SSE endpoint
   */
  connect(): void {
    if (this.eventSource?.readyState === EventSource.OPEN) {
      return // Already connected
    }

    this.setConnectionState('connecting')

    try {
      const url = `/api/files/upload/${this.sessionId}/events`
      this.eventSource = new EventSource(url)

      this.eventSource.onopen = this.handleOpen.bind(this)
      this.eventSource.onmessage = this.handleMessage.bind(this)
      this.eventSource.onerror = this.handleError.bind(this)

      // Listen for specific named events
      this.eventSource.addEventListener('session-connected', this.handleMessage.bind(this))
      this.eventSource.addEventListener('upload-started', this.handleMessage.bind(this))
      this.eventSource.addEventListener('upload-progress', this.handleMessage.bind(this))
      this.eventSource.addEventListener('processing-progress', this.handleMessage.bind(this))
      this.eventSource.addEventListener('upload-completed', this.handleMessage.bind(this))
      this.eventSource.addEventListener('processing-completed', this.handleMessage.bind(this))
      this.eventSource.addEventListener('error', this.handleMessage.bind(this))

      // Set connection timeout
      setTimeout(() => {
        if (this.connectionStatus.state === 'connecting') {
          this.handleError('Connection timeout')
        }
      }, this.config.timeout)
    } catch (error) {
      this.handleError(error instanceof Error ? error.message : 'Connection failed')
    }
  }

  /**
   * Disconnect from SSE
   */
  disconnect(): void {
    this.clearReconnectTimeout()
    this.clearHeartbeat()

    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = undefined
    }

    this.setConnectionState('disconnected')
  }

  /**
   * Manually trigger reconnection
   */
  reconnect(): void {
    this.disconnect()
    this.connectionStatus.reconnectAttempts = 0
    this.connect()
  }

  /**
   * Add event listener
   */
  addEventListener(listener: (event: FileUploadEvent) => void): void {
    this.listeners.push(listener)
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: (event: FileUploadEvent) => void): void {
    const index = this.listeners.indexOf(listener)
    if (index > -1) {
      this.listeners.splice(index, 1)
    }
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: EventHandlers): void {
    this.handlers = handlers
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): ConnectionStatus {
    return { ...this.connectionStatus }
  }

  /**
   * Handle SSE connection open
   */
  private handleOpen(): void {
    this.setConnectionState('connected')
    this.connectionStatus.lastConnected = new Date()
    this.connectionStatus.reconnectAttempts = 0
    this.connectionStatus.error = undefined

    this.startHeartbeat()

    // Emit session connected event if this is a reconnection
    if (this.connectionStatus.reconnectAttempts > 0) {
      this.emitEvent({
        event: 'session-connected',
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        organizationId: '', // Will be populated by the actual event
        data: {
          connectionId: `reconnect_${Date.now()}`,
          reconnected: true,
        },
      } as any)
    }
  }

  /**
   * Handle SSE message
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data)

      // For named events, the event type is in event.type, but the data structure
      // should still contain the event type. If not, use the MessageEvent type.
      if (!data.event && event.type !== 'message') {
        data.event = event.type
      }

      // Validate event structure
      if (!this.isValidFileUploadEvent(data)) {
        return
      }

      this.emitEvent(data)
    } catch (error) {
      // Silent fail for parsing errors
    }
  }

  /**
   * Handle SSE error
   */
  private handleError(error?: string | Event): void {
    const errorMessage =
      typeof error === 'string'
        ? error
        : error instanceof ErrorEvent
          ? error.message
          : 'Unknown connection error'

    this.connectionStatus.error = errorMessage

    // If we're connected and get an error, try to reconnect
    if (this.connectionStatus.state === 'connected') {
      this.attemptReconnect()
    } else {
      this.setConnectionState('failed')
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.connectionStatus.reconnectAttempts >= this.config.reconnectAttempts) {
      this.setConnectionState('failed')
      return
    }

    this.setConnectionState('reconnecting')
    this.connectionStatus.reconnectAttempts++

    const delay =
      this.config.reconnectDelay * Math.pow(2, this.connectionStatus.reconnectAttempts - 1)

    this.reconnectTimeout = setTimeout(() => {
      this.connect()
    }, delay)
  }

  /**
   * Set connection state and notify handlers
   */
  private setConnectionState(state: ConnectionState): void {
    this.connectionStatus.state = state

    // Clear heartbeat if disconnected
    if (state === 'disconnected' || state === 'failed') {
      this.clearHeartbeat()
    }
  }

  /**
   * Start heartbeat to detect connection issues
   */
  private startHeartbeat(): void {
    this.clearHeartbeat()

    this.heartbeatInterval = setInterval(() => {
      if (this.eventSource?.readyState !== EventSource.OPEN) {
        this.handleError('Connection lost - heartbeat failed')
      }
    }, this.config.heartbeatInterval)
  }

  /**
   * Clear heartbeat interval
   */
  private clearHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }
  }

  /**
   * Clear reconnect timeout
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
  }

  /**
   * Emit event to all listeners and handlers
   */
  private emitEvent(event: FileUploadEvent): void {
    // Call specific handler
    switch (event.event) {
      case 'upload-progress':
        this.handlers.onUploadProgress?.(event as any)
        break
      case 'processing-progress':
        this.handlers.onProcessingProgress?.(event as any)
        break
      case 'upload-completed':
        this.handlers.onUploadCompleted?.(event as any)
        break
      case 'processing-completed':
        this.handlers.onProcessingCompleted?.(event as any)
        break
      case 'job-queued':
      case 'job-started':
      case 'job-progress':
      case 'job-completed':
      case 'job-failed':
        this.handlers.onJobUpdate?.(event as any)
        break
      case 'error':
        this.handlers.onError?.(event as any)
        break
      case 'session-connected':
        this.handlers.onSessionConnected?.(event as any)
        break
      case 'upload-started':
        // Handle upload-started events via onAnyEvent or specific handler if added
        break
    }

    // Call generic handler
    this.handlers.onAnyEvent?.(event)

    // Call all listeners
    this.listeners.forEach((listener) => {
      try {
        listener(event)
      } catch (error) {
        // Silent error handling
      }
    })
  }

  /**
   * Validate if data is a valid FileUploadEvent
   */
  private isValidFileUploadEvent(data: any): data is FileUploadEvent {
    const isValid =
      typeof data === 'object' &&
      typeof data.event === 'string' &&
      typeof data.sessionId === 'string' &&
      typeof data.timestamp === 'string' &&
      (typeof data.organizationId === 'string' || data.event === 'session-connected') && // organizationId is optional for session-connected
      (data.data !== undefined || data.event === 'session-connected') // data field is optional for session-connected

    return isValid
  }
}

/**
 * Create SSE connection manager
 */
export function createSSEConnection(sessionId: string, config?: SSEConfig): SSEConnectionManager {
  return new SSEConnectionManager(sessionId, config)
}
