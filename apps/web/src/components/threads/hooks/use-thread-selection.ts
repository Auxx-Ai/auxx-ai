// apps/web/src/components/threads/hooks/use-thread-selection.ts
'use client'

import { useCallback, useMemo } from 'react'
import {
  useActiveThreadId,
  useIsMultiSelectMode,
  useSelectedThreadIds,
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
  const selectedThreadIds = useSelectedThreadIds()
  const isMultiSelectMode = useIsMultiSelectMode()

  // Get actions directly from store - actions are stable, no subscription needed
  const actions = useMemo(() => {
    const store = useThreadSelectionStore.getState()
    return {
      setActiveThread: store.setActiveThread,
      setSelectedThreads: store.setSelectedThreads,
      toggleSelection: store.toggleSelection,
      clearSelection: store.clearSelection,
      selectAll: store.selectAll,
      selectRange: store.selectRange,
      reset: store.reset,
    }
  }, [])

  /**
   * Handles click on a thread item with modifier key support.
   * - Normal click: Select only this thread
   * - Cmd/Ctrl + click: Toggle this thread in selection
   * - Shift + click: Range select from active to clicked
   */
  const handleThreadClick = useCallback(
    (threadId: string, event: React.MouseEvent) => {
      event.preventDefault()

      if (event.metaKey || event.ctrlKey) {
        actions.toggleSelection(threadId)
        actions.setActiveThread(threadId)
      } else if (event.shiftKey && activeThreadId && threadIds) {
        actions.selectRange(activeThreadId, threadId, threadIds)
        actions.setActiveThread(threadId)
      } else {
        actions.setSelectedThreads([threadId])
        actions.setActiveThread(threadId)
      }
    },
    [activeThreadId, threadIds, actions]
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
