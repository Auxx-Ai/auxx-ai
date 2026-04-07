// apps/web/src/hooks/use-sse.ts

import { safeJsonStringify } from '@auxx/lib/workflow-engine/client'
import { createScopedLogger } from '@auxx/logger'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = createScopedLogger('use-sse')

/**
 * Configuration for SSE connection
 */
export interface SSEConfig {
  /** The URL to connect to */
  url: string
  /** Specific event types to listen for (optional, listens to all if not specified) */
  events?: string[]
  /** Whether to automatically reconnect on connection loss */
  reconnect?: boolean
  /** Initial reconnection delay in ms */
  reconnectDelay?: number
  /** HTTP method for the request */
  method?: 'GET' | 'POST'
  /** Request body for POST requests */
  body?: any
  /** Additional headers */
  headers?: Record<string, string>
  /** Maximum number of reconnection attempts */
  maxReconnectAttempts?: number
}

/**
 * Connection status states
 */
export type SSEConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

/**
 * Hook return interface
 */
export interface SSEHookReturn {
  /** Current connection status */
  connectionStatus: SSEConnectionStatus
  /** Current error message if any */
  error: string | null
  /** Manually connect to the SSE endpoint */
  connect: () => void
  /** Disconnect from the SSE endpoint */
  disconnect: () => void
  /** Reconnect to the SSE endpoint */
  reconnect: () => void
  /** Current reconnection attempt count */
  reconnectAttempts: number
}

/**
 * Parse a single SSE message from the stream
 */
function parseSSEMessage(message: string): { eventType: string; data: any } | null {
  if (!message.trim() || message.includes(':heartbeat')) {
    return null
  }

  const lines = message.split('\n')
  let eventType = 'message'
  let eventData = ''

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      eventData = line.slice(6).trim()
    }
  }

  if (!eventData) {
    return null
  }

  try {
    const data = JSON.parse(eventData)
    return { eventType, data }
  } catch (error) {
    logger.error('Failed to parse SSE data:', { error, eventData })
    return null
  }
}

/**
 * Generic SSE hook that supports both EventSource and fetch-based streaming
 */
