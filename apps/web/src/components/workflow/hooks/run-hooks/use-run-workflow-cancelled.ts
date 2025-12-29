// apps/web/src/components/workflow/hooks/run-hooks/use-run-workflow-cancelled.ts
import { useCallback } from 'react'
import { useRunStore } from '../../store/run-store'
import type { ExecutionEvent } from '../../store/run-store'
import { WorkflowRunStatus } from '@auxx/database/enums'
export const useRunWorkflowCancelled = () => {
  const setIsRunning = useRunStore((state) => state.setIsRunning)
  const updateActiveRun = useRunStore((state) => state.updateActiveRun)
  const activeRun = useRunStore((state) => state.activeRun)
  const handleWorkflowCancelled = useCallback(
    (event: ExecutionEvent) => {
      console.log('[Run Event] WORKFLOW_CANCELLED:', event.data)
      // Update run state
      setIsRunning(false)
      // Update active run with cancellation data if it exists
      if (activeRun) {
        updateActiveRun({
          status: WorkflowRunStatus.STOPPED,
          error: event.data.message || 'Workflow was cancelled',
          finishedAt: event.data.stoppedAt ? new Date(event.data.stoppedAt * 1000) : new Date(),
        })
      }
    },
    [setIsRunning, updateActiveRun, activeRun]
  )
  return { handleWorkflowCancelled }
}
