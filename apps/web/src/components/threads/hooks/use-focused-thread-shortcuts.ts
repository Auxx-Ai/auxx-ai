// apps/web/src/components/threads/hooks/use-focused-thread-shortcuts.ts
'use client'

import { useHotkey } from '@tanstack/react-hotkeys'
import { useCallback, useState } from 'react'
import {
  useFocusedThreadId,
  useHasMultipleSelected,
  useThreadSelectionStore,
  useViewMode,
} from '../store/thread-selection-store'
import { useThreadMutation } from './use-thread-mutation'

/**
 * Registers action shortcuts (D, #, !, W, L) for the focused thread in compact view.
 * Disabled when bulk mode is active so bulk shortcuts take priority.
 * Returns UI state (workflow dialog, tag picker) for rendering by the parent component.
 */
export function useFocusedThreadShortcuts() {
  const focusedThreadId = useFocusedThreadId()
  const hasMultipleSelected = useHasMultipleSelected()
  const viewMode = useViewMode()
  const { update, isUpdating } = useThreadMutation()

  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false)
  const [workflowThreadId, setWorkflowThreadId] = useState<string | null>(null)

  const enabled = !!focusedThreadId && !hasMultipleSelected && viewMode !== 'edit'

  const advanceFocus = useCallback(() => {
    const store = useThreadSelectionStore.getState()
    const { listThreadIds, focusedThreadId: currentId } = store
    if (!currentId) return
    const idx = listThreadIds.indexOf(currentId)
    const nextId = listThreadIds[idx + 1] ?? listThreadIds[idx - 1] ?? null
    store.setFocusedThread(nextId)
  }, [])

  // D — Archive
  useHotkey(
    'D',
    () => {
      if (focusedThreadId && !isUpdating) {
        update(focusedThreadId, { status: 'ARCHIVED' })
        advanceFocus()
      }
    },
    { enabled, conflictBehavior: 'allow' }
  )

  // Shift+3 (#) — Trash
  useHotkey(
    'Shift+3',
    () => {
      if (focusedThreadId && !isUpdating) {
        update(focusedThreadId, { status: 'TRASH' })
        advanceFocus()
      }
    },
    { enabled, conflictBehavior: 'allow' }
  )

  // Shift+1 (!) — Spam
  useHotkey(
    'Shift+1',
    () => {
      if (focusedThreadId && !isUpdating) {
        update(focusedThreadId, { status: 'SPAM' })
        advanceFocus()
      }
    },
    { enabled, conflictBehavior: 'allow' }
  )

  // W — Open workflow dialog
  useHotkey(
    'W',
    () => {
      if (focusedThreadId) {
        setWorkflowThreadId(focusedThreadId)
        setWorkflowDialogOpen(true)
      }
    },
    { enabled, conflictBehavior: 'allow' }
  )

  // L — Open tag picker
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [tagPickerThreadId, setTagPickerThreadId] = useState<string | null>(null)

  useHotkey(
    'L',
    () => {
      if (focusedThreadId) {
        setTagPickerThreadId(focusedThreadId)
        setTagPickerOpen(true)
      }
    },
    { enabled, conflictBehavior: 'allow' }
  )

  return {
    workflowDialogOpen,
    setWorkflowDialogOpen,
    workflowThreadId,
    tagPickerOpen,
    setTagPickerOpen,
    tagPickerThreadId,
  }
}
