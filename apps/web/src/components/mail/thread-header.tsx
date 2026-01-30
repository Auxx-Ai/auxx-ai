// src/components/mail/thread-header.tsx
'use client'

import { useState, useRef, useCallback } from 'react'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EditableText } from '../editor/editable-text'
import { Tooltip } from '../global/tooltip'
import {
  MailWarning,
  Tags,
  Trash,
  MoreHorizontal,
  Zap,
  Archive,
  PackageOpen,
  UserPlus,
} from 'lucide-react'
import { InboxPicker } from '../pickers/inbox-picker'
import { TagPicker } from '../pickers/tag-picker'
import { ActorPicker } from '../pickers/actor-picker'
import { useThreadContext } from './thread-provider'
import { useThreadTags } from '~/components/tags/hooks/use-thread-tags'
import { useThread, useInbox } from '~/components/threads/hooks'
import { useActor, useResource } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ThreadTag } from './thread-tag'
import { ManualTriggerButton } from '~/components/workflow/manual-trigger-button'
import { toRecordId } from '@auxx/types/resource'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import type { ActorId, ActorId as ActorIdString } from '@auxx/types/actor'
import { RecordBadge } from '../resources/ui'

/**
 * Header component for thread details with thread actions.
 * Uses ThreadContext for all mutations - no props needed.
 */
