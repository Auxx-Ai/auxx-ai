// apps/web/src/components/threads/hooks/use-focused-thread-shortcuts.ts
'use client'

import { useHotkey } from '@tanstack/react-hotkeys'
import { useCallback, useState } from 'react'
import {
  useActiveThreadId,
  useFocusedThreadId,
  useHasMultipleSelected,
  useIsDetailOpen,
  useThreadSelectionStore,
  useViewMode,
} from '../store/thread-selection-store'
import { getThreadStoreState } from '../store/thread-store'
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
  const hasMultipleSelected = useHasMultipleSelected()
  const viewMode = useViewMode()
  const isDetailOpen = useIsDetailOpen()
  const { update, isUpdating } = useThreadMutation()

  const isFocusLocked = useThreadSelectionStore((s) => s.isFocusLocked)
  const setFocusLocked = useThreadSelectionStore((s) => s.setFocusLocked)

  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false)
  const [workflowThreadId, setWorkflowThreadId] = useState<string | null>(null)

  // When a thread detail is open, act on the OPEN thread (activeThreadId) and
  // ignore the list hover cursor (focusedThreadId) — the cursor is a list-only
  // concept and is often stale in split/detail view, which would otherwise make
  // shortcuts hit the wrong thread. When browsing the list, prefer the cursor.
  const targetThreadId = isDetailOpen ? activeThreadId : (focusedThreadId ?? activeThreadId)

  const enabled = !!targetThreadId && !hasMultipleSelected && viewMode !== 'edit'
  // isFocusLocked freezes the list hover cursor while a row-anchored popover is
  // open. It's a list-only concern — never gate the detail path on it (a stuck
  // lock must not disable the open thread's shortcuts).
  const actionsEnabled = enabled && (isDetailOpen || !isFocusLocked)
  // A/L open anchored popovers tied to the list row. When a thread detail is
  // open, its header owns these shortcuts instead so the popover anchors to a
  // visible header button rather than the hidden/absent list row.
  const anchoredActionsEnabled = actionsEnabled && !isDetailOpen

  // Advance the list cursor to the next thread after a destructive action.
  // Only used when browsing the list — in the detail view we stay on the thread
  // so the same key can reverse the action.
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

  // Toggle a status: pressing the key on a thread already in that state restores
  // it to OPEN (so `!` un-spams, `D` un-archives, etc). In the detail view we
  // stay on the thread; when browsing the list we advance the cursor for triage.
  const toggleStatus = useCallback(
    (status: 'ARCHIVED' | 'TRASH' | 'SPAM') => {
      if (!targetThreadId || isUpdating) return
      const current = getThreadStoreState().getThread(targetThreadId)?.status
      update(targetThreadId, { status: current === status ? 'OPEN' : status })
      if (!isDetailOpen) advanceFocus()
    },
    [targetThreadId, isUpdating, update, advanceFocus, isDetailOpen]
  )

  // D — Archive / unarchive
  useHotkey('D', () => toggleStatus('ARCHIVED'), {
    enabled: actionsEnabled,
    conflictBehavior: 'allow',
  })

  // Shift+3 (#) — Trash / restore
  useHotkey('Shift+3', () => toggleStatus('TRASH'), {
    enabled: actionsEnabled,
    conflictBehavior: 'allow',
  })

  // Shift+1 (!) — Spam / not spam
  useHotkey('Shift+1', () => toggleStatus('SPAM'), {
    enabled: actionsEnabled,
    conflictBehavior: 'allow',
  })

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
    { enabled: anchoredActionsEnabled, conflictBehavior: 'allow' }
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
    { enabled: anchoredActionsEnabled, conflictBehavior: 'allow' }
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
