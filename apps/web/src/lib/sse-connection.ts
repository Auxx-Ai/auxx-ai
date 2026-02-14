// apps/web/src/lib/sse-connection.ts

/**
 * Configuration for SSE connection
 */
export interface SSEConnectionConfig {
  /** The URL to connect to */
  url: string
  /** Specific event types to listen for */
  events?: string[]
  /** Whether to automatically reconnect on connection loss */
  reconnect?: boolean
  /** Initial reconnection delay in ms */
  reconnectDelay?: number
  /** Maximum number of reconnection attempts */
  maxReconnectAttempts?: number
  /** Callback when an event is received */
  onEvent: (eventType: string, data: any) => void
  /** Callback when an error occurs */
  onError?: (error: Error) => void
  /** Callback when connection status changes */
  onStatusChange?: (status: SSEConnectionStatus) => void
}

export type SSEConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

export interface SSEConnection {
  /** Start the connection */
  connect: () => void
  /** Close the connection */
  disconnect: () => void
  /** Get current connection status */
  getStatus: () => SSEConnectionStatus
}

/**
 * Creates a managed SSE connection with reconnection logic
 * Can be used outside of React (e.g., in Zustand stores)
 */
export function createSSEConnection(config: SSEConnectionConfig): SSEConnection {
  let eventSource: EventSource | null = null
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let status: SSEConnectionStatus = 'idle'
  let isConnecting = false

  const setStatus = (newStatus: SSEConnectionStatus) => {
    status = newStatus
    config.onStatusChange?.(newStatus)
  }

  const cleanup = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
    isConnecting = false
  }

  const scheduleReconnect = () => {
    const maxAttempts = config.maxReconnectAttempts ?? 5
    if (!config.reconnect || reconnectAttempts >= maxAttempts) {
      console.warn(
        `[SSE] Max reconnection attempts reached (${reconnectAttempts}/${maxAttempts}) for ${config.url}`
      )
      setStatus('error')
      return
    }

    const delay = Math.min(
      (config.reconnectDelay ?? 1000) * 2 ** reconnectAttempts,
      30000 // Max 30 seconds
    )

    console.info(`[SSE] Scheduling reconnection attempt ${reconnectAttempts + 1} in ${delay}ms`)

    reconnectTimeout = setTimeout(() => {
      reconnectAttempts++
      connect()
    }, delay)
  }

  const connect = () => {
    if (isConnecting) return

    cleanup()
    isConnecting = true
    setStatus('connecting')

    try {
      eventSource = new EventSource(config.url)

      eventSource.onopen = () => {
        console.info(`[SSE] Connected to ${config.url}`)
        setStatus('connected')
        reconnectAttempts = 0
        isConnecting = false
      }

      eventSource.onerror = () => {
        console.error(`[SSE] Error for ${config.url}, readyState: ${eventSource?.readyState}`)
        isConnecting = false

        const error = new Error('SSE connection error')
        config.onError?.(error)

        if (eventSource?.readyState === EventSource.CLOSED) {
          setStatus('closed')
          scheduleReconnect()
        } else {
          setStatus('error')
        }
      }

      // Handle generic messages
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          config.onEvent('message', data)
        } catch {
          console.error('[SSE] Failed to parse message:', event.data)
        }
      }

      // Handle specific event types
      if (config.events && config.events.length > 0) {
        config.events.forEach((eventType) => {
          eventSource!.addEventListener(eventType, (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data)
              config.onEvent(eventType, data)
            } catch {
              console.error(`[SSE] Failed to parse ${eventType} event:`, event.data)
            }
          })
        })
      }
    } catch (error: any) {
      console.error('[SSE] Failed to create EventSource:', error)
      setStatus('error')
      isConnecting = false
      config.onError?.(error)
    }
  }

  const disconnect = () => {
    cleanup()
    setStatus('closed')
    reconnectAttempts = 0
  }

  return {
    connect,
    disconnect,
    getStatus: () => status,
  }
}
