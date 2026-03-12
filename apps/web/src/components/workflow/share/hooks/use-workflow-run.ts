// apps/web/src/components/workflow/share/hooks/use-workflow-run.ts
'use client'

import { WorkflowEventType } from '@auxx/lib/workflow-engine/client'
import type { ContentSegment } from '@auxx/lib/workflow-engine/types/content-segment'
import { useCallback, useRef } from 'react'
import { useWorkflowShareStore } from '../workflow-share-provider'

/**
 * Workflow SSE event structure
 * Server sends events with 'event' property containing dash-case values
 */
interface WorkflowEvent {
  event: WorkflowEventType
  workflowRunId: string
  timestamp: string
  data?: {
    nodeId?: string
    nodeType?: string
    title?: string
    outputs?: Record<string, unknown>
    error?: string
    [key: string]: unknown
  }
}

/**
 * Hook for executing workflow runs with SSE streaming
 */
export function useWorkflowRun(shareToken: string) {
  const passport = useWorkflowShareStore((s) => s.passport)
  const isExecuting = useWorkflowShareStore((s) => s.isExecuting)
  const currentRun = useWorkflowShareStore((s) => s.currentRun)
  const setLoading = useWorkflowShareStore((s) => s.setLoading)
  const setCurrentRun = useWorkflowShareStore((s) => s.setCurrentRun)
  const updateRunStatus = useWorkflowShareStore((s) => s.updateRunStatus)
  const upsertEndNodeResult = useWorkflowShareStore((s) => s.upsertEndNodeResult)
  const setError = useWorkflowShareStore((s) => s.setError)

  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * Parse SSE event from text line
   */
  const parseSSEEvent = (line: string): WorkflowEvent | null => {
    if (!line.startsWith('data: ')) return null
    try {
      return JSON.parse(line.slice(6)) as WorkflowEvent
    } catch {
      return null
    }
  }

  /**
   * Process SSE stream from response
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: parseSSEEvent is a stable helper function
  const processStream = useCallback(
    async (response: Response) => {
      const reader = response.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const event = parseSSEEvent(line.trim())
            if (!event) continue

            switch (event.event) {
              case WorkflowEventType.WORKFLOW_STARTED:
                updateRunStatus('running')
                break

              case WorkflowEventType.NODE_STARTED:
                // Track end node starting
                if (event.data?.nodeType === 'end') {
                  upsertEndNodeResult({
                    nodeId: event.data.nodeId!,
                    title: event.data.title || 'Output',
                    status: 'running',
                  })
                }
                break

              case WorkflowEventType.NODE_COMPLETED:
                // Track end node completion with result
                if (event.data?.nodeType === 'end') {
                  upsertEndNodeResult({
                    nodeId: event.data.nodeId!,
                    title: event.data.title || 'Output',
                    status: 'completed',
                    message: event.data.outputs?.message as string | undefined,
                    contentSegments: event.data.outputs?.contentSegments as
                      | ContentSegment[]
                      | undefined,
                  })
                }
                break

              case WorkflowEventType.NODE_FAILED:
                // Track end node failure
                if (event.data?.nodeType === 'end') {
                  upsertEndNodeResult({
                    nodeId: event.data.nodeId!,
                    title: event.data.title || 'Output',
                    status: 'failed',
                    error: event.data.error,
                  })
                }
                break

              case WorkflowEventType.WORKFLOW_FINISHED:
                updateRunStatus('completed')
                break

              case WorkflowEventType.WORKFLOW_FAILED:
                updateRunStatus('failed', event.data?.error)
                break

              case WorkflowEventType.WORKFLOW_CANCELLED:
                updateRunStatus('cancelled')
                break
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    },
    [updateRunStatus, upsertEndNodeResult]
  )

  /**
   * Execute workflow run
   */
  const executeRun = useCallback(
    async (inputs: Record<string, unknown>) => {
      if (!passport) {
        setError('execution', 'No passport available')
        return
      }

      // Abort any existing run
      abortControllerRef.current?.abort()
      abortControllerRef.current = new AbortController()

      setLoading('executing', true)
      setError('execution', null)

      try {
        // Call Next.js API route (same origin, handles SSE)
        const response = await fetch(`/api/workflows/shared/${shareToken}/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${passport}`,
          },
          body: JSON.stringify({ inputs }),
          signal: abortControllerRef.current.signal,
        })

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Failed to start workflow' }))
          throw new Error(error.message || 'Failed to start workflow')
        }

        // Get run ID from header
        const runId = response.headers.get('X-Run-Id')
        if (runId) {
          setCurrentRun({
            id: runId,
            status: 'pending',
            endNodeResults: [],
          })
        }

        // Process SSE stream
        await processStream(response)
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          updateRunStatus('cancelled')
        } else {
          setError('execution', (err as Error).message)
          updateRunStatus('failed', (err as Error).message)
        }
      } finally {
        setLoading('executing', false)
        abortControllerRef.current = null
      }
    },
    [passport, shareToken, setLoading, setError, setCurrentRun, updateRunStatus, processStream]
  )

  /**
   * Cancel current run
   */
  const cancelRun = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  /**
   * Reset run state for new execution
   */
  const resetRun = useCallback(() => {
    setCurrentRun(null)
    setError('execution', null)
  }, [setCurrentRun, setError])

  return {
    isExecuting,
    currentRun,
    executeRun,
    cancelRun,
    resetRun,
  }
}
