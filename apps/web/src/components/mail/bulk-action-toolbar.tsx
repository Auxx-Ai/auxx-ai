// apps/web/src/components/mail/bulk-action-toolbar.tsx
'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { Archive, Trash2, Ban, Tags, Play, UserPlus, Trash } from 'lucide-react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useMailFilter } from './mail-filter-context'
import { useConfirm } from '~/hooks/use-confirm'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { TagPicker } from '~/components/pickers/tag-picker'
import type { ActorId } from '@auxx/types/actor'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { toRecordId } from '~/components/resources'
import {
  useSelectedThreadIds,
  useSelectionCount,
  useHasMultipleSelected,
  useThreadSelectionStore,
  useViewMode,
} from '~/components/threads/store'
import { useKeyboard } from '~/components/threads/context/keyboard-context'
import { useThreadMutation } from '~/components/threads/hooks'

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
  useKeyboard(
    'd',
    (e) => {
      e.preventDefault()
      if (selectionCount > 0 && !isBulkUpdating) {
        handleArchive()
      }
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
        tooltip: 'Move selected to trash',
      },
      {
        id: 'spam',
        label: 'Spam',
        icon: Ban,
        onClick: handleSpam,
        disabled: isBulkUpdating || disabled,
        tooltip: 'Mark selected as spam',
      },
      {
        id: 'tags',
        label: 'Tags',
        icon: Tags,
        disabled: tagBulk.isPending || disabled,
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
        tooltip: 'Run workflow',
      },
      {
        id: 'assign',
        label: 'Assign',
        icon: UserPlus,
        disabled: isBulkUpdating || disabled,
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
          if (!isOpen) clearSelection()
        }}
        selectedCount={selectionCount}
        selectedLabel="selected"
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
