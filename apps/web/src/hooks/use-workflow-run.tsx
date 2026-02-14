// apps/web/src/hooks/use-workflow-run.ts

import { WorkflowEventType } from '@auxx/lib/workflow-engine/types'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { useStoreApi } from '@xyflow/react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRunEvents } from '~/components/workflow/hooks/run-hooks/use-run-events'
import { type ExecutionEvent, useRunStore } from '~/components/workflow/store/run-store'
import { type SSEConfig, useSSE } from '~/hooks/use-sse'

/**
 * Configuration for starting a workflow run
 */
interface WorkflowRunConfig {
  workflowId: string
  inputs: Record<string, any>
  mode?: 'test' | 'production'
}

/**
 * Hook return interface
 */
interface WorkflowRunHookReturn {
  /** Start a new workflow run */
  startRun: (config: WorkflowRunConfig) => void
  /** Stop the current workflow run */
  stopRun: () => void
  /** Stop the workflow run on the server and disconnect */
  stopWorkflow: (workflowAppId: string) => Promise<void>
  /** Current SSE connection status */
  connectionStatus: ReturnType<typeof useSSE>['connectionStatus']
  /** Current connection error */
  error: string | null
  /** Current reconnection attempts */
  reconnectAttempts: number
  /** Manually reconnect to the workflow run stream */
  reconnect: () => void
}

/**
 * Workflow event types that we listen for via SSE
 */
const WORKFLOW_EVENTS = [
  WorkflowEventType.RUN_CREATED,
  WorkflowEventType.WORKFLOW_STARTED,
  WorkflowEventType.WORKFLOW_FINISHED,
  WorkflowEventType.WORKFLOW_FAILED,
  WorkflowEventType.WORKFLOW_CANCELLED,
  WorkflowEventType.WORKFLOW_PAUSED,
  WorkflowEventType.NODE_STARTED,
  WorkflowEventType.NODE_COMPLETED,
  WorkflowEventType.NODE_FAILED,
  WorkflowEventType.ERROR,
] as const

/**
 * Hook for managing workflow run SSE connections and lifecycle
 *
 * This hook provides a clean interface for starting/stopping workflow runs
 * and automatically handles the SSE connection for real-time updates.
 * It integrates with the run store to manage workflow execution state.
 */
