// apps/web/src/components/threads/hooks/use-thread-keyboard-nav.ts
'use client'

import { useHotkey } from '@tanstack/react-hotkeys'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { useThreadSelectionStore } from '../store/thread-selection-store'

interface UseThreadKeyboardNavOptions {
  /** Thread IDs in display order */
  threadIds: string[]
  /** Whether keyboard navigation is enabled (default: true) */
  enabled?: boolean
  /** Callback when navigating near end of list (for infinite scroll) */
  onNavigateToEnd?: () => void
  /** 'navigate' opens threads on arrow key (split view), 'focus' only highlights (compact view) */
  mode?: 'navigate' | 'focus'
  /** Callback when a thread is opened via Enter/ArrowRight in focus mode */
  onOpen?: (threadId: string) => void
}

/**
 * Provides keyboard navigation for thread lists.
 * Registers shortcuts: ArrowUp/Down, Shift+Arrow, Mod+A, Escape, M, Home, End
 * In 'focus' mode, also registers Enter to open the focused thread.
 */
export function useThreadKeyboardNav({
  threadIds,
  enabled = true,
  onNavigateToEnd,
  mode = 'navigate',
  onOpen,
}: UseThreadKeyboardNavOptions) {
  const isFocusMode = mode === 'focus'

  // Navigation helper
  const navigate = useCallback(
    (direction: 'up' | 'down', extendSelection: boolean) => {
      const store = useThreadSelectionStore.getState()
      const currentId = isFocusMode ? store.focusedThreadId : store.activeThreadId

      if (threadIds.length === 0) return

      const currentIndex = currentId ? threadIds.indexOf(currentId) : -1
      let nextIndex: number

      if (direction === 'down') {
        nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, threadIds.length - 1)
      } else {
        nextIndex = currentIndex === -1 ? threadIds.length - 1 : Math.max(currentIndex - 1, 0)
      }

      const nextId = threadIds[nextIndex]
      if (!nextId || nextIndex === currentIndex) return

      if (isFocusMode) {
        // Focus mode: only move the cursor, don't navigate or select
        store.setFocusedThread(nextId)
      } else {
        // Navigate mode: move the active thread. Plain arrow keys no longer mutate
        // the checkbox selection — that stays a user-driven gesture.
        if (extendSelection) {
          // Shift+arrow: if nothing is checked yet, treat the previously-active row
          // as the start of the range so the user gets what they expect.
          if (store.selectedThreadIds.length === 0 && currentId) {
            store.setSelectedThreads([currentId, nextId])
          } else {
            store.addToSelection(nextId)
          }
        }
        store.setActiveThread(nextId)
      }

      document.getElementById(`thread-${nextId}`)?.scrollIntoView({ block: 'nearest' })

      // Trigger infinite scroll fetch if near end
      if (direction === 'down' && nextIndex >= threadIds.length - 5 && onNavigateToEnd) {
        onNavigateToEnd()
      }
    },
    [threadIds, onNavigateToEnd, isFocusMode]
  )

  // Arrow Down
  useHotkey('ArrowDown', () => navigate('down', false), { enabled, conflictBehavior: 'allow' })

  // Arrow Up
  useHotkey('ArrowUp', () => navigate('up', false), { enabled, conflictBehavior: 'allow' })

  // Shift + Arrow Down (extend selection)
  useHotkey('Shift+ArrowDown', () => navigate('down', true), { enabled, conflictBehavior: 'allow' })

  // Shift + Arrow Up (extend selection)
  useHotkey('Shift+ArrowUp', () => navigate('up', true), { enabled, conflictBehavior: 'allow' })

  // Enter / ArrowRight - open focused thread (focus mode only)
  const openFocused = useCallback(() => {
    const store = useThreadSelectionStore.getState()
    const targetId = store.focusedThreadId ?? store.selectedThreadIds[0]
    if (targetId) {
      store.setActiveThread(targetId)
      onOpen?.(targetId)
    }
  }, [onOpen])

  useHotkey('Enter', openFocused, { enabled: enabled && isFocusMode, conflictBehavior: 'allow' })
  useHotkey('ArrowRight', openFocused, {
    enabled: enabled && isFocusMode,
    conflictBehavior: 'allow',
  })

  // Home - go to first thread
  useHotkey(
    'Home',
    () => {
      const store = useThreadSelectionStore.getState()
      if (threadIds.length > 0 && threadIds[0]) {
        if (isFocusMode) {
          store.setFocusedThread(threadIds[0])
        } else {
          store.setActiveThread(threadIds[0])
        }
        document.getElementById(`thread-${threadIds[0]}`)?.scrollIntoView({ block: 'nearest' })
      }
    },
    { enabled, conflictBehavior: 'allow' }
  )

  // End - go to last thread
  useHotkey(
    'End',
    () => {
      const store = useThreadSelectionStore.getState()
      const lastId = threadIds[threadIds.length - 1]
      if (threadIds.length > 0 && lastId) {
        if (isFocusMode) {
          store.setFocusedThread(lastId)
        } else {
          store.setActiveThread(lastId)
        }
        document.getElementById(`thread-${lastId}`)?.scrollIntoView({ block: 'nearest' })
      }
    },
    { enabled, conflictBehavior: 'allow' }
  )

  // Select All: Mod+A (replaces separate Meta+a and Control+a)
  // ignoreInputs: true so native select-all works in text editors
  useHotkey('Mod+A', () => useThreadSelectionStore.getState().selectAll(threadIds), {
    enabled,
    ignoreInputs: true,
    conflictBehavior: 'allow',
  })

  // Escape - clear selection
  useHotkey('Escape', () => useThreadSelectionStore.getState().clearSelection(), {
    enabled,
    conflictBehavior: 'allow',
  })

  // Toggle view mode (view/edit)
  useHotkey(
    'M',
    () => {
      const store = useThreadSelectionStore.getState()
      const currentMode = store.viewMode
      store.toggleViewMode()
      toast.info(currentMode === 'view' ? 'Edit mode enabled' : 'View mode enabled')
    },
    { enabled, conflictBehavior: 'allow' }
  )
}
