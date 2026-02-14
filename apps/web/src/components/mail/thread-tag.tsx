// src/components/mail/thread-tag.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { TagBadge } from '~/components/tags/ui/tag-badge'
import { TagDialog } from '~/components/tags/ui/tag-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface ThreadTagProps {
  /** The tag RecordId (format: "entityDefinitionId:instanceId") */
  tagId: RecordId
  /** The thread ID the tag is attached to */
  threadId: string
  /** Callback to remove this tag from the thread - passed from parent that manages tags */
  onRemove?: () => void
}

/**
 * Displays a single tag for a thread with dropdown actions
 */
export function ThreadTag({ tagId, threadId, onRemove }: ThreadTagProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const deleteRecord = api.record.delete.useMutation({
    onSuccess: () => {
      utils.record.listAll.invalidate({ entityDefinitionId: 'tag' })
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
    utils.record.listAll.invalidate({ entityDefinitionId: 'tag' })
  }

  /** Handles deleting the tag entirely (from all threads) */
  async function handleDeleteTag() {
    const confirmed = await confirm({
      title: 'Delete tag?',
      description:
        'This will permanently delete the tag from all threads and entities. This action cannot be undone.',
      confirmText: 'Delete Tag',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await deleteRecord.mutateAsync({ recordId: tagId })
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Use TagBadge for display - it reads from stores */}
          <div className='cursor-pointer'>
            <TagBadge
              recordId={tagId}
              size='sm'
              className='data-[state=open]:bg-accent data-[state=open]:text-accent-foreground'
            />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={handleRemoveFromThread}>Remove from thread</DropdownMenuItem>
          <DropdownMenuItem onClick={handleEdit}>
            <Pencil />
            Edit Tag
          </DropdownMenuItem>
          <DropdownMenuItem variant='destructive' onClick={handleDeleteTag}>
            <Trash2 />
            Delete Tag
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isEditDialogOpen && (
        <TagDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          recordId={tagId}
          onSaved={handleEditSuccess}
        />
      )}

      <ConfirmDialog />
    </>
  )
}
