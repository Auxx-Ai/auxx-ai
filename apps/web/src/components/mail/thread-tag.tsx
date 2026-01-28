// src/components/mail/thread-tag.tsx
'use client'

import { useState } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { api } from '~/trpc/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { TagFormDialog } from '~/app/(protected)/app/settings/tags/_components/tags-form'
import { useConfirm } from '~/hooks/use-confirm'
import { Pencil, Trash2 } from 'lucide-react'
import { toastError } from '@auxx/ui/components/toast'
import type { ThreadTagSummary } from '~/components/threads/store'

/**
 * Displays a single tag for a thread with dropdown actions
 * @param tag The tag summary object (flat structure from store)
 * @param threadId The thread ID the tag is attached to
 */
export function ThreadTag({ tag, threadId }: { tag: ThreadTagSummary; threadId: string }) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const untagEntity = api.tag.untagEntity.useMutation({
    onSuccess: () => {
      utils.tag.getEntityTags.invalidate({ entityId: threadId, entityType: 'thread' })
    },
  })

  const deleteTag = api.tag.delete.useMutation({
    onSuccess: () => {
      utils.tag.getHierarchy.invalidate()
      utils.tag.getEntityTags.invalidate({ entityId: threadId, entityType: 'thread' })
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete tag',
        description: error.message,
      })
    },
  })

  function handleEdit() {
    setIsEditDialogOpen(true)
  }

  function handleEditSuccess() {
    utils.tag.getEntityTags.invalidate({ entityId: threadId, entityType: 'thread' })
    utils.tag.getHierarchy.invalidate()
  }

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
      await deleteTag.mutateAsync({ id: tag.id })
    }
  }

  async function handleRemoveFromThread() {
    await untagEntity.mutateAsync({ entityId: threadId, entityType: 'thread', tagId: tag.id })
  }

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
          <DropdownMenuItem onClick={() => handleRemoveFromThread()} className="">
            Remove from thread
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleEdit()}>
            <Pencil />
            Edit Tag
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => handleDeleteTag()}>
            <Trash2 />
            Delete Tag
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TagFormDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        editingTag={tag}
        onSuccess={handleEditSuccess}
      />

      <ConfirmDialog />
    </>
  )
}
