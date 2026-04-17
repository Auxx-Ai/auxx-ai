// apps/web/src/components/threads/hooks/use-thread-selection.ts
'use client'

import { useCallback, useMemo } from 'react'
import {
  useActiveThreadId,
  useIsMultiSelectMode,
  useSelectedThreadIds,
  useSelectionAnchorId,
  useThreadSelectionStore,
} from '../store/thread-selection-store'

interface UseThreadSelectionOptions {
  /** Thread IDs in display order (required for range selection) */
  threadIds?: string[]
}

/**
 * Provides thread selection state and click handlers.
 * Does NOT fetch data - uses existing threadIds from props.
 */
export function useThreadSelection({ threadIds }: UseThreadSelectionOptions = {}) {
  // Granular subscriptions - only re-render when these specific values change
  const activeThreadId = useActiveThreadId()
  const selectionAnchorId = useSelectionAnchorId()
  const selectedThreadIds = useSelectedThreadIds()
  const isMultiSelectMode = useIsMultiSelectMode()

  // Get actions directly from store - actions are stable, no subscription needed
  const actions = useMemo(() => {
    const store = useThreadSelectionStore.getState()
    return {
      setActiveThread: store.setActiveThread,
      setSelectedThreads: store.setSelectedThreads,
      setSelectionAnchor: store.setSelectionAnchor,
      toggleSelection: store.toggleSelection,
      clearSelection: store.clearSelection,
      selectAll: store.selectAll,
      selectRange: store.selectRange,
      reset: store.reset,
    }
  }, [])

  /**
   * Handles click on a thread item with modifier key support.
   * - Normal click: Open this thread (leaves checkbox selection untouched).
   * - Cmd/Ctrl + click: Toggle this thread in the selection. Does not open.
   *   When starting a fresh multi-selection, the currently-open thread is
   *   automatically included so the user doesn't have to re-select it.
   * - Shift + click: Range-select from anchor to clicked. Does not open.
   */
  const handleThreadClick = useCallback(
    (threadId: string, event: React.MouseEvent) => {
      event.preventDefault()

      if (event.metaKey || event.ctrlKey) {
        const store = useThreadSelectionStore.getState()
        if (
          store.selectedThreadIds.length === 0 &&
          store.activeThreadId &&
          store.activeThreadId !== threadId
        ) {
          actions.setSelectedThreads([store.activeThreadId, threadId])
        } else {
          actions.toggleSelection(threadId)
        }
        actions.setSelectionAnchor(threadId)
      } else if (event.shiftKey && selectionAnchorId && threadIds) {
        actions.selectRange(selectionAnchorId, threadId, threadIds)
        actions.setSelectionAnchor(threadId)
      } else {
        // setActiveThread also updates the selection anchor internally.
        actions.setActiveThread(threadId)
      }
    },
    [selectionAnchorId, threadIds, actions]
  )

  const clearSelection = useCallback(() => {
    actions.clearSelection()
  }, [actions])

  const selectAll = useCallback(() => {
    if (threadIds && threadIds.length > 0) {
      actions.selectAll(threadIds)
    }
  }, [threadIds, actions])

  return {
    // State
    activeThreadId,
    selectedThreadIds,
    isMultiSelectMode,

    // Actions
    handleThreadClick,
    clearSelection,
    selectAll,
    setActiveThread: actions.setActiveThread,
    setSelectedThreads: actions.setSelectedThreads,
    reset: actions.reset,
  }
}
