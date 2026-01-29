// src/components/mail/thread-header.tsx
'use client'
import { useState, useRef } from 'react'
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
import { AssigneePicker } from '../pickers/assignee-picker'
import { useThreadContext, useThreadTags } from './thread-provider'
import { useThread, useInboxById } from '~/components/threads/hooks'
import { useActor } from '~/components/resources/hooks/use-actor'
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
import type { ActorId as ActorIdString } from '@auxx/types/actor'

/**
 * Header component for thread details with thread actions
 */
export function ThreadHeader({
  onMarkDone,
  onMarkTrash,
  onMarkSpam,
  onInboxChange,
  onAssigneeChange,
  onSubjectChange,
  onPermanentlyDelete,
  // onRule,
}: {
  onMarkDone: () => void
  onMarkTrash: () => void
  onMarkSpam: () => void
  onInboxChange: (inbox: string[]) => void
  onAssigneeChange: (assignee: any[] | null) => void
  onSubjectChange: (subject: string) => void
  onPermanentlyDelete?: () => void
  // onRule: () => void
}) {
  // Get threadId and handlers from context
  const { threadId, handlers } = useThreadContext()
  const { selectedTags, availableTags, updateTags } = useThreadTags()

  // Get thread data from store
  const { thread } = useThread({ threadId })

  // Get inbox details
  const { inbox } = useInboxById(thread?.inboxId)

  // Get assignee details via actor store
  // Convert ActorId object to string format expected by useActor (e.g., 'user:abc123')
  const assigneeActorId: ActorIdString | null = thread?.assigneeId
    ? (`${thread.assigneeId.type}:${thread.assigneeId.id}` as ActorIdString)
    : null
  const { actor: assignee } = useActor({ actorId: assigneeActorId })

  // Derive state
  const isDone = thread?.status === 'ARCHIVED'

  // Local state for tag popover
  const [open, setOpen] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)

  if (!thread) return null
  const fetchedTagsData = availableTags

  return (
    <>
      <div className="flex items-center px-4 py-2 sticky inset-x-0 top-0 z-1 bg-secondary dark:bg-primary-100 pb-3 mask-b-from-80% mask-b-to-100% w-full">
        <div className="flex  w-full justify-between shrink-0 overflow-x-auto no-scrollbar ">
          <div className="flex shrink-0 items-start pt-0.5 ps-0.5">
            <InboxPicker
              onChange={onInboxChange}
              selected={thread.inboxId ? [thread.inboxId] : undefined}
              allowMultiple={false}>
              <Badge
                variant="blue"
                className="cursor-pointer data-[state=open]:brightness-90 shrink-0 text-nowrap rounded-full">
                {inbox?.name || 'Loading...'}
              </Badge>
            </InboxPicker>
          </div>
          <div className=" flex items-center ">
            <Tooltip content={isDone ? 'Unarchive' : 'Archive'}>
              <Button
                variant="ghost"
                size="icon"
                disabled={!thread}
                onClick={onMarkDone}
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
                onClick={onMarkTrash}
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
                onClick={onMarkSpam}
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
                onChange={updateTags}
                allowMultiple={true}
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

            <AssigneePicker
              key={`assignee-${thread.id}`}
              onChange={onAssigneeChange}
              placeholder="Assign"
              selected={assignee || undefined}>
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
            </AssigneePicker>

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
                {onPermanentlyDelete && (
                  <>
                    <DropdownMenuItem onClick={onPermanentlyDelete} variant="destructive">
                      <Trash />
                      Permanently delete
                    </DropdownMenuItem>
                  </>
                )}
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
              onSave={onSubjectChange}
            />
          </div>
          {fetchedTagsData && fetchedTagsData.length > 0 && (
            <div className="flex flex-row no-wrap gap-2 shrink-0">
              {fetchedTagsData.map((tag) => (
                <ThreadTag tag={tag} threadId={threadId} key={tag.id} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
