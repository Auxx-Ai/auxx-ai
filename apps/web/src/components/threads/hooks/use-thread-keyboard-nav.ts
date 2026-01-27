// apps/web/src/components/threads/hooks/use-thread-keyboard-nav.ts
'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import { useKeyboard } from '../context/keyboard-context'
import { useThreadSelectionStore } from '../store/thread-selection-store'

interface UseThreadKeyboardNavOptions {
  /** Thread IDs in display order */
  threadIds: string[]
  /** Whether keyboard navigation is enabled (default: true) */
  enabled?: boolean
  /** Callback when navigating near end of list (for infinite scroll) */
  onNavigateToEnd?: () => void
  /** Priority for keyboard shortcuts (higher = takes precedence) */
  priority?: number
}

/**
 * Provides keyboard navigation for thread lists.
 * Registers shortcuts: ArrowUp/Down, Shift+Arrow, Meta+a, Escape, m, Home, End
 */
export function useThreadKeyboardNav({
  threadIds,
  enabled = true,
  onNavigateToEnd,
  priority = 0,
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
  useKeyboard(
    'ArrowDown',
    (e) => {
      e.preventDefault()
      navigate('down', false)
    },
    { enabled, priority }
  )

  // Arrow Up
  useKeyboard(
    'ArrowUp',
    (e) => {
      e.preventDefault()
      navigate('up', false)
    },
    { enabled, priority }
  )

  // Shift + Arrow Down (extend selection)
  useKeyboard(
    'Shift+ArrowDown',
    (e) => {
      e.preventDefault()
      navigate('down', true)
    },
    { enabled, priority }
  )

  // Shift + Arrow Up (extend selection)
  useKeyboard(
    'Shift+ArrowUp',
    (e) => {
      e.preventDefault()
      navigate('up', true)
    },
    { enabled, priority }
  )

  // Home - go to first thread
  useKeyboard(
    'Home',
    (e) => {
      e.preventDefault()
      const store = useThreadSelectionStore.getState()
      if (threadIds.length > 0 && threadIds[0]) {
        store.setActiveThread(threadIds[0])
        if (store.viewMode !== 'edit') {
          store.setSelectedThreads([threadIds[0]])
        }
      }
    },
    { enabled, priority }
  )

  // End - go to last thread
  useKeyboard(
    'End',
    (e) => {
      e.preventDefault()
      const store = useThreadSelectionStore.getState()
      const lastId = threadIds[threadIds.length - 1]
      if (threadIds.length > 0 && lastId) {
        store.setActiveThread(lastId)
        if (store.viewMode !== 'edit') {
          store.setSelectedThreads([lastId])
        }
      }
    },
    { enabled, priority }
  )

  // Select All (Cmd+A / Ctrl+A)
  useKeyboard(
    'Meta+a',
    (e) => {
      e.preventDefault()
      useThreadSelectionStore.getState().selectAll(threadIds)
    },
    { enabled, priority }
  )

  useKeyboard(
    'Control+a',
    (e) => {
      e.preventDefault()
      useThreadSelectionStore.getState().selectAll(threadIds)
    },
    { enabled, priority }
  )

  // Escape - clear selection
  useKeyboard(
    'Escape',
    (e) => {
      e.preventDefault()
      useThreadSelectionStore.getState().clearSelection()
    },
    { enabled, priority }
  )

  // Toggle view mode (view/edit)
  useKeyboard(
    'm',
    () => {
      const store = useThreadSelectionStore.getState()
      const currentMode = store.viewMode
      store.toggleViewMode()
      toast.info(currentMode === 'view' ? 'Edit mode enabled' : 'View mode enabled')
    },
    { enabled, priority }
  )
}
