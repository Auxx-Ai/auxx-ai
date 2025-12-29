// apps/web/src/components/workflow/hooks/use-workflow-store-optimized.ts

import { useMemo } from 'react'
import { useSelectionStore } from '../store/selection-store'

export const useSelectionActions = () => {
  const selectNode = useSelectionStore((state) => state.selectNode)
  const selectEdge = useSelectionStore((state) => state.selectEdge)
  const deselectAll = useSelectionStore((state) => state.deselectAll)
  const toggleNodeSelection = useSelectionStore((state) => state.toggleNodeSelection)
  const toggleEdgeSelection = useSelectionStore((state) => state.toggleEdgeSelection)

  return useMemo(
    () => ({ selectNode, selectEdge, deselectAll, toggleNodeSelection, toggleEdgeSelection }),
    [selectNode, selectEdge, deselectAll, toggleNodeSelection, toggleEdgeSelection]
  )
}
