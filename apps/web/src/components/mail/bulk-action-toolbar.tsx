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

/**
 * Props for the BulkActionToolbar component.
 */
interface BulkActionToolbarProps {
  /** Controls visibility of the action bar with enter/exit animation. */
  open?: boolean
  /** Array of selected thread IDs for bulk actions. */
  selectedThreadIds: string[]
  /** Callback function to clear the current selection. */
  onClearSelection: () => void
}

/**
 * A toolbar component that appears when multiple threads are selected,
 * providing options for bulk actions like archiving, deleting, tagging, etc.
 * It uses MailFilterContext to correctly invalidate relevant thread lists.
 */
export default function BulkActionToolbar({
  open = true,
  selectedThreadIds,
  onClearSelection,
}: BulkActionToolbarProps) {
  const utils = api.useUtils()
  const { contextType, contextId, statusSlug, searchQuery } = useMailFilter()
  const [confirm, ConfirmDialog] = useConfirm()

  // External dialog states (for actions that open dialogs outside ActionBar)
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false)

  // --- Mutations ---
  const archiveBulk = api.thread.archiveBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `${selectedThreadIds.length} threads archived` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug: 'done', searchQuery })
      onClearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to archive', description: err.message }),
  })

  const moveToTrashBulk = api.thread.moveToTrashBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `${selectedThreadIds.length} threads moved to trash` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug: 'trash', searchQuery })
      onClearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to move to trash', description: err.message }),
  })

  const markAsSpamBulk = api.thread.markAsSpamBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `${selectedThreadIds.length} threads marked as spam` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug: 'spam', searchQuery })
      onClearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to mark as spam', description: err.message }),
  })

  const assignBulk = api.thread.assignBulk.useMutation({
    onSuccess: (_, variables) => {
      const msg = variables.assigneeId ? 'assigned' : 'unassigned'
      toastSuccess({ title: `${selectedThreadIds.length} threads ${msg}` })
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
      onClearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to assign', description: err.message }),
  })

  const tagBulk = api.thread.tagBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `Tags updated for ${selectedThreadIds.length} threads` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
    },
    onError: (err) => toastError({ title: 'Failed to update tags', description: err.message }),
  })

  const deletePermanentlyBulk = api.thread.deletePermanentlyBulk.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `${selectedThreadIds.length} threads permanently deleted` })
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      onClearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to delete', description: err.message }),
  })

  // --- Handlers ---
  const handleAssigneeChange = useCallback(
    (selected: any[]) => {
      const assigneeId = selected?.[0]?.id
      if (selectedThreadIds.length > 0 && assigneeId) {
        assignBulk.mutate({ threadIds: selectedThreadIds, assigneeId })
      }
    },
    [selectedThreadIds, assignBulk]
  )

  const handleTagChange = useCallback(
    (tagIds: string[]) => {
      const cleanTagIds = tagIds.filter(Boolean)
      if (cleanTagIds.length > 0 && selectedThreadIds.length > 0) {
        tagBulk.mutate({ threadIds: selectedThreadIds, tagIds: cleanTagIds, operation: 'set' })
      }
    },
    [selectedThreadIds, tagBulk]
  )

  const handlePermanentlyDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: `Permanently delete ${selectedThreadIds.length} threads?`,
      description: 'This action cannot be undone.',
      confirmText: 'Delete permanently',
      destructive: true,
    })
    if (confirmed) {
      deletePermanentlyBulk.mutate({ threadIds: selectedThreadIds })
    }
  }, [selectedThreadIds, deletePermanentlyBulk, confirm])

  const disabled = selectedThreadIds.length === 0

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
      disabled,
      archiveBulk,
      moveToTrashBulk,
      markAsSpamBulk,
      tagBulk,
      assignBulk,
      deletePermanentlyBulk,
      handleAssigneeChange,
      handlePermanentlyDelete,
    ]
  )

  return (
    <>
      <ConfirmDialog />

      <ActionBar
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClearSelection()
        }}
        selectedCount={selectedThreadIds.length}
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
