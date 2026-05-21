// apps/web/src/components/mail/chat-message-display.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { Check, CheckCheck, CopyPlusIcon, EllipsisVertical, Mail, Trash } from 'lucide-react'
import { useMessage, useMessageParticipants, useThreadReadStatus } from '~/components/threads/hooks'
import type { MessageMeta } from '~/components/threads/store'
import { ContactHoverCard } from '../contacts/contact-hover-card'
import { Tooltip } from '../global/tooltip'
import type { EmailActions } from './email-actions'
import { SendStatusIndicator } from './send-status-indicator'

export type ChatGroupPosition = 'solo' | 'first' | 'middle' | 'last'

interface ChatMessageDisplayProps {
  /** Message ID to display */
  messageId: string
  /** Actions for this message (only delete/copy-id used) */
  messageActions: EmailActions
  /** Whether this message is the latest in the thread (unused for chat) */
  isOpen?: boolean
  /** Position within a same-sender run; defaults to 'solo' */
  groupPosition?: ChatGroupPosition
  /** Is the bubble directly above me currently expanded? */
  prevNeighborExpanded?: boolean
  /** Is the bubble directly below me currently expanded? */
  nextNeighborExpanded?: boolean
  /** Am I the popped-out bubble? */
  isExpanded?: boolean
  /** Toggle expansion (no-op when groupPosition === 'solo') */
  onToggle?: () => void
}

/**
 * Renders a chat message bubble in the Kopilot UserMessage style.
 * When part of a same-sender run, neighbouring bubbles share squared corners
 * and the header/footer are hoisted to the first/last bubble. Clicking a
 * non-solo bubble "pops" it: full rounding, vertical margin, and its own
 * header/footer become visible.
 */
const ChatMessageDisplay = ({
  messageId,
  messageActions,
  groupPosition = 'solo',
  prevNeighborExpanded = false,
  nextNeighborExpanded = false,
  isExpanded = false,
  onToggle,
}: ChatMessageDisplayProps) => {
  const { message, isLoading } = useMessage({ messageId })
  const { markAsUnread } = useThreadReadStatus(message?.threadId ?? null)
  const { from: sender } = useMessageParticipants(message?.participants ?? [])

  if (isLoading) return <ChatMessageSkeleton />
  if (!message) return null

  const isInbound = message.isInbound
  const senderName = sender?.displayName ?? 'Unknown'
  const senderInitials = sender?.initials ?? senderName.charAt(0).toUpperCase()
  const contactId = sender?.entityInstanceId
  const content = message.textPlain ?? message.snippet ?? ''
  const isSending = !!message.sendStatus && message.sendStatus !== 'SENT'

  const isGrouped = groupPosition !== 'solo'
  const isSoloLike = groupPosition === 'solo' || isExpanded
  const topRound = isSoloLike || groupPosition === 'first' || prevNeighborExpanded
  const bottomRound = isSoloLike || groupPosition === 'last' || nextNeighborExpanded
  const showHeader = isInbound && (isSoloLike || groupPosition === 'first')
  const showFooter = isSoloLike || groupPosition === 'last'

  const handleBubbleClick = () => {
    if (!isGrouped) return
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (sel && sel.toString().length > 0) return
    onToggle?.()
  }

  return (
    <div
      className={cn(
        'group/message flex w-full flex-col gap-1',
        isInbound ? 'items-start' : 'items-end'
      )}>
      {showHeader && (
        <div className='flex items-center gap-2 pl-1'>
          <ContactHoverCard contactId={contactId ?? undefined}>
            <Avatar className='size-4 rounded-full'>
              <AvatarFallback className='bg-foreground/50 text-[8px] text-background hover:bg-foreground/70'>
                {senderInitials}
              </AvatarFallback>
              <AvatarImage src={sender?.avatarUrl ?? undefined} />
            </Avatar>
          </ContactHoverCard>
          <span className='text-xs font-medium text-foreground'>{senderName}</span>
        </div>
      )}
      <div className='relative w-full'>
        <div
          onClick={handleBubbleClick}
          className={cn(
            'w-full border border-transparent px-3 py-2 text-sm/5 shadow transition-all duration-300',
            isGrouped && 'cursor-pointer',
            isInbound
              ? 'bg-illustration text-foreground ring-border-illustration shadow-black/10 ring-1'
              : 'bg-primary text-primary-foreground inset-ring-foreground/10 inset-ring-1 shadow-black/15',
            topRound ? 'rounded-t-2xl' : 'rounded-t-sm',
            bottomRound ? 'rounded-b-2xl' : 'rounded-b-sm'
          )}>
          <div className='cursor-text select-text whitespace-pre-wrap break-words font-sans'>
            {content}
          </div>
        </div>
        <FloatingDropdown
          message={message}
          emailActions={messageActions}
          onMarkUnread={markAsUnread}
        />
      </div>
      {showFooter && (
        <div className='flex items-center gap-2 px-1'>
          <TimestampLabel sentAt={message.sentAt} />
          {!isInbound &&
            (isSending ? (
              <SendStatusIndicator
                status={message.sendStatus}
                error={message.providerError}
                attempts={message.attempts}
              />
            ) : (
              <ReceiptIndicator message={message} />
            ))}
        </div>
      )}
    </div>
  )
}

