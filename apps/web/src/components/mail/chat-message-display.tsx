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

interface ChatMessageDisplayProps {
  /** Message ID to display */
  messageId: string
  /** Actions for this message (only delete/copy-id used) */
  messageActions: EmailActions
  /** Whether this message is the latest in the thread (unused for chat) */
  isOpen?: boolean
}

/**
 * Renders a chat message bubble. Plain-text content, sender avatar on the
 * appropriate side, and an outbound-only delivery/read receipt indicator.
 */
const ChatMessageDisplay = ({ messageId, messageActions }: ChatMessageDisplayProps) => {
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

  return (
    <div className='mt-2 flex flex-col'>
      <div className={cn('flex flex-row', isInbound ? 'justify-start' : 'justify-end')}>
        <div className={cn('mt-1 shrink-0', isInbound ? 'order-1' : 'order-3')}>
          <ContactHoverCard contactId={contactId ?? undefined}>
            <Avatar className='h-8 w-8'>
              <AvatarFallback className='bg-foreground/50 text-background hover:bg-foreground/70'>
                {senderInitials}
              </AvatarFallback>
              <AvatarImage src={sender?.avatarUrl ?? undefined} />
            </Avatar>
          </ContactHoverCard>
        </div>

        <div
          className={cn(
            'max-w-lg px-2',
            isInbound ? 'order-2 justify-self-start' : 'order-2 justify-self-end'
          )}>
          <div className='min-h-[40px] min-w-[120px] rounded-2xl border border-black/10 bg-background shadow-xs dark:bg-gray-500'>
            <div className='flex items-center justify-between'>
              <div className='truncate px-4 py-2'>
                <div className='flex items-center gap-2 text-sm text-gray-500'>
                  <div className='truncate font-medium text-gray-700'>{senderName}</div>
                  <SendStatusIndicator
                    status={message.sendStatus}
                    error={message.providerError}
                    attempts={message.attempts}
                  />
                </div>
              </div>
              <div className='pr-2 pt-2'>
                <ChatMessageDropdownMenu
                  message={message}
                  emailActions={messageActions}
                  onMarkUnread={markAsUnread}
                />
              </div>
            </div>

            <div className='px-4 pb-3'>
              <div className='cursor-text select-text whitespace-pre-wrap break-words text-sm leading-6 text-gray-700'>
                <span className='font-sans text-black'>{content}</span>
              </div>

              {!isInbound && <ReceiptIndicator message={message} />}
            </div>
          </div>
        </div>

        <div
          className={cn(
            'px-1 pt-4 text-xs font-normal uppercase text-gray-500',
            isInbound ? 'order-3' : 'order-1'
          )}>
          <Tooltip
            content={message.sentAt ? new Date(message.sentAt).toString() : ''}
            delayDuration={0}
            side='top'
            sideOffset={5}
            className='text-xs text-muted-foreground'>
            <span className='shrink-0 whitespace-nowrap'>
              {formatDistanceToNow(message.sentAt ? new Date(message.sentAt) : new Date(), {
                addSuffix: true,
              })}
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

export default ChatMessageDisplay

function ReceiptIndicator({ message }: { message: MessageMeta }) {
  if (message.sendStatus && message.sendStatus !== 'SENT') return null
  const readAt = message.readAt
  const deliveredAt = message.deliveredAt

  if (readAt) {
    return (
      <Tooltip content={`Read ${new Date(readAt).toLocaleString()}`}>
        <div className='mt-1 flex items-center justify-end gap-1 text-[10px] text-blue-500'>
          <CheckCheck className='h-3 w-3' />
          <span>Read</span>
        </div>
      </Tooltip>
    )
  }
  if (deliveredAt) {
    return (
      <Tooltip content={`Delivered ${new Date(deliveredAt).toLocaleString()}`}>
        <div className='mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground'>
          <CheckCheck className='h-3 w-3' />
          <span>Delivered</span>
        </div>
      </Tooltip>
    )
  }
  return (
    <div className='mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground'>
      <Check className='h-3 w-3' />
      <span>Sent</span>
    </div>
  )
}

function ChatMessageSkeleton() {
  return (
    <div className='mt-2 flex flex-col'>
      <div className='flex flex-row justify-start'>
        <Skeleton className='h-8 w-8 rounded-full mt-1' />
        <div className='max-w-lg px-2'>
          <div className='min-h-[40px] min-w-[120px] rounded-2xl border p-4 space-y-2'>
            <Skeleton className='h-3 w-20' />
            <Skeleton className='h-8 w-full' />
          </div>
        </div>
      </div>
    </div>
  )
}

function ChatMessageDropdownMenu({
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon'>
          <EllipsisVertical />
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
  )
}
