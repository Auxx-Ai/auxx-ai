// apps/web/src/components/data-import/hooks/use-import-sse.ts

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExecutionProgress, PlanPreviewRow, SSEResolutionProgress } from '../types'

/** Planning progress from SSE */
interface PlanningProgress {
  phase: 'analyzing' | 'assigning'
  processed: number
  total: number
}

interface UseImportSSEOptions {
  jobId: string
  enabled: boolean
  /** Called when execution completes */
  onComplete?: (result: { created: number; updated: number }) => void
  /** Called on error */
  onError?: (error: string) => void
  /** Called when resolution completes (job status becomes 'waiting') */
  onResolutionComplete?: () => void
  /** Called on each resolution progress update */
  onResolutionProgress?: (progress: SSEResolutionProgress) => void
  /** Called on each planning row analyzed */
  onPlanningRow?: (row: PlanPreviewRow) => void
  /** Called on planning progress update */
  onPlanningProgress?: (progress: PlanningProgress) => void
  /** Called when planning completes */
  onPlanningComplete?: () => void
}

/**
 * Hook for SSE connection to import job events.
 * Handles both resolution and execution progress using named event listeners.
 */
export function useImportSSE({
  jobId,
  enabled,
  onComplete,
  onError,
  onResolutionComplete,
  onResolutionProgress,
  onPlanningRow,
  onPlanningProgress,
  onPlanningComplete,
}: UseImportSSEOptions) {
  const [progress, setProgress] = useState<ExecutionProgress>({
    phase: 'idle',
    currentStrategy: null,
    rowsProcessed: 0,
    totalRows: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    warnings: 0,
  })
  const [currentResolution, setCurrentResolution] = useState<SSEResolutionProgress | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const isCompleteRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the latest callbacks in a ref so the SSE connection does NOT depend on them.
  // The parent passes inline functions that change identity every render; depending on
  // them would tear down and reopen the EventSource on every render → reconnect storm.
  const callbacksRef = useRef({
    onComplete,
    onError,
    onResolutionComplete,
    onResolutionProgress,
    onPlanningRow,
    onPlanningProgress,
    onPlanningComplete,
  })
  callbacksRef.current = {
    onComplete,
    onError,
    onResolutionComplete,
    onResolutionProgress,
    onPlanningRow,
    onPlanningProgress,
    onPlanningComplete,
  }

  // Latest progress, readable inside event handlers without making them a dependency.
  const progressRef = useRef(progress)
  progressRef.current = progress

  const connect = useCallback(() => {
    if (!enabled || !jobId) return

    isCompleteRef.current = false

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const url = `/api/imports/${jobId}/events`
    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setIsConnected(true)
    }

    // --- Connected Event ---
    eventSource.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse(event.data)
        setProgress((prev) => ({
          ...prev,
          phase: data.status === 'executing' ? 'executing' : 'idle',
          totalRows: data.rowCount ?? prev.totalRows,
        }))
      } catch (e) {
        console.error('Failed to parse connected event:', e)
      }
    })

    // --- Resolution Progress Event ---
    eventSource.addEventListener('resolution:progress', (event) => {
      try {
        const data = JSON.parse(event.data)
        const resProgress: SSEResolutionProgress = {
          columnIndex: data.columnIndex,
          columnName: data.columnName,
          resolved: data.resolved,
          total: data.total,
          errorsFound: data.errorsFound,
        }
        setCurrentResolution(resProgress)
        setProgress((prev) => ({ ...prev, phase: 'resolving' }))
        callbacksRef.current.onResolutionProgress?.(resProgress)
      } catch (e) {
        console.error('Failed to parse resolution:progress event:', e)
      }
    })

    // --- Planning Row Event (real-time row data) ---
    eventSource.addEventListener('planning:row', (event) => {
      try {
        const data = JSON.parse(event.data)
        callbacksRef.current.onPlanningRow?.({
          rowIndex: data.rowIndex,
          strategy: data.strategy,
          existingRecordId: data.existingRecordId,
          fields: data.fields,
          errors: data.errors,
          warnings: data.warnings,
        })
      } catch (e) {
        console.error('Failed to parse planning:row event:', e)
      }
    })

    // --- Planning Progress Event (counts) ---
    eventSource.addEventListener('planning:progress', (event) => {
      try {
        const data = JSON.parse(event.data)
        setProgress((prev) => ({
          ...prev,
          phase: 'preparing',
          rowsProcessed: data.processed,
          totalRows: data.total,
        }))
        callbacksRef.current.onPlanningProgress?.({
          phase: data.phase,
          processed: data.processed,
          total: data.total,
        })
      } catch (e) {
        console.error('Failed to parse planning:progress event:', e)
      }
    })

    // --- Planning Complete Event ---
    eventSource.addEventListener('planning:complete', (event) => {
      try {
        JSON.parse(event.data) // Parse to validate, but we don't use it
        callbacksRef.current.onPlanningComplete?.()
      } catch (e) {
        console.error('Failed to parse planning:complete event:', e)
      }
    })

    // --- Job Status Event ---
    eventSource.addEventListener('job:status', (event) => {
      try {
        const data = JSON.parse(event.data)

        // Resolution complete - job is ready for planning
        if (data.status === 'waiting') {
          setProgress((prev) => ({ ...prev, phase: 'idle' }))
          callbacksRef.current.onResolutionComplete?.()
        }

        // Execution complete
        if (data.status === 'completed') {
          isCompleteRef.current = true
          setProgress((prev) => ({ ...prev, phase: 'complete' }))
          callbacksRef.current.onComplete?.({
            created: progressRef.current.created,
            updated: progressRef.current.updated,
          })
          eventSource.close()
        }

        // Execution failed
        if (data.status === 'failed') {
          isCompleteRef.current = true
          setProgress((prev) => ({ ...prev, phase: 'error' }))
          callbacksRef.current.onError?.(data.error ?? 'Import failed')
          eventSource.close()
        }
      } catch (e) {
        console.error('Failed to parse job:status event:', e)
      }
    })

    // --- Execution Progress Event ---
    eventSource.addEventListener('execution:progress', (event) => {
      try {
        const data = JSON.parse(event.data)
        setProgress((prev) => ({
          phase: 'executing',
          currentStrategy: data.strategy ?? null,
          rowsProcessed: data.processed ?? 0,
          totalRows: data.total ?? 0,
          created: data.succeeded ?? 0,
          updated: 0, // Worker doesn't distinguish yet
          skipped: 0,
          failed: data.failed ?? 0,
          warnings: prev.warnings,
        }))
      } catch (e) {
        console.error('Failed to parse execution:progress event:', e)
      }
    })

    // --- Execution Complete Event ---
    eventSource.addEventListener('execution:complete', (event) => {
      try {
        const data = JSON.parse(event.data)
        const stats = data.statistics ?? {}
        isCompleteRef.current = true
        setProgress({
          phase: 'complete',
          currentStrategy: null,
          rowsProcessed: (stats.created ?? 0) + (stats.updated ?? 0) + (stats.failed ?? 0),
          totalRows: (stats.created ?? 0) + (stats.updated ?? 0) + (stats.failed ?? 0),
          created: stats.created ?? 0,
          updated: stats.updated ?? 0,
          skipped: stats.skipped ?? 0,
          failed: stats.failed ?? 0,
          warnings: stats.warnings ?? 0,
        })
        callbacksRef.current.onComplete?.({
          created: stats.created ?? 0,
          updated: stats.updated ?? 0,
        })
        eventSource.close()
      } catch (e) {
        console.error('Failed to parse execution:complete event:', e)
      }
    })

    // --- Row Warning Event (row imported, but a value was dropped) ---
    eventSource.addEventListener('row:warning', (event) => {
      try {
        JSON.parse(event.data) // Validate payload; count is all the UI needs live
        setProgress((prev) => ({ ...prev, warnings: prev.warnings + 1 }))
      } catch (e) {
        console.error('Failed to parse row:warning event:', e)
      }
    })

    // --- Error Event (application error from worker) ---
    eventSource.addEventListener('error', (event) => {
      // Check if this is a MessageEvent (application error) vs connection error
      if (event instanceof MessageEvent && event.data) {
        try {
          const data = JSON.parse(event.data)
          isCompleteRef.current = true
          setProgress((prev) => ({ ...prev, phase: 'error' }))
          callbacksRef.current.onError?.(data.message ?? 'Unknown error')
          eventSource.close()
        } catch (e) {
          console.error('Failed to parse error event:', e)
        }
      }
    })

    // Handle connection errors (reconnection)
    eventSource.onerror = () => {
      setIsConnected(false)
      // Reconnect after 2 seconds unless complete
      if (!isCompleteRef.current) {
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = setTimeout(connect, 2000)
      }
    }
    // Depend only on jobId/enabled — callbacks and progress are read via refs so the
    // connection is established once and not torn down on every parent re-render.
  }, [enabled, jobId])

  useEffect(() => {
    connect()

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [connect])

  return {
    progress,
    currentResolution,
    isConnected,
  }
}