export default ChatMessageDisplay

function TimestampLabel({
  sentAt,
  className,
}: {
  sentAt: Date | string | null
  className?: string
}) {
  const date = sentAt ? new Date(sentAt) : new Date()
  return (
    <Tooltip
      content={sentAt ? date.toString() : ''}
      delayDuration={0}
      side='top'
      sideOffset={5}
      className='text-xs text-muted-foreground'>
      <span
        className={cn('shrink-0 whitespace-nowrap text-[10px] text-muted-foreground', className)}>
        {formatDistanceToNow(date, { addSuffix: true })}
      </span>
    </Tooltip>
  )
}

function ReceiptIndicator({ message }: { message: MessageMeta }) {
  if (message.sendStatus && message.sendStatus !== 'SENT') return null
  const readAt = message.readAt
  const deliveredAt = message.deliveredAt

  if (readAt) {
    return (
      <Tooltip content={`Read ${new Date(readAt).toLocaleString()}`}>
        <div className='flex items-center gap-1 text-[10px] text-blue-500'>
          <CheckCheck className='h-3 w-3' />
          <span>Read</span>
        </div>
      </Tooltip>
    )
  }
  if (deliveredAt) {
    return (
      <Tooltip content={`Delivered ${new Date(deliveredAt).toLocaleString()}`}>
        <div className='flex items-center gap-1 text-[10px] text-muted-foreground'>
          <CheckCheck className='h-3 w-3' />
          <span>Delivered</span>
        </div>
      </Tooltip>
    )
  }
  return (
    <div className='flex items-center gap-1 text-[10px] text-muted-foreground'>
      <Check className='h-3 w-3' />
      <span>Sent</span>
    </div>
  )
}

function ChatMessageSkeleton() {
  return (
    <div className='mx-auto flex w-full max-w-2xl flex-col items-start gap-1'>
      <div className='flex items-center gap-2 pl-1'>
        <Skeleton className='size-4 rounded-full' />
        <Skeleton className='h-3 w-24' />
      </div>
      <div className='w-3/5 space-y-2 rounded-2xl rounded-tl bg-muted/40 px-3 py-2'>
        <Skeleton className='h-3 w-full' />
        <Skeleton className='h-3 w-2/3' />
      </div>
    </div>
  )
}

function FloatingDropdown({
  message,
  emailActions,
  onMarkUnread,
}: {
  message: MessageMeta
  emailActions: EmailActions
  onMarkUnread: () => void
}) {
  const handleSelect = (action: (msg: any) => void) => () => {
    action(message)
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className='absolute -right-2 -top-2 opacity-0 transition-opacity group-hover/message:opacity-100'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-6 rounded-full border border-border bg-background shadow-sm'>
            <EllipsisVertical className='size-3' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-56'>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onMarkUnread}>
              <Mail className='opacity-60' />
              Mark as unread
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleSelect(emailActions.onDelete)} variant='destructive'>
              <Trash className='opacity-60' />
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleSelect(emailActions.onCopyId)}>
            <CopyPlusIcon className='opacity-60' />
            Copy Message ID
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
