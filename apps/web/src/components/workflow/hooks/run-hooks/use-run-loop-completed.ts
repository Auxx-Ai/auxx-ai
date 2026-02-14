// apps/web/src/components/workflow/hooks/run-hooks/use-run-loop-completed.ts

import { useCallback } from 'react'
import type { ExecutionEvent } from '../../store/run-store'
import { useRunStore } from '../../store/run-store'

/**
 * Hook to handle loop-completed events
 */
export const useRunLoopCompleted = () => {
  const completeLoopIterations = useRunStore((state) => state.completeLoopIterations)

  const handleLoopCompleted = useCallback(
    (event: ExecutionEvent) => {
      console.log('[Run Event] LOOP_COMPLETED:', event.data.loopId, event.data)

      const { loopId, nodeId, totalIterations, outputs } = event.data

      // Mark loop iterations as completed in the store
      completeLoopIterations(loopId, totalIterations, outputs)
    },
    [completeLoopIterations]
  )

  return { handleLoopCompleted }
}
