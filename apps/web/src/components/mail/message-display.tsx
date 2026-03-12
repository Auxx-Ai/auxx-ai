// apps/web/src/components/mail/message-display.tsx
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
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import {
  Code,
  CopyPlusIcon,
  Download,
  EllipsisVertical,
  Forward,
  Mail,
  Printer,
  Reply,
  ReplyAll,
  Send,
  Trash,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Letter } from 'react-letter'
import { useMessage, useMessageParticipants, useThreadReadStatus } from '~/components/threads/hooks'
import type { MessageMeta } from '~/components/threads/store'
import { api } from '~/trpc/react'
import { ContactHoverCard } from '../contacts/contact-hover-card'
import { Tooltip } from '../global/tooltip'
import type { EmailActions } from './email-actions'
import { SendStatusIndicator } from './send-status-indicator'
import { resolveInlineEmailHtml } from './utils/resolve-inline-email-html'

interface MessageDisplayProps {
  /** Message ID to display */
  messageId: string
  /** Actions for this message */
  messageActions: EmailActions
  /** Whether message is expanded by default */
  isOpen: boolean
}

/**
 * Displays a non-email message (chat bubble style).
 * Fetches its own data from stores.
 */
const MessageDisplay = ({ messageId, messageActions, isOpen }: MessageDisplayProps) => {
  const [selected, setSelected] = useState(false)
  const utils = api.useUtils()

  // Fetch message from store
  const { message, isLoading } = useMessage({ messageId })

  // Get read status mutation for this thread
  const { markAsUnread } = useThreadReadStatus(message?.threadId ?? null)

  // Fetch sender participant using the new hook
  const { from: sender } = useMessageParticipants(message?.participants ?? [])

  // Retry send mutation
  const retrySendMessage = api.thread.retrySendMessage.useMutation({
    onError: (error) => {
      toastError({
        title: 'Failed to retry sending',
        description: error.message,
      })
    },
  })

  const handleRetry = useCallback(() => {
    if (message) {
      retrySendMessage.mutate({ messageId: message.id })
    }
  }, [message, retrySendMessage])

  const resolvedHtml = useMemo(
    () => resolveInlineEmailHtml(message?.textHtml, message?.attachments ?? []),
    [message?.attachments, message?.textHtml]
  )

  // Get message content based on available fields
  const getContent = useCallback(() => {
    if (!message) return ''
    if (resolvedHtml) {
      return <Letter className={cn('bg-background p-4 text-foreground')} html={resolvedHtml} />
    }
    if (message.textPlain) {
      return message.textPlain
    }
    if (message.snippet) {
      return message.snippet
    }
    return <Letter className='' html={'<i>No content</i>'} />
  }, [message, resolvedHtml])

  // Loading state
  if (isLoading) {
    return <MessageSkeleton />
  }

  // Message not found
  if (!message) {
    return null
  }

  const isInbound = message.isInbound
  const senderName = sender?.displayName ?? 'Unknown'
  const senderInitials = sender?.initials ?? senderName.charAt(0).toUpperCase()
  const contactId = sender?.entityInstanceId

  return (
    <div className='mt-2 flex flex-col'>
      <div
        className={cn('flex flex-row', isInbound ? 'justify-start' : 'justify-end')}
        onClick={() => setSelected(!selected)}>
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
          <div className='min-h-[70px] min-w-[192px] rounded-2xl border border-black/10 bg-background shadow-xs dark:bg-gray-500'>
            <div className='flex items-center justify-between'>
              <div className='truncate px-4 py-2'>
                <div className='flex items-center gap-2 text-sm text-gray-500'>
                  <div className='truncate font-medium text-gray-700'>{senderName}</div>
                  <SendStatusIndicator
                    status={message.sendStatus}
                    error={message.providerError}
                    attempts={message.attempts}
                    onRetry={handleRetry}
                  />
                </div>
              </div>
              <div className='pr-2 pt-2'>
                <div className='flex items-center'>
                  <MessageDropdownMenu
                    message={message}
                    emailActions={messageActions}
                    onMarkUnread={markAsUnread}
                  />
                </div>
              </div>
            </div>

            <div className='px-4 pb-3'>
              <div className='flex-1 overflow-auto'>
                <div className='cursor-text select-text text-sm leading-6 text-gray-700'>
                  <div className='break-words font-sans text-black'>{getContent()}</div>
                </div>
              </div>
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

export default MessageDisplay

/**
 * Loading skeleton for message display.
 */
function MessageSkeleton() {
  return (
    <div className='mt-2 flex flex-col'>
      <div className='flex flex-row justify-start'>
        <Skeleton className='h-8 w-8 rounded-full mt-1' />
        <div className='max-w-lg px-2'>
          <div className='min-h-[70px] min-w-[192px] rounded-2xl border p-4 space-y-2'>
            <Skeleton className='h-4 w-24' />
            <Skeleton className='h-12 w-full' />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Dropdown menu for message actions.
 */
function MessageDropdownMenu({
  message,
  emailActions,
  onMarkUnread,
}: {
  message: MessageMeta
  emailActions: EmailActions
  onMarkUnread: () => void
}) {
  const handleSelect = (action: (msg: any) => void) => (event?: Event) => {
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
          <DropdownMenuItem onSelect={handleSelect(emailActions.onReply)}>
            <Reply className='opacity-60' />
            Reply
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onReplyAll)}>
            <ReplyAll className='opacity-60' />
            Reply all
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onForward)}>
            <Forward className='opacity-60' />
            Forward
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onResend)}>
            <Send className='opacity-60' />
            Resend
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onMarkUnread}>
            <Mail className='opacity-60' />
            Mark as unread
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onDelete)} variant='destructive'>
            <Trash className='opacity-60' />
            Delete
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onDownload)}>
            <Download className='opacity-60' />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onPrint)}>
            <Printer className='opacity-60' />
            Print
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSelect(emailActions.onCopyId)}>
          <CopyPlusIcon className='opacity-60' />
          Copy Message ID
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleSelect(emailActions.onViewSource)}>
          <Code className='opacity-60' />
          View Source
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
