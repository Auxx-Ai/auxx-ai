// apps/web/src/components/mail/bulk-action-toolbar.tsx
'use client'

import type { ActorId } from '@auxx/types/actor'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useHotkey } from '@tanstack/react-hotkeys'
import { Archive, Ban, Play, Tags, Trash, Trash2, UserPlus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { TagPicker } from '~/components/pickers/tag-picker'
import { toRecordId } from '~/components/resources'
import { useThreadMutation } from '~/components/threads/hooks'
import {
  useHasMultipleSelected,
  useSelectedThreadIds,
  useSelectionCount,
  useThreadSelectionStore,
  useViewMode,
} from '~/components/threads/store'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useMailFilter } from './mail-filter-context'

/**
 * A toolbar component that appears when multiple threads are selected,
 * providing options for bulk actions like archiving, deleting, tagging, etc.
 * Fully self-contained - reads selection state from store directly.
 */
export default function BulkActionToolbar() {
  const utils = api.useUtils()
  const { contextType, contextId, statusSlug, searchQuery } = useMailFilter()

  // Selection and view state from store
  const selectedThreadIds = useSelectedThreadIds()
  const selectionCount = useSelectionCount()
  const hasMultipleSelected = useHasMultipleSelected()
  const viewMode = useViewMode()
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection)
  const setViewMode = useThreadSelectionStore((s) => s.setViewMode)

  // Compute visibility internally
  const open = hasMultipleSelected || viewMode === 'edit'
  const [confirm, ConfirmDialog] = useConfirm()

  // External dialog states (for actions that open dialogs outside ActionBar)
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false)

  // --- New unified mutation hook with optimistic updates ---
  const { updateBulk, removeBulk, isBulkUpdating, isBulkRemoving } = useThreadMutation()

  // --- Keep tag mutation separate (not covered by unified endpoint) ---
  const tagBulk = api.thread.tagBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `Tags updated for ${selectionCount} threads` })
    },
    onError: (err) => toastError({ title: 'Failed to update tags', description: err.message }),
  })

  // --- Handlers using optimistic updates ---
  const handleArchive = useCallback(() => {
    updateBulk(selectedThreadIds, { status: 'ARCHIVED' })
    toastSuccess({ title: `${selectionCount} threads archived` })
    clearSelection()
  }, [updateBulk, selectedThreadIds, selectionCount, clearSelection])

  const handleTrash = useCallback(() => {
    updateBulk(selectedThreadIds, { status: 'TRASH' })
    toastSuccess({ title: `${selectionCount} threads moved to trash` })
    clearSelection()
  }, [updateBulk, selectedThreadIds, selectionCount, clearSelection])

  const handleSpam = useCallback(() => {
    updateBulk(selectedThreadIds, { status: 'SPAM' })
    toastSuccess({ title: `${selectionCount} threads marked as spam` })
    clearSelection()
  }, [updateBulk, selectedThreadIds, selectionCount, clearSelection])

  const handleAssign = useCallback(
    (actorIds: ActorId[]) => {
      const assigneeId = actorIds.length > 0 ? actorIds[0] : null
      if (selectionCount > 0 && assigneeId) {
        updateBulk(selectedThreadIds, { assigneeId })
        toastSuccess({ title: `${selectionCount} threads assigned` })
        clearSelection()
      }
    },
    [updateBulk, selectedThreadIds, selectionCount, clearSelection]
  )

  // --- Keyboard shortcuts ---
  useHotkey(
    'D',
    () => {
      if (selectionCount > 0 && !isBulkUpdating) handleArchive()
    },
    { enabled: open }
  )

  useHotkey(
    'Shift+3',
    () => {
      if (selectionCount > 0 && !isBulkUpdating) handleTrash()
    },
    { enabled: open }
  )

  useHotkey(
    'Shift+1',
    () => {
      if (selectionCount > 0 && !isBulkUpdating) handleSpam()
    },
    { enabled: open }
  )

  useHotkey(
    'L',
    () => {
      if (selectionCount > 0) {
        const btn = document.querySelector<HTMLButtonElement>('[data-action-id="tags"] button')
        btn?.click()
      }
    },
    { enabled: open }
  )

  useHotkey(
    'A',
    () => {
      if (selectionCount > 0) {
        const btn = document.querySelector<HTMLButtonElement>('[data-action-id="assign"] button')
        btn?.click()
      }
    },
    { enabled: open }
  )

  useHotkey(
    'W',
    () => {
      if (selectionCount > 0) setWorkflowDialogOpen(true)
    },
    { enabled: open }
  )

  // --- Handlers ---
  const handleTagChange = useCallback(
    (tagIds: string[]) => {
      const cleanTagIds = tagIds.filter(Boolean)
      if (cleanTagIds.length > 0 && selectionCount > 0) {
        tagBulk.mutate({ threadIds: selectedThreadIds, tagIds: cleanTagIds, operation: 'set' })
      }
    },
    [selectionCount, selectedThreadIds, tagBulk]
  )

  const handlePermanentlyDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: `Permanently delete ${selectionCount} threads?`,
      description: 'This action cannot be undone.',
      confirmText: 'Delete permanently',
      destructive: true,
    })
    if (confirmed) {
      removeBulk(selectedThreadIds)
      toastSuccess({ title: `${selectionCount} threads permanently deleted` })
      clearSelection()
    }
  }, [selectionCount, selectedThreadIds, removeBulk, clearSelection, confirm])

  const disabled = selectionCount === 0

  // --- Build actions array ---
  const actions: ActionBarAction[] = useMemo(
    () => [
      {
        id: 'archive',
        label: 'Archive',
        icon: Archive,
        onClick: handleArchive,
        disabled: isBulkUpdating || disabled,
        shortcut: 'D',
        tooltip: 'Archive selected',
      },
      {
        id: 'trash',
        label: 'Trash',
        icon: Trash2,
        onClick: handleTrash,
        disabled: isBulkUpdating || disabled,
        shortcut: '#',
        tooltip: 'Move selected to trash',
      },
      {
        id: 'spam',
        label: 'Spam',
        icon: Ban,
        onClick: handleSpam,
        disabled: isBulkUpdating || disabled,
        shortcut: '!',
        tooltip: 'Mark selected as spam',
      },
      {
        id: 'tags',
        label: 'Tags',
        icon: Tags,
        disabled: tagBulk.isPending || disabled,
        shortcut: 'L',
        tooltip: 'Apply tags',
        picker: {
          component: TagPicker,
          props: {
            onChange: handleTagChange,
            selectedTags: [],
            allowMultiple: true,
            align: 'end',
          },
        },
      },
      {
        id: 'workflow',
        label: 'Workflow',
        icon: Play,
        onClick: () => setWorkflowDialogOpen(true),
        disabled: disabled,
        shortcut: 'W',
        tooltip: 'Run workflow',
      },
      {
        id: 'assign',
        label: 'Assign',
        icon: UserPlus,
        disabled: isBulkUpdating || disabled,
        shortcut: 'A',
        tooltip: 'Assign to team member',
        picker: {
          component: ActorPicker,
          props: {
            value: [],
            onChange: handleAssign,
            multi: false,
            target: 'user',
            emptyLabel: 'Assign',
            align: 'end',
          },
        },
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: Trash,
        onClick: handlePermanentlyDelete,
        disabled: isBulkRemoving || disabled,
        variant: 'destructive',
        tooltip: 'Permanently delete',
      },
    ],
    [
      handleArchive,
      handleTrash,
      handleSpam,
      handleAssign,
      handleTagChange,
      handlePermanentlyDelete,
      isBulkUpdating,
      isBulkRemoving,
      tagBulk.isPending,
      disabled,
    ]
  )

  return (
    <>
      <ConfirmDialog />

      <ActionBar
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            clearSelection()
            setViewMode('view')
          }
        }}
        selectedCount={selectionCount}
        selectedLabel='selected'
        actions={actions}
        showClose
      />

      {/* External dialogs (rendered outside ActionBar) */}
      <MassWorkflowTriggerDialog
        open={workflowDialogOpen}
        onOpenChange={setWorkflowDialogOpen}
        recordIds={Array.from(selectedThreadIds).map((id) => toRecordId('thread', id))}
        onSuccess={() => {
          utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
        }}
      />
    </>
  )
}
