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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Letter } from 'react-letter'
import {
  useMessage,
  useMessageParticipants,
  useThread,
  useThreadReadStatus,
} from '~/components/threads/hooks'
import type { MessageMeta } from '~/components/threads/store'
import { api } from '~/trpc/react'
import { ContactHoverCard } from '../contacts/contact-hover-card'
import { Tooltip } from '../global/tooltip'
import type { EmailActions } from './email-actions'
import type { MessageType } from './email-editor/types'
import { useHtmlBody } from './hooks/use-html-body'
import { useRetrySend } from './hooks/use-retry-send'
import { SendStatusIndicator } from './send-status-indicator'
import { supportsRichText } from './utils/channel-rich-text'
import { initialsFor } from './utils/participant-initials'
import { resolveInlineEmailHtml } from './utils/resolve-inline-email-html'
import { SandboxedEmailHtml } from './utils/sandboxed-email-html'
import { toEditorMessage } from './utils/to-editor-message'

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

  // Resolve the thread only for its channel provider — a plain-text channel
  // must never be routed through the HTML sandbox.
  //
  // `integrationProvider` is declared `ChannelProvider` ('GMAIL' | 'OUTLOOK' | …)
  // but carries the raw lowercase `Integration.provider` column; the cast
  // matches the runtime value and the sibling checks in `use-reply-box.tsx`.
  const { thread } = useThread({
    threadId: message?.threadId ?? null,
    enabled: !!message?.threadId,
  })
  const isRichTextChannel = supportsRichText(
    thread?.integrationProvider as string | null | undefined
  )

  // Get read status mutation for this thread
  const { markAsUnread } = useThreadReadStatus(message?.threadId ?? null)

  // Fetch sender participant using the new hook
  const { from: sender, to, cc } = useMessageParticipants(message?.participants ?? [])

  // The editor-shaped view of this message, for the reply/forward actions.
  //
  // `EmailDisplay` has always built this; the chat-bubble renderer passed the
  // raw `MessageMeta` straight through instead, and `deriveInitialState` reads
  // `sourceMessage.from` — a field `MessageMeta` does not have. So replying to
  // any non-email message produced a composer with no recipient, no subject and
  // no quoted body. Same shape, same helper, one source of truth.
  const editorMessage: MessageType | null = useMemo(
    () => (message ? toEditorMessage(message, { from: sender, to, cc }) : null),
    [message, sender, to, cc]
  )

  const { retry, isRetrying } = useRetrySend(message?.id)

  // Determine whether HTML is available inline or needs lazy fetch
  const hasInlineHtml = !!message?.textHtml
  const hasObjectBackedHtml = !hasInlineHtml && !!message?.hasHtmlBody

  const { html: fetchedHtml, isLoading: isHtmlLoading, fetchHtml } = useHtmlBody(messageId)

  const resolvedHtml = useMemo(() => {
    const rawHtml = hasInlineHtml ? message?.textHtml : fetchedHtml
    return resolveInlineEmailHtml(rawHtml, message?.attachments ?? [])
  }, [hasInlineHtml, message?.textHtml, fetchedHtml, message?.attachments])

  // Auto-fetch HTML for messages that have object-backed HTML (chat bubbles always show content).
  // Skipped on plain-text channels — there is no HTML body to go and get.
  useEffect(() => {
    if (isRichTextChannel && hasObjectBackedHtml && !fetchedHtml && !isHtmlLoading) {
      fetchHtml()
    }
  }, [isRichTextChannel, hasObjectBackedHtml, fetchedHtml, isHtmlLoading, fetchHtml])

  // Get message content based on available fields
  const getContent = useCallback(() => {
    if (!message) return ''

    // Plain-text channel (SMS/Quo, WhatsApp, DMs, chat): the body IS text.
    // Render it as text with the app's own foreground colour — no sandbox, no
    // CSP iframe, no colour scheme to get wrong.
    const plainText = message.textPlain || message.snippet
    if (!isRichTextChannel && plainText) {
      return <span className='whitespace-pre-wrap break-words'>{plainText}</span>
    }

    if (isHtmlLoading) {
      return <Skeleton className='h-12 w-full' />
    }
    if (resolvedHtml) {
      return <SandboxedEmailHtml html={resolvedHtml} className='bg-white p-4' />
    }
    if (plainText) {
      return <span className='whitespace-pre-wrap break-words'>{plainText}</span>
    }
    return <Letter className='' html={'<i>No content</i>'} />
  }, [message, resolvedHtml, isHtmlLoading, isRichTextChannel])

  // Loading state
  if (isLoading) {
    return <MessageSkeleton />
  }

  // Message not found
  if (!message) {
    return null
  }

  // Read-only seam: an empty `messageActions` (e.g. the palette's
  // ReadOnlyThreadProvider) hides the action dropdown entirely.
  const hasActions = typeof messageActions?.onReply === 'function'

  const isInbound = message.isInbound
  const senderName = sender?.displayName ?? 'Unknown'
  const senderInitials = initialsFor(sender)
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
                    onRetry={retry}
                    isRetrying={isRetrying}
                  />
                </div>
              </div>
              {hasActions && (
                <div className='pr-2 pt-2'>
                  <div className='flex items-center'>
                    <MessageDropdownMenu
                      message={message}
                      editorMessage={editorMessage}
                      emailActions={messageActions}
                      onMarkUnread={markAsUnread}
                    />
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label='Reply'
                      onClick={(e) => {
                        e.stopPropagation()
                        if (editorMessage) messageActions.onReply(editorMessage)
                      }}>
                      <Reply />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className='px-4 pb-3'>
              <div className='flex-1 overflow-auto'>
                <div className='cursor-text select-text text-sm leading-6 text-gray-700'>
                  <div className='break-words font-sans text-foreground'>{getContent()}</div>
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
  editorMessage,
  emailActions,
  onMarkUnread,
}: {
  message: MessageMeta
  editorMessage: MessageType | null
  emailActions: EmailActions
  onMarkUnread: () => void
}) {
  const handleSelect = (action: (msg: any) => void) => (event?: Event) => {
    action(message)
  }

  // Reply/forward need the editor shape; everything else (delete, print, copy
  // id) acts on the raw message.
  const handleEditorAction = (action: (msg: any) => void) => (event?: Event) => {
    if (editorMessage) action(editorMessage)
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
          <DropdownMenuItem onSelect={handleEditorAction(emailActions.onReply)}>
            <Reply className='opacity-60' />
            Reply
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleEditorAction(emailActions.onReplyAll)}>
            <ReplyAll className='opacity-60' />
            Reply all
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleEditorAction(emailActions.onForward)}>
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
