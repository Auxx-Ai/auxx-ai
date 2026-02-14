// apps/web/src/components/workflow/hooks/run-hooks/use-run-workflow-finished.ts

import { WorkflowRunStatus } from '@auxx/database/enums'
import { useCallback } from 'react'
import { useCanvasStore } from '../../store/canvas-store'
import type { ExecutionEvent } from '../../store/run-store'
import { useRunStore } from '../../store/run-store'
export const useRunWorkflowFinished = () => {
  const setIsRunning = useRunStore((state) => state.setIsRunning)
  const updateActiveRun = useRunStore((state) => state.updateActiveRun)
  const setReadOnly = useCanvasStore((state) => state.setReadOnly)
  const handleWorkflowFinished = useCallback(
    (event: ExecutionEvent) => {
      console.log('[Run Event] WORKFLOW_FINISHED:', event.data)
      // Update run state
      setIsRunning(false)
      // Re-enable canvas editing when workflow finishes
      setReadOnly(false)
      // Update active run with finished data
      // finishedAt comes as a number (timestamp), convert to Date
      updateActiveRun({
        status:
          event.data.status === 'succeeded'
            ? WorkflowRunStatus.SUCCEEDED
            : WorkflowRunStatus.FAILED,
        outputs: event.data.outputs,
        elapsedTime: event.data.elapsedTime,
        totalTokens: event.data.totalTokens,
        totalSteps: event.data.totalSteps,
        finishedAt: new Date(event.data.finishedAt * 1000), // Convert timestamp to Date
        error: event.data.error,
      })
    },
    [setIsRunning, updateActiveRun, setReadOnly]
  )
  return { handleWorkflowFinished }
}
