// File: src/components/mail/bulk-action-toolbar.tsx
// --- START OF FILE ~/components/mail/bulk-action-toolbar.tsx ---
'use client'

import React, { useCallback, useRef, useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import {
  Archive,
  Trash2,
  Ban,
  XCircle,
  Tags,
  MoreHorizontal,
  Trash,
  Play,
  UserPlus,
} from 'lucide-react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Popover, PopoverTrigger } from '@auxx/ui/components/popover'
import { TagPicker } from '~/components/pickers/tag-picker'
import { AssigneePicker } from '~/components/pickers/assignee-picker'
import { useMailFilter } from './mail-filter-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { useConfirm } from '~/hooks/use-confirm'
import {
  ActionBar,
  ActionBarActionItem,
  ActionBarActions,
  ActionBarClose,
  ActionBarContent,
  ActionBarText,
} from '@auxx/ui/components/action-bar'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'

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
  // Get tRPC utils and current filter context
  const utils = api.useUtils()
  const currentFilter = useMailFilter()
  const { contextType, contextId, statusSlug, searchQuery } = currentFilter
  const [confirm, ConfirmDialog] = useConfirm()
  // State for controlling the TagPicker popover
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  // State for controlling the Workflow dialog
  const [isWorkflowDialogOpen, setIsWorkflowDialogOpen] = useState(false)
  // Note: selectedTags state here might be misleading as it's only used
  // immediately before mutation. If pre-loading existing tags for bulk edit
  // is needed, this would require more logic (fetching common tags, etc.).
  // For now, it's just used to pass the selection to the mutation.
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Ref for the tags button to position the external popover
  const tagButtonRef = useRef<HTMLButtonElement>(null)
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null)

  // Update button position when popover opens
  React.useEffect(() => {
    if (tagPickerOpen && tagButtonRef.current) {
      setButtonRect(tagButtonRef.current.getBoundingClientRect())
    }
  }, [tagPickerOpen])

  // --- API Mutations with Contextual Invalidation ---

  const archiveBulk = api.thread.archiveBulk.useMutation({
    onMutate: () => {
      //toast.info(`Archiving ${selectedThreadIds.length} threads...`)
    },
    onSuccess: () => {
      toastSuccess({ title: `${selectedThreadIds.length} threads archived` })
      // Invalidate the current list (where items are removed)
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      // Invalidate the 'done'/'archived' list (where items are added)
      utils.thread.list.invalidate({ contextType, contextId, statusSlug: 'done', searchQuery })
      onClearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to archive', description: err.message }),
  })

  const moveToTrashBulk = api.thread.moveToTrashBulk.useMutation({
    onMutate: () => {
      // toast.info(`Moving ${selectedThreadIds.length} threads to trash...`)
    },
    onSuccess: () => {
      toastSuccess({ title: `${selectedThreadIds.length} threads moved to trash` })
      // Invalidate the current list
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      // Invalidate the 'trash' list
      utils.thread.list.invalidate({ contextType, contextId, statusSlug: 'trash', searchQuery })
      onClearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to move to trash', description: err.message }),
  })

  const markAsSpamBulk = api.thread.markAsSpamBulk.useMutation({
    onMutate: () => {
      // toast.info(`Marking ${selectedThreadIds.length} threads as spam...`)
    },
    onSuccess: () => {
      toastSuccess({ title: `${selectedThreadIds.length} threads marked as spam` })
      // Invalidate the current list
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      // Invalidate the 'spam' list
      utils.thread.list.invalidate({ contextType, contextId, statusSlug: 'spam', searchQuery })
      onClearSelection()
    },
    onError: (err) => toastError({ title: 'Failed to mark as spam', description: err.message }),
  })

  const assignBulk = api.thread.assignBulk.useMutation({
    // Note: We don't know the *previous* assignee, so precise invalidation
    // of specific user views is hard. We invalidate common relevant views.
    onSuccess: (data, variables) => {
      const assigneeMsg = variables.assigneeId ? 'assigned' : 'unassigned'
      toastSuccess({ title: `${selectedThreadIds.length} threads ${assigneeMsg}` })
      // Invalidate the current view first
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      // Invalidate generic assigned/unassigned views if applicable in the current context
      // (e.g., if viewing 'all_inboxes' or a specific inbox)
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
      // If viewing personal assigned, invalidate it again specifically
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
      // Tags usually don't change status, just invalidate the current view
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      setTagPickerOpen(false)
      // Do not clear selection here, user might want to perform another action
    },
    onError: (err) => toastError({ title: 'Failed to update tags', description: err.message }),
  })

  const deletePermanentlyBulk = api.thread.deletePermanentlyBulk.useMutation({
    onMutate: () => {
      // toast.info(`Permanently deleting ${selectedThreadIds.length} threads...`)
    },
    onSuccess: () => {
      toastSuccess({ title: `${selectedThreadIds.length} threads permanently deleted` })
      // Invalidate the current list since items are permanently removed
      utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
      onClearSelection()
    },
    onError: (err) =>
      toastError({ title: 'Failed to permanently delete', description: err.message }),
  })

  // --- Event Handlers ---

  const handleTagChange = useCallback(
    (tagIds: string[]) => {
      // Extract clean tag IDs
      const cleanTagIds = tagIds.filter(Boolean)
      setSelectedTags(cleanTagIds) // Keep local state if needed for UI feedback

      // Only mutate if there are tags selected and threads selected
      if (cleanTagIds.length > 0 && selectedThreadIds.length > 0) {
        tagBulk.mutate({
          threadIds: selectedThreadIds,
          tagIds: cleanTagIds,
          // 'set' replaces all existing tags, 'add' appends
          // Decide which behavior is desired for bulk actions. 'Set' might be safer.
          operation: 'set',
        })
      } else {
        // Handle case where tags are cleared? Or assume 'set' with empty array handles removal?
        // Depending on API behavior, might need explicit 'remove' or 'set' with empty array.
        // Example: If clearing tags should remove all:
        // tagBulk.mutate({ threadIds: selectedThreadIds, tagIds: [], operation: 'set' });
        console.warn('No tags selected or no threads selected for tagging.')
      }
    },
    [selectedThreadIds, tagBulk]
  ) // Added dependencies

  const handleAssigneeChange = useCallback(
    (selectedAssignee: any | null) => {
      // AssigneePicker likely returns the user object or null
      const assigneeId = selectedAssignee && selectedAssignee.length && selectedAssignee[0].id

      if (selectedThreadIds.length > 0 && assigneeId) {
        assignBulk.mutate({ threadIds: selectedThreadIds, assigneeId })
      }
    },
    [selectedThreadIds, assignBulk]
  ) // Added dependencies

  const handlePermanentlyDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: `Permanently delete ${selectedThreadIds.length} threads?`,
      description:
        'This action cannot be undone. All selected threads and their messages will be permanently removed.',
      confirmText: 'Delete permanently',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deletePermanentlyBulk.mutate({ threadIds: selectedThreadIds })
    }
  }, [selectedThreadIds, deletePermanentlyBulk, confirm])

  /**
   * Component to display keyboard shortcuts alongside buttons.
   */
  const KeyboardShortcut = ({ shortcut }: { shortcut: string }) => (
    <span className="ml-auto pl-2 text-xs text-muted-foreground">{shortcut}</span>
  )

  const disabled = selectedThreadIds.length === 0

  return (
    <div className="flex h-full w-full items-center justify-center">
      <ConfirmDialog />
      <ActionBar
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClearSelection()
        }}>
        <ActionBarContent>
          <ActionBarText count={selectedThreadIds.length} label="items selected" />
          <ActionBarActions>
            <ActionBarActionItem tooltipText="Archive selected" asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => archiveBulk.mutate({ threadIds: selectedThreadIds })}
                disabled={archiveBulk.isPending || disabled}
                aria-label="Archive selected threads">
                <Archive />
                Archive
                <KeyboardShortcut shortcut="D" />
              </Button>
            </ActionBarActionItem>
            <ActionBarActionItem tooltipText="Move selected to trash" asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => moveToTrashBulk.mutate({ threadIds: selectedThreadIds })}
                disabled={moveToTrashBulk.isPending || disabled}
                aria-label="Move selected threads to trash">
                <Trash2 />
                Trash
              </Button>
            </ActionBarActionItem>
            <ActionBarActionItem tooltipText="Mark selected as spam" asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAsSpamBulk.mutate({ threadIds: selectedThreadIds })}
                disabled={markAsSpamBulk.isPending || disabled}
                aria-label="Mark selected threads as spam">
                <Ban />
                Spam
              </Button>
            </ActionBarActionItem>
            <ActionBarActionItem tooltipText="Apply tags" asChild>
              <Button
                ref={tagButtonRef}
                variant="outline"
                size="sm"
                onClick={() => setTagPickerOpen(true)}
                disabled={tagBulk.isPending || disabled}
                aria-label="Apply tags to selected threads">
                <Tags />
                Tags
              </Button>
            </ActionBarActionItem>
            <ActionBarActionItem tooltipText="Run workflow" asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsWorkflowDialogOpen(true)}
                disabled={disabled}
                aria-label="Run workflow on selected threads">
                <Play />
                Workflow
              </Button>
            </ActionBarActionItem>
            <ActionBarActionItem tooltipText="Assign to team member" asChild>
              <AssigneePicker
                onChange={handleAssigneeChange}
                placeholder="Assign"
                selected={undefined}
                disabled={assignBulk.isPending || disabled}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={assignBulk.isPending || disabled}
                  aria-label="Assign to team member">
                  <UserPlus />
                  Assign
                </Button>
              </AssigneePicker>
            </ActionBarActionItem>
            <ActionBarActionItem asChild>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="rounded-full"
                    disabled={deletePermanentlyBulk.isPending || disabled}
                    aria-label="More actions for selected threads">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handlePermanentlyDelete} variant="destructive">
                    <Trash />
                    Permanently delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ActionBarActionItem>
          </ActionBarActions>
        </ActionBarContent>
        <ActionBarClose />
      </ActionBar>

      {/* TagPicker Popover - Outside ActionBar to maintain tRPC context */}
      <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
        <PopoverTrigger asChild>
          <div
            style={{
              position: 'fixed',
              left: buttonRect?.left || 0,
              top: buttonRect?.top || 0,
              width: buttonRect?.width || 0,
              height: buttonRect?.height || 0,
              pointerEvents: 'none', // Make it invisible to clicks
              zIndex: -1, // Behind everything
            }}
          />
        </PopoverTrigger>
        <TagPicker
          open={tagPickerOpen}
          onOpenChange={setTagPickerOpen}
          selectedTags={selectedTags}
          onChange={handleTagChange}
          allowMultiple={true}
        />
      </Popover>

      {/* MassWorkflowTriggerDialog for bulk workflow trigger */}
      <MassWorkflowTriggerDialog
        open={isWorkflowDialogOpen}
        onOpenChange={setIsWorkflowDialogOpen}
        resourceType="thread"
        resourceIds={selectedThreadIds}
        onSuccess={() => {
          utils.thread.list.invalidate({ contextType, contextId, statusSlug, searchQuery })
        }}
      />

      <div className="flex flex-col items-center justify-center gap-4">
        {/* Selection Count Display */}
        <div className="flex items-center">
          <span className="text-md text-muted-foreground">
            <span className="font-semibold">{selectedThreadIds.length}</span> thread
            {selectedThreadIds.length !== 1 ? 's' : ''} selected
          </span>
        </div>

        {/* Clear/Select All Buttons */}
        <div className="flex items-center">
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            <XCircle />
            Clear
            <KeyboardShortcut shortcut="ESC" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// --- END OF FILE ~/components/mail/bulk-action-toolbar.tsx ---
