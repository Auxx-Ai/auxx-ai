// apps/web/src/components/workflow/hooks/run-hooks/use-run-workflow-failed.ts
import { useCallback } from 'react'
import { useRunStore } from '../../store/run-store'
import { useCanvasStore } from '../../store/canvas-store'
import type { ExecutionEvent } from '../../store/run-store'
import { toastError } from '@auxx/ui/components/toast'
import { WorkflowRunStatus } from '@auxx/database/enums'
export const useRunWorkflowFailed = () => {
  const setIsRunning = useRunStore((state) => state.setIsRunning)
  const setConnectionStatus = useRunStore((state) => state.setConnectionStatus)
  const updateActiveRun = useRunStore((state) => state.updateActiveRun)
  const addToHistory = useRunStore((state) => state.addToHistory)
  const activeRun = useRunStore((state) => state.activeRun)
  const setReadOnly = useCanvasStore((state) => state.setReadOnly)
  const handleWorkflowFailed = useCallback(
    (event: ExecutionEvent) => {
      // Validate event data structure
      if (!event || !event.data) {
        console.error('[Run Event] WORKFLOW_FAILED: Invalid event structure', event)
        return
      }
      console.error('[Run Event] WORKFLOW_FAILED:', {
        runId: event.workflowRunId,
        error: event.data.error,
        failedAt: event.data.failedAt,
        timestamp: event.timestamp,
        eventData: event.data,
      })
      // Update run state
      setIsRunning(false)
      setConnectionStatus('closed') // Indicate workflow is no longer running
      // Re-enable canvas editing when workflow fails
      setReadOnly(false)
      const errorMessage = event.data.error || 'Workflow failed'
      // Parse failedAt with better error handling
      let failedAt: Date
      try {
        failedAt = event.data.failedAt ? new Date(event.data.failedAt) : new Date()
        // Validate the parsed date
        if (isNaN(failedAt.getTime())) {
          console.warn(
            '[Run Event] Invalid failedAt date, using current time:',
            event.data.failedAt
          )
          failedAt = new Date()
        }
      } catch (error) {
        console.warn('[Run Event] Error parsing failedAt, using current time:', error)
        failedAt = new Date()
      }
      // Update active run with failure data
      updateActiveRun({
        status: WorkflowRunStatus.FAILED,
        error: errorMessage,
        finishedAt: failedAt,
      })
      // Add the failed run to history if we have an active run
      if (activeRun) {
        const updatedRun = {
          ...activeRun,
          status: WorkflowRunStatus.FAILED,
          error: errorMessage,
          finishedAt: failedAt,
        }
        addToHistory({
          ...updatedRun,
          _isBasicData: false, // Mark as complete data
        })
        // Show error notification to user
        toastError({
          title: 'Workflow Failed',
          description: errorMessage,
        })
      }
    },
    [setIsRunning, setConnectionStatus, updateActiveRun, addToHistory, activeRun, setReadOnly]
  )
  return { handleWorkflowFailed }
}
