// apps/web/src/components/workflow/hooks/run-hooks/use-run-loop-started.ts

import { useCallback } from 'react'
import { useRunStore } from '../../store/run-store'
import type { ExecutionEvent } from '../../store/run-store'

/**
 * Hook to handle loop-started events
 */
export const useRunLoopStarted = () => {
  const initLoopIterations = useRunStore((state) => state.initLoopIterations)

  const handleLoopStarted = useCallback(
    (event: ExecutionEvent) => {
      console.log('[Run Event] LOOP_STARTED:', event.data.loopId, event.data)

      const { loopId, nodeId, iterationCount, items } = event.data

      // Initialize loop iteration tracking in the store
      initLoopIterations(loopId, iterationCount, items)
    },
    [initLoopIterations]
  )

  return { handleLoopStarted }
}
