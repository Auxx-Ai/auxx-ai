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
}

/**
 * Provides keyboard navigation for thread lists.
 * Registers shortcuts: ArrowUp/Down, Shift+Arrow, Mod+A, Escape, M, Home, End
 */
export function useThreadKeyboardNav({
  threadIds,
  enabled = true,
  onNavigateToEnd,
}: UseThreadKeyboardNavOptions) {
  // Navigation helper
  const navigate = useCallback(
    (direction: 'up' | 'down', extendSelection: boolean) => {
      const store = useThreadSelectionStore.getState()
      const { activeThreadId, viewMode } = store

      if (threadIds.length === 0) return

      const currentIndex = activeThreadId ? threadIds.indexOf(activeThreadId) : -1
      let nextIndex: number

      if (direction === 'down') {
        nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, threadIds.length - 1)
      } else {
        nextIndex = currentIndex === -1 ? threadIds.length - 1 : Math.max(currentIndex - 1, 0)
      }

      const nextId = threadIds[nextIndex]
      if (!nextId || nextIndex === currentIndex) return

      store.setActiveThread(nextId)

      if (extendSelection) {
        store.addToSelection(nextId)
      } else if (viewMode !== 'edit') {
        store.setSelectedThreads([nextId])
      }

      // Trigger infinite scroll fetch if near end
      if (direction === 'down' && nextIndex >= threadIds.length - 5 && onNavigateToEnd) {
        onNavigateToEnd()
      }
    },
    [threadIds, onNavigateToEnd]
  )

  // Arrow Down
  useHotkey('ArrowDown', () => navigate('down', false), { enabled })

  // Arrow Up
  useHotkey('ArrowUp', () => navigate('up', false), { enabled })

  // Shift + Arrow Down (extend selection)
  useHotkey('Shift+ArrowDown', () => navigate('down', true), { enabled })

  // Shift + Arrow Up (extend selection)
  useHotkey('Shift+ArrowUp', () => navigate('up', true), { enabled })

  // Home - go to first thread
  useHotkey(
    'Home',
    () => {
      const store = useThreadSelectionStore.getState()
      if (threadIds.length > 0 && threadIds[0]) {
        store.setActiveThread(threadIds[0])
        if (store.viewMode !== 'edit') {
          store.setSelectedThreads([threadIds[0]])
        }
      }
    },
    { enabled }
  )

  // End - go to last thread
  useHotkey(
    'End',
    () => {
      const store = useThreadSelectionStore.getState()
      const lastId = threadIds[threadIds.length - 1]
      if (threadIds.length > 0 && lastId) {
        store.setActiveThread(lastId)
        if (store.viewMode !== 'edit') {
          store.setSelectedThreads([lastId])
        }
      }
    },
    { enabled }
  )

  // Select All: Mod+A (replaces separate Meta+a and Control+a)
  // ignoreInputs: true so native select-all works in text editors
  useHotkey('Mod+A', () => useThreadSelectionStore.getState().selectAll(threadIds), {
    enabled,
    ignoreInputs: true,
  })

  // Escape - clear selection
  useHotkey('Escape', () => useThreadSelectionStore.getState().clearSelection(), { enabled })

  // Toggle view mode (view/edit)
  useHotkey(
    'M',
    () => {
      const store = useThreadSelectionStore.getState()
      const currentMode = store.viewMode
      store.toggleViewMode()
      toast.info(currentMode === 'view' ? 'Edit mode enabled' : 'View mode enabled')
    },
    { enabled }
  )
}
