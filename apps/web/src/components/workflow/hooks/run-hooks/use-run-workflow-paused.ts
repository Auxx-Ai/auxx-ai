// apps/web/src/components/workflow/hooks/run-hooks/use-run-workflow-paused.ts

import { useCallback } from 'react'
import { useRunStore } from '../../store/run-store'
import type { ExecutionEvent } from '../../store/run-store'
import { toastSuccess } from '@auxx/ui/components/toast'
import { WorkflowRunStatus } from '@auxx/database/enums'

export const useRunWorkflowPaused = () => {
  const updateActiveRun = useRunStore((state) => state.updateActiveRun)
  const activeRun = useRunStore((state) => state.activeRun)

  const handleWorkflowPaused = useCallback(
    (event: ExecutionEvent) => {
      // Validate event data structure
      if (!event || !event.data) {
        console.error('[Run Event] WORKFLOW_PAUSED: Invalid event structure', event)
        return
      }

      // Parse pausedAt with better error handling
      let pausedAt: Date
      try {
        pausedAt = event.data.pausedAt ? new Date(event.data.pausedAt) : new Date()
        // Validate the parsed date
        if (isNaN(pausedAt.getTime())) {
          console.warn(
            '[Run Event] Invalid pausedAt date, using current time:',
            event.data.pausedAt
          )
          pausedAt = new Date()
        }
      } catch (error) {
        console.warn('[Run Event] Error parsing pausedAt, using current time:', error)
        pausedAt = new Date()
      }

      // Update active run with paused data
      // Note: Using WAITING status as PAUSED status doesn't exist in WorkflowRunStatus enum
      updateActiveRun({
        status: WorkflowRunStatus.WAITING,
        pausedAt: pausedAt,
      })

      // Show notification to user
      const reasonText =
        typeof event.data.reason === 'string'
          ? event.data.reason
          : event.data.reason?.type || 'Workflow paused'

      toastSuccess({
        title: 'Workflow Paused',
        description: reasonText,
      })
    },
    [updateActiveRun, activeRun]
  )

  return { handleWorkflowPaused }
}
