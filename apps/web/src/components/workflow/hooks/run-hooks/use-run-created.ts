// apps/web/src/components/workflow/hooks/run-hooks/use-run-created.ts
import { useCallback } from 'react'
import { useRunStore } from '../../store/run-store'
import { useCanvasStore } from '../../store/canvas-store'
import type { ExecutionEvent } from '../../store/run-store'
import type { WorkflowRun } from '@auxx/database/types'
export const useRunCreated = () => {
  const updateActiveRun = useRunStore((state) => state.updateActiveRun)
  const setReadOnly = useCanvasStore((state) => state.setReadOnly)
  const handleRunCreated = useCallback(
    (event: ExecutionEvent) => {
      console.log('[Run Event] RUN_CREATED:', event.data)
      // The event.data contains the full WorkflowRun object from the API
      const workflowRun = event.data as WorkflowRun
      if (workflowRun && workflowRun.id) {
        // Set canvas to read-only for live workflow runs
        setReadOnly(true)
        // Set this as the active run in the store
        updateActiveRun(workflowRun)
        console.log('[Run Event] Set active run:', {
          id: workflowRun.id,
          status: workflowRun.status,
          workflowId: workflowRun.workflowId,
          totalSteps: workflowRun.totalSteps,
        })
      } else {
        console.warn('[Run Event] RUN_CREATED event missing workflow run data:', event.data)
      }
    },
    [updateActiveRun, setReadOnly]
  )
  return { handleRunCreated }
}
