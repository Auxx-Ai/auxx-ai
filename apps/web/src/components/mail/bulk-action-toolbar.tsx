// apps/web/src/components/mail/bulk-action-toolbar.tsx
'use client'

import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useHotkey } from '@tanstack/react-hotkeys'
import { Archive, Ban, Play, Tags, Trash, Trash2, UserPlus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { TagPicker } from '~/components/pickers/tag-picker'
import { parseRecordId, toRecordId, useResource } from '~/components/resources'
import { useThreadMutation } from '~/components/threads/hooks'
import {
  useHasMultipleSelected,
  useSelectedThreadIds,
  useSelectionCount,
  useThreadSelectionStore,
  useThreadStore,
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

  // --- Tag mutation: tri-state with optimistic updates against ThreadStore ---
  const tagBulk = api.thread.tagBulk.useMutation()
  const getThread = useThreadStore((s) => s.getThread)
  const updateThreadOptimistic = useThreadStore((s) => s.updateThreadOptimistic)
  const confirmOptimistic = useThreadStore((s) => s.confirmOptimistic)
  const rollbackOptimistic = useThreadStore((s) => s.rollbackOptimistic)
  const { resource: tagResource } = useResource('tag')
  const tagEntityDefId = tagResource?.entityDefinitionId ?? undefined

  // Subscribe to tagIds of all selected threads — recomputes on any optimistic update.
  const selectedThreadsTagIds = useThreadStore(
    useShallow((s) =>
      selectedThreadIds.map((id) => s.threads.get(id)?.tagIds ?? null).filter((t) => t !== null)
    )
  )

  // Derive tri-state tag sets from selected threads' tagIds
  const { fullySelectedTagIds, partiallySelectedTagIds } = useMemo(() => {
    if (selectedThreadsTagIds.length === 0) {
      return { fullySelectedTagIds: [] as string[], partiallySelectedTagIds: [] as string[] }
    }

    const counts = new Map<string, number>()
    for (const tagIds of selectedThreadsTagIds) {
      for (const recordId of tagIds) {
        const { entityInstanceId } = parseRecordId(recordId)
        counts.set(entityInstanceId, (counts.get(entityInstanceId) ?? 0) + 1)
      }
    }

    const full: string[] = []
    const partial: string[] = []
    for (const [tagId, count] of counts) {
      if (count === selectedThreadsTagIds.length) full.push(tagId)
      else if (count > 0) partial.push(tagId)
    }
    return { fullySelectedTagIds: full, partiallySelectedTagIds: partial }
  }, [selectedThreadsTagIds])

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
    { enabled: open, conflictBehavior: 'allow' }
  )

  useHotkey(
    'Shift+3',
    () => {
      if (selectionCount > 0 && !isBulkUpdating) handleTrash()
    },
    { enabled: open, conflictBehavior: 'allow' }
  )

  useHotkey(
    'Shift+1',
    () => {
      if (selectionCount > 0 && !isBulkUpdating) handleSpam()
    },
    { enabled: open, conflictBehavior: 'allow' }
  )

  useHotkey(
    'L',
    () => {
      if (selectionCount > 0) {
        const btn = document.querySelector<HTMLButtonElement>('[data-action-id="tags"] button')
        btn?.click()
      }
    },
    { enabled: open, conflictBehavior: 'allow' }
  )

  useHotkey(
    'A',
    () => {
      if (selectionCount > 0) {
        const btn = document.querySelector<HTMLButtonElement>('[data-action-id="assign"] button')
        btn?.click()
      }
    },
    { enabled: open, conflictBehavior: 'allow' }
  )

  useHotkey(
    'W',
    () => {
      if (selectionCount > 0) setWorkflowDialogOpen(true)
    },
    { enabled: open, conflictBehavior: 'allow' }
  )

  // --- Handlers ---
  const handleTagChange = useCallback(
    (nextFullyCheckedRaw: string[]) => {
      if (selectionCount === 0 || !tagEntityDefId) return
      // Picker returns RecordIds when tagEntityDefinitionId is resolved; strip to instance IDs.
      const nextFullyChecked = nextFullyCheckedRaw
        .filter(Boolean)
        .map((id) => (id.includes(':') ? parseRecordId(id as RecordId).entityInstanceId : id))

      const prevFull = new Set(fullySelectedTagIds)
      const nextFull = new Set(nextFullyChecked)

      const toAdd = [...nextFull].filter((id) => !prevFull.has(id))
      const toRemove = [...prevFull].filter((id) => !nextFull.has(id))

      if (toAdd.length === 0 && toRemove.length === 0) return

      const fire = (tagIds: string[], operation: 'add' | 'remove') => {
        if (tagIds.length === 0) return
        const tagRecordIds = tagIds.map((id) => toRecordId(tagEntityDefId, id))

        const versions = selectedThreadIds.map((threadId) => {
          const current = getThread(threadId)?.tagIds ?? []
          const next =
            operation === 'add'
              ? Array.from(new Set([...current, ...tagRecordIds]))
              : current.filter((rid) => !tagRecordIds.includes(rid))
          return { threadId, version: updateThreadOptimistic(threadId, { tagIds: next }) }
        })

        tagBulk.mutate(
          { threadIds: selectedThreadIds, tagIds, operation },
          {
            onSuccess: () => {
              versions.forEach(({ threadId, version }) => confirmOptimistic(threadId, version))
            },
            onError: (err) => {
              versions.forEach(({ threadId, version }) => rollbackOptimistic(threadId, version))
              toastError({ title: 'Failed to update tags', description: err.message })
            },
          }
        )
      }

      fire(toAdd, 'add')
      fire(toRemove, 'remove')
    },
    [
      selectionCount,
      selectedThreadIds,
      fullySelectedTagIds,
      tagEntityDefId,
      tagBulk,
      getThread,
      updateThreadOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
    ]
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
        label: 'Done',
        icon: Archive,
        onClick: handleArchive,
        disabled: isBulkUpdating || disabled,
        shortcut: 'D',
        tooltip: 'Done selected',
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
            selectedTags: fullySelectedTagIds,
            indeterminateTags: partiallySelectedTagIds,
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
      fullySelectedTagIds,
      partiallySelectedTagIds,
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
