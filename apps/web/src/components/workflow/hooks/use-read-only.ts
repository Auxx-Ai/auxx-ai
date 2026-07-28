// apps/web/src/components/workflow/hooks/use-read-only.ts

import { useMemo } from 'react'
import { useCanvasStore } from '~/components/workflow/store/canvas-store'
import { useRunStore } from '~/components/workflow/store/run-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'

/**
 * Centralized hook for read-only state across the workflow editor
 * This combines all sources of read-only state and provides a single source of truth
 *
 * Sources, in the order they were added:
 *  1. canvas-store `readOnly` — version preview
 *  2. `isViewerMode` — the public `WorkflowViewer` embed
 *  3. run state — history / live-run playback
 *  4. `instanceReadOnly` — per-workflow instance access: the member holds
 *     `view` on this workflow but not `edit` (plan 30 §4). `WorkflowEditor`
 *     resolves it and pushes it into the store; see the store field's doc for
 *     why it isn't read from `useAccess()` here.
 *
 * Because every canvas affordance already keys off this hook, (4) covers the
 * whole Edit tier — canvas, add-node triggers, node context menus, handles,
 * every `nodes/core/*` panel, and `useWorkflowSave` — with no per-call-site work.
 */
export function useReadOnly() {
  // Get read-only state from canvas store (used for version previews)
  const canvasReadOnly = useCanvasStore((state) => state.readOnly)

  // Get viewer mode (set when rendering in WorkflowViewer — disables all saves)
  const isViewerMode = useWorkflowStore((state) => state.isViewerMode)

  // Per-workflow instance access: `view` without `edit` (plan 30 §4)
  const instanceReadOnly = useWorkflowStore((state) => state.instanceReadOnly)

  // Get run state to determine if we're in a mode that should disable editing
  const runViewMode = useRunStore((state) => state.runViewMode)
  const isRunning = useRunStore((state) => state.isRunning)

  // Determine if we should be in read-only mode based on run state
  const runStateReadOnly =
    runViewMode === 'previous' || // Viewing history - no editing
    (runViewMode === 'live' && isRunning) // Live workflow execution - no editing
  // Note: single-node mode is excluded - should still allow editing/saving

  // Combine all read-only conditions
  const isReadOnly = canvasReadOnly || isViewerMode || instanceReadOnly || runStateReadOnly

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
