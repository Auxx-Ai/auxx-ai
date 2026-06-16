// apps/web/src/components/mail/chat-panel/header.tsx
'use client'

import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowDownLeft, ArrowUpRight, MessageCircle, Minus, X } from 'lucide-react'
import type React from 'react'
import { useMessage, useMessageParticipants, useThread } from '~/components/threads/hooks'
import { asChatThreadMetadata } from '../chat-thread-metadata'

interface ChatPanelHeaderProps {
  threadId: string
  isDialogMode: boolean
  /** When omitted, the close (X) button is not rendered. */
  onClose?: () => void
  onPopOut?: () => void
  onMinimize?: () => void
  onDockBack?: () => void
  /** When set, the visitor info region becomes the drag handle. */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

/**
 * Header for the floating chat panel — visitor identity (avatar + name) on
 * the left, window controls on the right. Replaces the ChatComposer header
 * when the panel wraps the composer.
 */
export function ChatPanelHeader({
  threadId,
  isDialogMode,
  onClose,
  onPopOut,
  onMinimize,
  onDockBack,
  dragHandleProps,
}: ChatPanelHeaderProps) {
  const { thread } = useThread({ threadId })
  const { message: latestMessage } = useMessage({
    messageId: thread?.latestMessageId,
    enabled: !!thread?.latestMessageId,
  })
  const { from: latestFrom } = useMessageParticipants(latestMessage?.participants ?? [])

  const chatMetadata = asChatThreadMetadata(thread?.metadata)
  const visitorName =
    chatMetadata?.claimedVisitorName ||
    (latestMessage?.isInbound ? latestFrom?.displayName : undefined) ||
    'Visitor'
  const initials =
    (latestMessage?.isInbound ? latestFrom?.initials : undefined) ||
    visitorName.charAt(0).toUpperCase()

  return (
    <div className='flex h-[36px] items-center justify-between px-1'>
      <div
        {...dragHandleProps}
        className={cn(
          'flex flex-row items-center gap-2 overflow-y-auto no-scrollbar flex-1 min-w-0 h-full',
          dragHandleProps && 'cursor-grab active:cursor-grabbing',
          dragHandleProps?.className
        )}>
        <Avatar className='size-5'>
          <AvatarFallback className='text-[10px]'>{initials}</AvatarFallback>
        </Avatar>
        <span className='truncate text-sm font-medium'>{visitorName}</span>
        <MessageCircle size='12' className='text-muted-foreground' />
      </div>
      <div className=' flex flex-row items-center gap-0 relative z-10 shrink-0'>
        {!isDialogMode && onPopOut && (
          <Button
            size='icon-sm'
            variant='ghost'
            className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
            onClick={onPopOut}
            title='Pop out'>
            <ArrowUpRight />
          </Button>
        )}
        {isDialogMode && onDockBack && (
          <Button
            size='icon-sm'
            variant='ghost'
            className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
            onClick={onDockBack}
            title='Dock into thread'>
            <ArrowDownLeft />
          </Button>
        )}
        {isDialogMode && onMinimize && (
          <Button
            size='icon-sm'
            variant='ghost'
            className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
            onClick={onMinimize}
            title='Minimize'>
            <Minus />
          </Button>
        )}
        {onClose && (
          <Button
            size='icon-sm'
            variant='ghost'
            className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
            onClick={onClose}>
            <X />
          </Button>
        )}
      </div>
    </div>
  )
}
