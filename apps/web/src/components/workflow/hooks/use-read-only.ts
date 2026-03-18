// apps/web/src/components/workflow/hooks/use-read-only.ts

import { useMemo } from 'react'
import { useCanvasStore } from '~/components/workflow/store/canvas-store'
import { useRunStore } from '~/components/workflow/store/run-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'

/**
 * Centralized hook for read-only state across the workflow editor
 * This combines all sources of read-only state and provides a single source of truth
 */
export function useReadOnly() {
  // Get read-only state from canvas store (used for version previews)
  const canvasReadOnly = useCanvasStore((state) => state.readOnly)

  // Get viewer mode (set when rendering in WorkflowViewer — disables all saves)
  const isViewerMode = useWorkflowStore((state) => state.isViewerMode)

  // Get run state to determine if we're in a mode that should disable editing
  const runViewMode = useRunStore((state) => state.runViewMode)
  const isRunning = useRunStore((state) => state.isRunning)

  // Determine if we should be in read-only mode based on run state
  const runStateReadOnly =
    runViewMode === 'previous' || // Viewing history - no editing
    (runViewMode === 'live' && isRunning) // Live workflow execution - no editing
  // Note: single-node mode is excluded - should still allow editing/saving

  // Combine all read-only conditions
  const isReadOnly = canvasReadOnly || isViewerMode || runStateReadOnly

  // Memoize the return object to prevent unnecessary re-renders in consumers
  return useMemo(
    () => ({
      isReadOnly,
      canEdit: !isReadOnly,
      // Convenience methods for common read-only checks
      canCreateNodes: !isReadOnly,
      canEditNodes: !isReadOnly,
      canDeleteNodes: !isReadOnly,
      canConnectNodes: !isReadOnly,
      canDragNodes: !isReadOnly,
    }),
    [isReadOnly]
  )
}

/**
 * Hook specifically for node interactions - backwards compatibility
 * @deprecated Use useReadOnly() instead for new code
 */
export function useNodesReadOnly() {
  const { isReadOnly } = useReadOnly()

  return {
    getNodesReadOnly: () => isReadOnly,
    isReadOnly,
  }
}
