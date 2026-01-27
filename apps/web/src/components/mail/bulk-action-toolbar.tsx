// apps/web/src/components/mail/bulk-action-toolbar.tsx
'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { Archive, Trash2, Ban, Tags, Play, UserPlus, Trash } from 'lucide-react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useMailFilter } from './mail-filter-context'
import { useConfirm } from '~/hooks/use-confirm'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { AssigneePicker } from '~/components/pickers/assignee-picker'
import { TagPicker } from '~/components/pickers/tag-picker'
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

  // --- Mutations ---
  const archiveBulk = api.thread.archiveBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `${selectionCount} threads archived` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug: 'done', searchQuery })
      clearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to archive', description: err.message }),
  })

  const moveToTrashBulk = api.thread.moveToTrashBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `${selectionCount} threads moved to trash` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug: 'trash', searchQuery })
      clearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to move to trash', description: err.message }),
  })

  const markAsSpamBulk = api.thread.markAsSpamBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `${selectionCount} threads marked as spam` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug: 'spam', searchQuery })
      clearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to mark as spam', description: err.message }),
  })

  const assignBulk = api.thread.assignBulk.useMutation({
    onSuccess: (_, variables) => {
      const msg = variables.assigneeId ? 'assigned' : 'unassigned'
      toastSuccess({ title: `${selectionCount} threads ${msg}` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      if (contextType !== 'personal_assigned' && contextType !== 'personal_inbox') {
        utils.thread.list.invalidate({
          contextType,
          contextId,
          statusSlug: 'assigned',
          searchQuery,
        })
        utils.thread.list.invalidate({
          contextType,
          contextId,
          statusSlug: 'unassigned',
          searchQuery,
        })
      }
      if (contextType === 'personal_assigned') {
        utils.thread.list.invalidate({
          contextType: 'personal_assigned',
          statusSlug: 'open',
          searchQuery,
        })
        utils.thread.list.invalidate({
          contextType: 'personal_assigned',
          statusSlug: 'done',
          searchQuery,
        })
      }
      clearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to assign', description: err.message }),
  })

  const tagBulk = api.thread.tagBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `Tags updated for ${selectionCount} threads` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
    },
    onError: (err) => toastError({ title: 'Failed to update tags', description: err.message }),
  })

  const deletePermanentlyBulk = api.thread.deletePermanentlyBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `${selectionCount} threads permanently deleted` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      clearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to delete', description: err.message }),
  })

  // --- Keyboard shortcuts ---
  useKeyboard(
    'd',
    (e) => {
      e.preventDefault()
      if (selectionCount > 0 && !archiveBulk.isPending) {
        archiveBulk.mutate({ threadIds: selectedThreadIds })
      }
    },
    { enabled: open }
  )

  // --- Handlers ---
  const handleAssigneeChange = useCallback(
    (selected: any[]) => {
      const assigneeId = selected?.[0]?.id
      if (selectionCount > 0 && assigneeId) {
        assignBulk.mutate({ threadIds: selectedThreadIds, assigneeId })
      }
    },
    [selectionCount, selectedThreadIds, assignBulk]
  )

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
      deletePermanentlyBulk.mutate({ threadIds: selectedThreadIds })
    }
  }, [selectionCount, selectedThreadIds, deletePermanentlyBulk, confirm])

  const disabled = selectionCount === 0

  // --- Build actions array ---
  const actions: ActionBarAction[] = useMemo(
    () => [
      {
        id: 'archive',
        label: 'Archive',
        icon: Archive,
        onClick: () => archiveBulk.mutate({ threadIds: selectedThreadIds }),
        disabled: archiveBulk.isPending || disabled,
        shortcut: 'D',
        tooltip: 'Archive selected',
      },
      {
        id: 'trash',
        label: 'Trash',
        icon: Trash2,
        onClick: () => moveToTrashBulk.mutate({ threadIds: selectedThreadIds }),
        disabled: moveToTrashBulk.isPending || disabled,
        tooltip: 'Move selected to trash',
      },
      {
        id: 'spam',
        label: 'Spam',
        icon: Ban,
        onClick: () => markAsSpamBulk.mutate({ threadIds: selectedThreadIds }),
        disabled: markAsSpamBulk.isPending || disabled,
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
        disabled: assignBulk.isPending || disabled,
        tooltip: 'Assign to team member',
        picker: {
          component: AssigneePicker,
          props: {
            onChange: handleAssigneeChange,
            placeholder: 'Assign',
            selected: undefined,
            align: 'end',
          },
        },
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: Trash,
        onClick: handlePermanentlyDelete,
        disabled: deletePermanentlyBulk.isPending || disabled,
        variant: 'destructive',
        tooltip: 'Permanently delete',
      },
    ],
    [
      selectedThreadIds,
      selectionCount,
      archiveBulk,
      moveToTrashBulk,
      markAsSpamBulk,
      tagBulk,
      assignBulk,
      deletePermanentlyBulk,
      handleAssigneeChange,
      handleTagChange,
      handlePermanentlyDelete,
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
