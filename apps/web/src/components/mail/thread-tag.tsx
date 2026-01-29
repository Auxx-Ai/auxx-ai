// src/components/mail/thread-tag.tsx
'use client'

import { useState } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { api } from '~/trpc/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { TagDialog } from '~/components/tags/ui/tag-dialog'
import { useTagHierarchy } from '~/components/tags/hooks/use-tag-hierarchy'
import { useConfirm } from '~/hooks/use-confirm'
import { Pencil, Trash2 } from 'lucide-react'
import { toastError } from '@auxx/ui/components/toast'
import { toRecordId } from '@auxx/lib/resources/client'
import type { ThreadTagSummary } from '~/components/threads/store'

interface ThreadTagProps {
  /** The tag summary object (flat structure from store) */
  tag: ThreadTagSummary
  /** The thread ID the tag is attached to */
  threadId: string
  /** Callback to remove this tag from the thread - passed from parent that manages tags */
  onRemove?: () => void
}

/**
 * Displays a single tag for a thread with dropdown actions
 */
export function ThreadTag({ tag, threadId, onRemove }: ThreadTagProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { entityDefinitionId, refresh } = useTagHierarchy()

  const deleteRecord = api.record.delete.useMutation({
    onSuccess: () => {
      refresh()
      utils.thread.getById.invalidate({ threadId })
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete tag',
        description: error.message,
      })
    },
  })

  /** Opens the edit tag dialog */
  function handleEdit() {
    setIsEditDialogOpen(true)
  }

  /** Called when tag edit is successful */
  function handleEditSuccess() {
    refresh()
    utils.thread.getById.invalidate({ threadId })
  }

  /** Handles deleting the tag entirely (from all threads) */
  async function handleDeleteTag() {
    if (!entityDefinitionId) return

    const confirmed = await confirm({
      title: 'Delete tag?',
      description:
        'This will permanently delete the tag from all threads and entities. This action cannot be undone.',
      confirmText: 'Delete Tag',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await deleteRecord.mutateAsync({
        entityDefinitionId,
        entityInstanceId: tag.id,
      })
    }
  }

  /** Handles removing this tag from the current thread only */
  function handleRemoveFromThread() {
    if (onRemove) {
      onRemove()
    } else {
      console.warn('ThreadTag: onRemove callback not provided, cannot remove tag from thread')
    }
  }

  // Build recordId for tag dialog
  const recordId = entityDefinitionId ? toRecordId(entityDefinitionId, tag.id) : undefined

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div
            className={cn(
              'flex cursor-pointer items-center gap-1 overflow-hidden whitespace-nowrap rounded-[5px] border border-foreground/20 px-[3px] py-px text-xs',
              'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground'
            )}>
            {tag.emoji} {tag.title}
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleRemoveFromThread}>Remove from thread</DropdownMenuItem>
          <DropdownMenuItem onClick={handleEdit}>
            <Pencil />
            Edit Tag
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={handleDeleteTag}>
            <Trash2 />
            Delete Tag
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TagDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        recordId={recordId}
        onSaved={handleEditSuccess}
      />

      <ConfirmDialog />
    </>
  )
}
