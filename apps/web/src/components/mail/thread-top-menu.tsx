import React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { Button } from '@auxx/ui/components/button'
import {
  Archive,
  ArchiveX,
  // Clock,
  Forward,
  MoreVertical,
  Reply,
  ReplyAll,
  Trash2,
} from 'lucide-react'
import { Separator } from '@auxx/ui/components/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'

import { RouterOutputs } from '~/server/api/root'
import { api } from '~/trpc/react'
type Thread = RouterOutputs['mail']['getThreadById']

type Props = { thread: Thread | null }

type Action = 'archive' | 'spam' | 'delete' | 'markRead' | 'markUnread' | 'star' | 'unstar'

export default function ThreadTopMenu({ thread }: Props) {
  // const today = new Date()

  // const performAction = api.mail.performAction.useMutation()

  async function handleAction(action: Action) {
    if (!thread) return
    // const result = await performAction.mutateAsync({
    //   threadId: thread.id,
    //   action,
    // })
  }

  return (
    <div className="flex items-center bg-slate-50 p-2 dark:bg-black">
      {/* Left side buttons */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={!thread}
              onClick={() => handleAction('archive')}>
              <Archive className="h-4 w-4" />
              <span className="sr-only">Archive</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Archive</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" disabled={!thread}>
              <ArchiveX className="h-4 w-4" />
              <span className="sr-only">Move to junk</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Move to junk</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" disabled={!thread}>
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Move to trash</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Move to trash</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="mx-1 h-6" />
      </div>
      {/* Right side buttons */}
      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" disabled={!thread}>
              <Reply className="h-4 w-4" />
              <span className="sr-only">Reply</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reply</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" disabled={!thread}>
              <ReplyAll className="h-4 w-4" />
              <span className="sr-only">Reply all</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reply all</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" disabled={!thread}>
              <Forward className="h-4 w-4" />
              <span className="sr-only">Forward</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Forward</TooltipContent>
        </Tooltip>
      </div>
      <Separator orientation="vertical" className="mx-2 h-6" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={!thread}>
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">More</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem>Mark as unread</DropdownMenuItem>
          <DropdownMenuItem>Star thread</DropdownMenuItem>
          <DropdownMenuItem>Add label</DropdownMenuItem>
          <DropdownMenuItem>Mute thread</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