export function useSSE(
  config: SSEConfig | null,
  onEvent: (eventType: string, data: any) => void,
  onError?: (error: Error) => void
): SSEHookReturn {
  const [connectionStatus, setConnectionStatus] = useState<SSEConnectionStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)

  // Refs to maintain stable references
  const eventSourceRef = useRef<EventSource | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isConnectingRef = useRef(false)
  const reconnectAttemptsRef = useRef(0)

  // Stable event handler references
  const onEventRef = useRef(onEvent)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onEventRef.current = onEvent
    onErrorRef.current = onError
  }, [onEvent, onError])

  // Keep reconnectAttemptsRef in sync with state
  useEffect(() => {
    reconnectAttemptsRef.current = reconnectAttempts
  }, [reconnectAttempts])

  /**
   * Clean up any existing connections
   */
  const cleanup = useCallback(() => {
    // Clear reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    // Close EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    // Abort fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    isConnectingRef.current = false
  }, [])

  /**
   * Handle EventSource-based SSE (for GET requests)
   */
  const connectEventSource = useCallback((url: string, events?: string[]) => {
    logger.info('Connecting via EventSource', { url, events })

    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      logger.info('EventSource connected', { url })
      setConnectionStatus('connected')
      setError(null)
      setReconnectAttempts(0)
      isConnectingRef.current = false
    }

    eventSource.onerror = (event) => {
      logger.error('EventSource error', { url, readyState: eventSource.readyState })
      setConnectionStatus('error')

      const errorMsg = 'EventSource connection error'
      setError(errorMsg)
      onErrorRef.current?.(new Error(errorMsg))

      // EventSource handles reconnection automatically, but we track the status
      if (eventSource.readyState === EventSource.CLOSED) {
        setConnectionStatus('closed')
      }
    }

    // Handle generic messages
    eventSource.onmessage = (event) => {
      try {
        // Guard against undefined or empty data
        if (!event.data || event.data === 'undefined') {
          logger.warn('Received empty/undefined data for generic message')
          return
        }
        const data = JSON.parse(event.data)
        onEventRef.current('message', data)
      } catch (error) {
        logger.error('Failed to parse EventSource message:', { error, data: event.data })
      }
    }

    // Handle specific event types
    if (events && events.length > 0) {
      events.forEach((eventType) => {
        // Note: 'error' is a reserved event type for EventSource native errors
        // Native error events are Event objects (not MessageEvent) and don't have 'data'
        // We handle them in onerror above, so skip adding listener for 'error' here
        if (eventType === 'error') {
          logger.warn(
            'Skipping "error" event listener - use a different event name to avoid conflict with native EventSource errors'
          )
          return
        }

        eventSource.addEventListener(eventType, (event: MessageEvent) => {
          try {
            // Guard against undefined or empty data
            if (!event.data || event.data === 'undefined') {
              logger.warn(`Received empty/undefined data for ${eventType} event`)
              return
            }
            const data = JSON.parse(event.data)
            onEventRef.current(eventType, data)
          } catch (error) {
            logger.error(`Failed to parse ${eventType} event:`, { error, data: event.data })
          }
        })
      })
    }
  }, [])

  /**
   * Handle fetch-based SSE streaming (for POST requests)
   */
  const connectFetchStream = useCallback(
    async (url: string, method: string, body?: any, headers?: Record<string, string>) => {
      logger.info('Connecting via fetch stream', { url, method, body, headers })

      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body ? safeJsonStringify(body) : undefined,
          // signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        // if (!response.body) {
        //   throw new Error('Response body is null')
        // }

        logger.info('Fetch stream connected', { url, status: response.status })
        setConnectionStatus('connected')
        setError(null)
        setReconnectAttempts(0)
        isConnectingRef.current = false

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const messages = buffer.split('\n\n')
          buffer = messages.pop() || ''

          for (const message of messages) {
            const parsed = parseSSEMessage(message)
            if (parsed) {
              onEventRef.current(parsed.eventType, parsed.data)
            }
          }

          // Yield to the browser after each chunk so React can paint
          // streaming updates incrementally instead of batching everything.
          if (messages.length > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
        }

        // Stream ended normally
        setConnectionStatus('closed')
      } catch (error: any) {
        if (error.name === 'AbortError') {
          logger.info('Fetch stream aborted', { url })
          setConnectionStatus('closed')
        } else {
          logger.error('Fetch stream error', { url, error })
          setConnectionStatus('error')
          setError(error.message || 'Fetch stream error')
          onErrorRef.current?.(error)
        }
      } finally {
        isConnectingRef.current = false
        abortControllerRef.current = null
      }
    },
    []
  )

  /**
   * Connect to the SSE endpoint
   */
  const connect = useCallback(() => {
    if (!config || isConnectingRef.current) {
      return
    }

    // Clean up any existing connections
    cleanup()

    isConnectingRef.current = true
    setConnectionStatus('connecting')
    setError(null)

    logger.info('Initiating SSE connection', {
      url: config.url,
      method: config.method || 'GET',
      reconnectAttempts: reconnectAttemptsRef.current,
    })

    try {
      if (config.method === 'POST') {
        connectFetchStream(config.url, 'POST', config.body, config.headers)
      } else {
        connectEventSource(config.url, config.events)
      }
    } catch (error: any) {
      logger.error('Failed to initiate connection', { error })
      setConnectionStatus('error')
      setError(error.message || 'Connection failed')
      isConnectingRef.current = false
      onErrorRef.current?.(error)
    }
  }, [config, cleanup, connectEventSource, connectFetchStream])

  /**
   * Attempt to reconnect with exponential backoff
   */
  const scheduleReconnect = useCallback(
    (config: SSEConfig) => {
      const attempts = reconnectAttemptsRef.current
      if (!config.reconnect || attempts >= (config.maxReconnectAttempts || 10)) {
        logger.warn('Max reconnection attempts reached', {
          attempts,
          max: config.maxReconnectAttempts || 10,
        })
        setConnectionStatus('error')
        return
      }

      const delay = Math.min(
        (config.reconnectDelay || 1000) * 2 ** attempts,
        30000 // Max 30 seconds
      )

      logger.info('Scheduling reconnection', { attempt: attempts + 1, delay })

      reconnectTimeoutRef.current = setTimeout(() => {
        setReconnectAttempts((prev) => prev + 1)
        connect()
      }, delay)
    },
    [connect]
  )

  /**
   * Disconnect from the SSE endpoint
   */
  const disconnect = useCallback(() => {
    logger.info('Disconnecting SSE', { url: config?.url })
    cleanup()
    setConnectionStatus('closed')
    setError(null)
    setReconnectAttempts(0)
  }, [cleanup, config?.url])

  /**
   * Reconnect to the SSE endpoint
   */
  const reconnectManually = useCallback(() => {
    logger.info('Manual reconnection requested', { url: config?.url })
    setReconnectAttempts(0)
    connect()
  }, [connect, config?.url])

  // Auto-reconnect on error if enabled
  useEffect(() => {
    if (config?.reconnect && connectionStatus === 'error' && !isConnectingRef.current) {
      scheduleReconnect(config)
    }
  }, [config, connectionStatus, scheduleReconnect])

  // Stable connect ref to avoid useEffect re-triggering
  const connectRef = useRef(connect)
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  // Initial connection and cleanup
  const configUrl = config?.url
  const configMethod = config?.method
  const configBodyString = config?.body ? safeJsonStringify(config.body) : null
  const configReconnect = config?.reconnect

  useEffect(() => {
    if (config) {
      connectRef.current()
    }

    return cleanup
  }, [config, cleanup])

  return {
    connectionStatus,
    error,
    connect,
    disconnect,
    reconnect: reconnectManually,
    reconnectAttempts,
  }
}