export function ThreadHeader() {
  const [confirm, ConfirmDialog] = useConfirm()

  // Get context for mutations and handlers
  const { threadId, handlers, mutations } = useThreadContext()
  const { selectedTags, handleTagChange } = useThreadTags(threadId)

  // Get thread data from store
  const { thread } = useThread({ threadId })

  // Get inbox details - thread.inboxId is now RecordId, direct lookup works
  const { inbox } = useInbox(thread?.inboxId)
  // Get tag entity definition ID for TagPicker RecordId integration
  const { resource: tagResource } = useResource('tag')
  const tagEntityDefId = tagResource?.entityDefinitionId ?? undefined

  // Get assignee details via actor store
  // Convert ActorId object to string format expected by useActor (e.g., 'user:abc123')

  const { actor: assignee } = useActor({ actorId: thread?.assigneeId })

  // Convert to ActorPicker value format
  const assigneeValue: ActorId[] = thread?.assigneeId ? [thread?.assigneeId] : []

  // Derive state
  const isDone = thread?.status === 'ARCHIVED'
  const isTrash = thread?.status === 'TRASH'

  // Local state for tag popover
  const [open, setOpen] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)

  // --- Handlers ---

  /**
   * Handle archive/unarchive toggle
   */
  const handleMarkDone = useCallback(async () => {
    if (!thread) return
    await handlers.updateStatus(!isDone)
  }, [thread, isDone, handlers])

  /**
   * Handle move to trash with confirmation
   */
  const handleMarkTrash = useCallback(async () => {
    if (!thread) return

    const confirmed = await confirm({
      title: 'Move to trash?',
      description: 'This thread will be moved to trash. You can restore it later if needed.',
      confirmText: 'Move to trash',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await mutations.moveToTrash()
        toastSuccess({ title: 'Thread moved to trash' })
      } catch (error) {
        toastError({ title: 'Failed to move thread to trash' })
      }
    }
  }, [thread, mutations, confirm])

  /**
   * Handle mark as spam with confirmation
   */
  const handleMarkSpam = useCallback(async () => {
    if (!thread) return

    const confirmed = await confirm({
      title: 'Mark as spam?',
      description: 'This thread will be marked as spam and moved to the spam folder.',
      confirmText: 'Mark as spam',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await mutations.markAsSpam()
        toastSuccess({ title: 'Thread marked as spam' })
      } catch (error) {
        toastError({ title: 'Failed to mark thread as spam' })
      }
    }
  }, [thread, mutations, confirm])

  /**
   * Handle inbox change
   */
  const handleInboxChange = useCallback(
    async (selectedInboxIds: string[]) => {
      if (!thread) return
      const targetInboxId = selectedInboxIds?.[0]
      if (!targetInboxId || targetInboxId === thread.inboxId) {
        return
      }
      await handlers.moveToInbox(targetInboxId)
    },
    [thread, handlers]
  )

  /**
   * Handle assignee change from ActorPicker
   */
  const handleAssigneeChange = useCallback(
    (actorIds: ActorId[]) => {
      const actorId = actorIds.length > 0 ? actorIds[0] : null
      handlers.updateAssignee(actorId)
    },
    [handlers]
  )

  /**
   * Handle subject change
   */
  const handleSubjectChange = useCallback(
    async (newSubject: string) => {
      if (!thread) return
      const trimmedSubject = newSubject.trim()
      if (thread.subject === trimmedSubject || !trimmedSubject) {
        return
      }
      await handlers.updateSubject(trimmedSubject)
    },
    [thread, handlers]
  )

  /**
   * Handle permanent deletion with confirmation
   */
  const handlePermanentlyDelete = useCallback(async () => {
    if (!thread) return

    const confirmed = await confirm({
      title: 'Permanently delete thread?',
      description:
        'This action cannot be undone. The thread and all its messages will be permanently removed.',
      confirmText: 'Delete permanently',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await mutations.deletePermanently()
      } catch (error) {
        toastError({ title: 'Failed to delete thread' })
      }
    }
  }, [thread, mutations, confirm])

  if (!thread) return null

  return (
    <>
      <ConfirmDialog />
      <div className="flex items-center px-4 py-2 sticky inset-x-0 top-0 z-1 bg-secondary dark:bg-primary-100 pb-3 mask-b-from-80% mask-b-to-100% w-full">
        <div className="flex  w-full justify-between shrink-0 overflow-x-auto no-scrollbar ">
          <div className="flex shrink-0 items-start pt-0.5 ps-0.5">
            <InboxPicker
              onChange={handleInboxChange}
              selected={thread?.inboxId ? [thread.inboxId] : undefined}
              allowMultiple={false}>
              <RecordBadge recordId={thread?.inboxId} size="sm" className="me-2" />
              {/* <Badge
                variant="blue"
                className="cursor-pointer data-[state=open]:brightness-90 shrink-0 text-nowrap rounded-full">
                {inbox?.name || 'Loading...'}
              </Badge> */}
            </InboxPicker>
          </div>
          <div className=" flex items-center ">
            <Tooltip content={isDone ? 'Unarchive' : 'Archive'}>
              <Button
                variant="ghost"
                size="icon"
                disabled={!thread}
                onClick={handleMarkDone}
                className="rounded-full hover:bg-foreground/10">
                {isDone ? <PackageOpen /> : <Archive />}
                <span className="sr-only">Mark done/undone</span>
              </Button>
            </Tooltip>

            <Tooltip content="Trash Thread">
              <Button
                variant="ghost"
                size="icon"
                disabled={!thread}
                onClick={handleMarkTrash}
                className="rounded-full hover:bg-foreground/10">
                <Trash />
                <span className="sr-only">Delete</span>
              </Button>
            </Tooltip>
            <Tooltip content="Mark as spam">
              <Button
                variant="ghost"
                size="icon"
                disabled={!thread}
                onClick={handleMarkSpam}
                className="rounded-full hover:bg-foreground/10">
                <MailWarning />
                <span className="sr-only">Mark as spam</span>
              </Button>
            </Tooltip>

            <Tooltip content="Apply Tags">
              <Button
                ref={tagButtonRef}
                variant="ghost"
                size="icon"
                disabled={!thread}
                onClick={() => setOpen(true)}
                className="rounded-full hover:bg-foreground/10">
                <Tags />
                <span className="sr-only">Add Tags</span>
              </Button>
            </Tooltip>
            {open && (
              <TagPicker
                open={open}
                onOpenChange={setOpen}
                anchorRef={tagButtonRef}
                selectedTags={selectedTags}
                onChange={handleTagChange}
                allowMultiple={true}
                tagEntityDefinitionId={tagEntityDefId}
              />
            )}
            <ManualTriggerButton recordId={toRecordId('thread', thread.id)}>
              <Tooltip content="Run workflow">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!thread}
                  className="rounded-full hover:bg-foreground/10">
                  <Zap />
                  <span className="sr-only">Run workflow</span>
                </Button>
              </Tooltip>
            </ManualTriggerButton>

            <ActorPicker
              key={`assignee-${thread.id}`}
              value={assigneeValue}
              onChange={handleAssigneeChange}
              multi={false}
              target="user"
              emptyLabel="Assign">
              <div>
                <Tooltip content={assignee ? assignee.name || 'Assigned' : 'Assign'}>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!thread}
                    className="rounded-full hover:bg-foreground/10">
                    {assignee ? (
                      <Avatar className="size-6">
                        <AvatarImage
                          src={assignee.image || undefined}
                          alt={assignee.name || 'Assignee'}
                        />
                        <AvatarFallback className="text-xs">
                          {assignee.name
                            ?.split(' ')
                            .map((n) => n[0])
                            .join('')
                            .toUpperCase()
                            .substring(0, 2) || '?'}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <UserPlus />
                    )}
                    <span className="sr-only">Assign</span>
                  </Button>
                </Tooltip>
              </div>
            </ActorPicker>

            {/* More actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!thread}
                  className="ml-2 rounded-full hover:bg-foreground/10">
                  <MoreHorizontal />
                  <span className="sr-only">More actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handlePermanentlyDelete} variant="destructive">
                  <Trash />
                  Permanently delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      <div className="position-relative flex flex-wrap items-center px-4  ">
        {/* Tag list */}

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <div className="p-1">
            <EditableText
              key={`editable-${thread.id}`}
              initialText={thread.subject}
              onSave={handleSubjectChange}
            />
          </div>
          {thread.tagIds && thread.tagIds.length > 0 && (
            <div className="flex flex-row no-wrap gap-2 shrink-0">
              {thread.tagIds.map((tagId) => (
                <ThreadTag
                  tagId={tagId}
                  threadId={threadId}
                  key={tagId}
                  onRemove={() => {
                    // Remove this tag from the current tags list
                    const newTagIds = selectedTags.filter((id) => id !== tagId)
                    handleTagChange(newTagIds)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
