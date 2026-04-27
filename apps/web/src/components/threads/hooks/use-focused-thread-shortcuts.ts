// apps/web/src/components/threads/hooks/use-focused-thread-shortcuts.ts
'use client'

import { useHotkey } from '@tanstack/react-hotkeys'
import { useCallback, useState } from 'react'
import {
  useActiveThreadId,
  useFocusedThreadId,
  useHasMultipleSelected,
  useThreadSelectionStore,
  useViewMode,
} from '../store/thread-selection-store'
import { useThreadMutation } from './use-thread-mutation'

/**
 * Registers action shortcuts (D, #, !, W, L, A) for the focused thread (compact/list view)
 * or the active thread (split view) when no focus cursor is set.
 * Disabled when bulk mode is active so bulk shortcuts take priority.
 * Returns UI state (workflow dialog, tag picker) for rendering by the parent component.
 */
export function useFocusedThreadShortcuts() {
  const focusedThreadId = useFocusedThreadId()
  const activeThreadId = useActiveThreadId()
  const targetThreadId = focusedThreadId ?? activeThreadId
  const hasMultipleSelected = useHasMultipleSelected()
  const viewMode = useViewMode()
  const { update, isUpdating } = useThreadMutation()

  const isFocusLocked = useThreadSelectionStore((s) => s.isFocusLocked)
  const setFocusLocked = useThreadSelectionStore((s) => s.setFocusLocked)

  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false)
  const [workflowThreadId, setWorkflowThreadId] = useState<string | null>(null)

  const enabled = !!targetThreadId && !hasMultipleSelected && viewMode !== 'edit'
  const actionsEnabled = enabled && !isFocusLocked

  // Advance to the next thread after a destructive action.
  // In list/compact view (focusedThreadId set), move the focus cursor.
  // In split view (only activeThreadId set), move the active thread so the
  // next one auto-opens via the URL sync.
  const advanceFocus = useCallback(() => {
    const store = useThreadSelectionStore.getState()
    const { listThreadIds, focusedThreadId: currentFocused, activeThreadId: currentActive } = store
    const currentId = currentFocused ?? currentActive
    if (!currentId) return
    const idx = listThreadIds.indexOf(currentId)
    const nextId = listThreadIds[idx + 1] ?? listThreadIds[idx - 1] ?? null
    if (currentFocused) {
      store.setFocusedThread(nextId)
    } else {
      store.setActiveThread(nextId)
    }
  }, [])

  // D — Archive
  useHotkey(
    'D',
    () => {
      if (targetThreadId && !isUpdating) {
        update(targetThreadId, { status: 'ARCHIVED' })
        advanceFocus()
      }
    },
    { enabled: actionsEnabled, conflictBehavior: 'allow' }
  )

  // Shift+3 (#) — Trash
  useHotkey(
    'Shift+3',
    () => {
      if (targetThreadId && !isUpdating) {
        update(targetThreadId, { status: 'TRASH' })
        advanceFocus()
      }
    },
    { enabled: actionsEnabled, conflictBehavior: 'allow' }
  )

  // Shift+1 (!) — Spam
  useHotkey(
    'Shift+1',
    () => {
      if (targetThreadId && !isUpdating) {
        update(targetThreadId, { status: 'SPAM' })
        advanceFocus()
      }
    },
    { enabled: actionsEnabled, conflictBehavior: 'allow' }
  )

  // W — Open workflow dialog
  useHotkey(
    'W',
    () => {
      if (targetThreadId) {
        setWorkflowThreadId(targetThreadId)
        setWorkflowDialogOpen(true)
        setFocusLocked(true)
      }
    },
    { enabled: actionsEnabled, conflictBehavior: 'allow' }
  )

  const handleWorkflowDialogOpenChange = useCallback(
    (open: boolean) => {
      setWorkflowDialogOpen(open)
      setFocusLocked(open)
    },
    [setFocusLocked]
  )

  // A — Open assign picker
  const [assignPickerOpen, setAssignPickerOpen] = useState(false)
  const [assignPickerThreadId, setAssignPickerThreadId] = useState<string | null>(null)

  useHotkey(
    'A',
    () => {
      if (targetThreadId) {
        setAssignPickerThreadId(targetThreadId)
        setAssignPickerOpen(true)
        setFocusLocked(true)
      }
    },
    { enabled: actionsEnabled, conflictBehavior: 'allow' }
  )

  const handleAssignPickerOpenChange = useCallback(
    (open: boolean) => {
      setAssignPickerOpen(open)
      setFocusLocked(open)
    },
    [setFocusLocked]
  )

  /** Open the assign picker for a specific thread (e.g. from a hover action click) */
  const openAssignPicker = useCallback(
    (threadId: string) => {
      setAssignPickerThreadId(threadId)
      setAssignPickerOpen(true)
      setFocusLocked(true)
    },
    [setFocusLocked]
  )

  // L — Open tag picker
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [tagPickerThreadId, setTagPickerThreadId] = useState<string | null>(null)

  useHotkey(
    'L',
    () => {
      if (targetThreadId) {
        setTagPickerThreadId(targetThreadId)
        setTagPickerOpen(true)
        setFocusLocked(true)
      }
    },
    { enabled: actionsEnabled, conflictBehavior: 'allow' }
  )

  const handleTagPickerOpenChange = useCallback(
    (open: boolean) => {
      setTagPickerOpen(open)
      setFocusLocked(open)
    },
    [setFocusLocked]
  )

  /** Open the tag picker for a specific thread (e.g. from a tag badge click) */
  const openTagPicker = useCallback(
    (threadId: string) => {
      setTagPickerThreadId(threadId)
      setTagPickerOpen(true)
      setFocusLocked(true)
    },
    [setFocusLocked]
  )

  return {
    workflowDialogOpen,
    handleWorkflowDialogOpenChange,
    workflowThreadId,
    tagPickerOpen,
    handleTagPickerOpenChange,
    tagPickerThreadId,
    openTagPicker,
    assignPickerOpen,
    handleAssignPickerOpenChange,
    assignPickerThreadId,
    openAssignPicker,
  }
}
