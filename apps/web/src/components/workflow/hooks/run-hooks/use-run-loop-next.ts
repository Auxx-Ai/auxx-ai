// apps/web/src/components/workflow/hooks/run-hooks/use-run-loop-next.ts

import { useCallback } from 'react'
import type { ExecutionEvent } from '../../store/run-store'
import { useRunStore } from '../../store/run-store'

/**
 * Hook to handle loop-next events (iteration starting)
 */
export const useRunLoopNext = () => {
  const startLoopIteration = useRunStore((state) => state.startLoopIteration)

  const handleLoopNext = useCallback(
    (event: ExecutionEvent) => {
      console.log('[Run Event] LOOP_NEXT:', event.data.loopId, event.data)

      const { loopId, loopNodeId, iterationIndex, totalIterations, item, variables } = event.data

      // Start a new loop iteration in the store
      startLoopIteration(loopNodeId, iterationIndex, totalIterations, item, variables)
    },
    [startLoopIteration]
  )

  return { handleLoopNext }
}
