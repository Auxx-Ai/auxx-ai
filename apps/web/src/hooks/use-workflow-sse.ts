// apps/web/src/hooks/use-workflow-sse.ts

import { useEffect, useRef, useState } from 'react'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('use-workflow-sse')

interface UseWorkflowSSEOptions {
  runId: string | null
  onEvent?: (event: string, data: any) => void
  enabled?: boolean
}

/**
 * Hook for connecting to workflow SSE events via Redis
 */
export function useWorkflowSSE({ runId, onEvent, enabled = true }: UseWorkflowSSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    if (!runId || !enabled) {
      return
    }

    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const eventSource = new EventSource(`/api/workflow/run/${runId}/events`)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      logger.info('SSE Connected', { runId })
      setIsConnected(true)
      setConnectionError(null)
    }

    eventSource.onerror = (error) => {
      logger.error('SSE Connection error', { runId, error })
      setIsConnected(false)
      setConnectionError('Connection error')
      // Browser handles reconnection automatically
    }

    // Generic message handler
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        onEvent?.('message', data)
      } catch (error) {
        logger.error('SSE Parse error:', { error, runId })
      }
    }

    // Register specific event handlers
    const events = [
      'connected',
      'workflow-started',
      'workflow-finished',
      'workflow-completed',
      'workflow-failed',
      'workflow-resumed',
      'workflow-stopped',
      'workflow-paused',
      'node-started',
      'node-finished',
      'loop-started',
      'loop-next',
      'loop-completed',
    ]

    events.forEach((eventType) => {
      eventSource.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data)
          onEvent?.(eventType, data)
        } catch (error) {
          logger.error(`Failed to parse ${eventType}:`, { error, runId })
        }
      })
    })

    return () => {
      eventSource.close()
      setIsConnected(false)
      setConnectionError(null)
    }
  }, [runId, enabled, onEvent])

  return {
    isConnected,
    connectionError,
    disconnect: () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        setIsConnected(false)
      }
    },
  }
}