export function useWorkflowRun(): WorkflowRunHookReturn {
  // Get ReactFlow store for accessing nodes and edges
  const reactFlowStore = useStoreApi()

  // Get run store actions
  const {
    resetForNewRun,
    setConnectionStatus,
    setConnectionError,
    stopRun: storeStopRun,
  } = useRunStore()

  // Get event handlers from the run events hook
  const { eventHandlers } = useRunEvents()

  // SSE configuration state - will be null until startRun is called
  const [workflowRunParams, setWorkflowRunParams] = useState<{
    workflowId: string
    inputs: Record<string, any>
    mode: 'test' | 'production'
  } | null>(null)

  // Memoize SSE config to prevent unnecessary re-renders
  const sseConfig = useMemo((): SSEConfig | null => {
    if (!workflowRunParams) return null
    console.log('Creating SSE config for workflow run', workflowRunParams)
    return {
      url: `/api/workflows/${workflowRunParams.workflowId}/run`,
      method: 'POST',
      body: { inputs: workflowRunParams.inputs, mode: workflowRunParams.mode },
      headers: {},
      events: WORKFLOW_EVENTS,
      reconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 5,
    }
  }, [workflowRunParams])

  /**
   * Handle incoming workflow events from SSE
   */
  const handleWorkflowEvent = useCallback(
    (eventType: string, resp: any) => {
      console.info('Received workflow event', resp.data)

      // Convert to ExecutionEvent format
      const event: ExecutionEvent = {
        eventType: eventType as WorkflowEventType,
        timestamp: new Date(resp.timestamp),
        workflowRunId: resp.data.workflowRunId,
        data: resp.data,
      }

      // Get the appropriate handler and call it directly
      const handler = eventHandlers[event.eventType as WorkflowEventType]
      if (handler) {
        console.log(`[Workflow Run] Executing handler for event: ${event.eventType}`)
        handler(event)
      } else {
        console.warn(`[Workflow Run] No handler found for event: ${event.eventType}`)
      }
    },
    [eventHandlers]
  )

  // Create refs for functions that will be defined later
  const reconnectRef = useRef<(() => void) | null>(null)
  const stopRunRef = useRef<(() => void) | null>(null)

  /**
   * Handle SSE connection errors with user-friendly toast
   */
  const handleSSEError = useCallback(
    (error: Error) => {
      console.error('Workflow SSE error', { error: error.message })
      setConnectionError(error.message)

      // Show error toast with retry and cancel actions using new actions prop
      toastError({
        title: 'Workflow Error',
        description: 'Something went wrong with the workflow connection.',
        duration: Infinity,
        actions: [
          {
            label: 'Try Again',
            onClick: (dismiss) => {
              console.log('Manual reconnect requested from toast')
              reconnectRef.current?.()
              // Don't dismiss - keep toast open to show reconnection status
            },
            variant: 'outline',
            size: 'sm',
          },
          {
            label: 'Cancel Run',
            onClick: (dismiss) => {
              console.log('Stopping workflow from toast')
              stopRunRef.current?.()
              dismiss()
            },
            variant: 'destructive',
            size: 'sm',
          },
        ],
        onDismiss: () => {
          console.log('Toast dismissed - cancelling workflow run')
          stopRunRef.current?.()
        },
      })
    },
    [setConnectionError]
  )

  // Use the generic SSE hook
  const { connectionStatus, error, reconnectAttempts, disconnect, reconnect } = useSSE(
    sseConfig,
    handleWorkflowEvent,
    handleSSEError
  )

  // Sync connection status with run store
  useEffect(() => {
    console.log('Connection status changed:', connectionStatus)
    setConnectionStatus(connectionStatus)
  }, [connectionStatus, setConnectionStatus])

  // Sync connection error with run store
  useEffect(() => {
    if (error) {
      setConnectionError(error)
    }
  }, [error, setConnectionError])

  /**
   * Start a new workflow run and connect to its SSE stream
   */
  const startRun = useCallback(
    ({ workflowId, inputs, mode = 'test' }: WorkflowRunConfig) => {
      console.log('Starting workflow run', { workflowId, mode, inputs })

      // Get current graph from ReactFlow
      const { nodes, edges } = reactFlowStore.getState()

      // Reset run store for new execution with current graph
      resetForNewRun(nodes, edges)

      // Set parameters which will trigger SSE connection via useMemo
      setWorkflowRunParams({ workflowId, inputs, mode })
    },
    [resetForNewRun, reactFlowStore]
  )

  /**
   * Stop the current workflow run and disconnect SSE
   */
  const stopRun = useCallback(() => {
    console.log('Stopping workflow run')

    // Disconnect SSE first
    disconnect()
    setWorkflowRunParams(null)

    // Update run store
    storeStopRun()
  }, [disconnect, storeStopRun])

  // Update refs for use in error handler
  useEffect(() => {
    reconnectRef.current = reconnect
    stopRunRef.current = stopRun
  }, [reconnect, stopRun])

  /**
   * Stop the workflow run on the server and disconnect SSE
   */
  const stopWorkflow = useCallback(
    async (workflowAppId: string) => {
      const currentRun = useRunStore.getState().activeRun
      if (!currentRun?.id) {
        console.warn('No active run to stop')
        return
      }

      try {
        console.log('Stopping workflow run on server', { runId: currentRun.id, workflowAppId })

        const response = await fetch(`/api/workflows/${workflowAppId}/run?runId=${currentRun.id}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to stop workflow')
        }

        const result = await response.json()
        console.log('Workflow stopped successfully on server', result)

        // Disconnect SSE after successful server stop
        stopRun()
      } catch (error) {
        console.error('Failed to stop workflow on server:', error)
        throw error // Re-throw so caller can handle
      }
    },
    [stopRun]
  )

  /**
   * Manual reconnect wrapper
   */
  const manualReconnect = useCallback(() => {
    console.log('Manual reconnect requested')
    reconnect()
  }, [reconnect])

  return {
    startRun,
    stopRun,
    stopWorkflow,
    connectionStatus,
    error,
    reconnectAttempts,
    reconnect: manualReconnect,
  }
}
