// apps/web/src/components/mail/email-display.tsx
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
import { Kbd } from '@auxx/ui/components/kbd'
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
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AttachmentDisplay } from '~/components/files/utils/attachment-display'
import { useMessage, useMessageParticipants, useThreadReadStatus } from '~/components/threads/hooks'
import type { MessageMeta } from '~/components/threads/store'
import { api } from '~/trpc/react'
import { Tooltip } from '../global/tooltip'
import type { EmailActions } from './email-actions'
import type { MessageType } from './email-editor/types'
import { useHtmlBody } from './hooks/use-html-body'
import { ParticipantList, type ParticipantListEntry } from './participant-display'
import { SendStatusIndicator } from './send-status-indicator'
import { resolveInlineEmailHtml } from './utils/resolve-inline-email-html'
import { SandboxedEmailHtml } from './utils/sandboxed-email-html'

interface EmailDisplayProps {
  /** Message ID to display */
  messageId: string
  /** Actions for this message */
  messageActions: EmailActions
  /** Whether message is expanded by default */
  isOpen: boolean
  /** Whether this is the last message in the thread (shows keyboard shortcut hints) */
  isLastMessage?: boolean
}

/**
 * Displays a single email message.
 * Fetches its own data from stores.
 */
const EmailDisplay = ({ messageId, messageActions, isOpen, isLastMessage }: EmailDisplayProps) => {
  const letterRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState(isOpen)
  const utils = api.useUtils()

  // Fetch message from store
  const { message, isLoading } = useMessage({ messageId })

  // Get read status mutation for this thread
  const { markAsUnread } = useThreadReadStatus(message?.threadId ?? null)

  // Fetch participants using the new hook
  const { from, to, cc } = useMessageParticipants(message?.participants ?? [])

  // Build participants list for ParticipantList component
  const participantEntries = useMemo((): ParticipantListEntry[] => {
    if (!message) return []

    const result: ParticipantListEntry[] = []

    // FROM participant
    if (from) {
      result.push({
        id: `${message.id}-from`,
        participantId: from.id,
        role: 'FROM',
        participant: from,
      })
    }

    // TO participants
    for (const toParticipant of to) {
      result.push({
        id: `${message.id}-to-${toParticipant.id}`,
        participantId: toParticipant.id,
        role: 'TO',
        participant: toParticipant,
      })
    }

    // CC participants
    for (const ccParticipant of cc) {
      result.push({
        id: `${message.id}-cc-${ccParticipant.id}`,
        participantId: ccParticipant.id,
        role: 'CC',
        participant: ccParticipant,
      })
    }

    return result
  }, [message, from, to, cc])

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

  // Build a MessageType compatible with the editor from store data + resolved participants
  const editorMessage: MessageType | null = useMemo(() => {
    if (!message) return null
    return {
      id: message.id,
      threadId: message.threadId,
      subject: message.subject,
      snippet: message.snippet,
      textHtml: message.textHtml,
      textPlain: message.textPlain,
      isInbound: message.isInbound,
      sentAt: message.sentAt ? new Date(message.sentAt) : null,
      createdAt: new Date(message.createdAt),
      messageType: message.messageType as MessageType['messageType'],
      sendStatus: message.sendStatus,
      providerError: message.providerError,
      attempts: message.attempts,
      from: from
        ? {
            id: from.id,
            identifier: from.identifier,
            identifierType: from.identifierType,
            name: from.name,
            displayName: from.displayName,
          }
        : null,
      participants: [
        ...(from
          ? [
              {
                role: 'FROM',
                participant: {
                  id: from.id,
                  identifier: from.identifier,
                  identifierType: from.identifierType,
                  name: from.name,
                },
              },
            ]
          : []),
        ...to.map((p) => ({
          role: 'TO',
          participant: {
            id: p.id,
            identifier: p.identifier,
            identifierType: p.identifierType,
            name: p.name,
          },
        })),
        ...cc.map((p) => ({
          role: 'CC',
          participant: {
            id: p.id,
            identifier: p.identifier,
            identifierType: p.identifierType,
            name: p.name,
          },
        })),
      ],
    }
  }, [message, from, to, cc])

  // biome-ignore lint/correctness/useExhaustiveDependencies: message triggers DOM manipulation when email content changes
  useEffect(() => {
    if (letterRef.current) {
      const gmailQuote = letterRef.current.querySelector('div[class*="_gmail_quote"]')
      if (gmailQuote) {
        gmailQuote.innerHTML = ''
      }
    }
  }, [message])

  const handleDirectReplyClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editorMessage) messageActions.onReply(editorMessage)
  }

  const handleDirectReplyAllClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editorMessage) messageActions.onReplyAll(editorMessage)
  }

  const handleReply = useCallback(
    (e?: React.SyntheticEvent) => {
      e?.stopPropagation()
      if (editorMessage) messageActions.onReply(editorMessage)
    },
    [editorMessage, messageActions]
  )

  // Determine whether HTML is available inline (outbound/legacy) or needs lazy fetch
  const hasInlineHtml = !!message?.textHtml
  const hasObjectBackedHtml = !hasInlineHtml && !!message?.hasHtmlBody

  // Lazy-load object-backed HTML body
  const {
    html: fetchedHtml,
    isLoading: isHtmlLoading,
    error: htmlError,
    fetchHtml,
  } = useHtmlBody(messageId)

  // Content mode: default to text view
  const [contentMode, setContentMode] = useState<'text' | 'html'>('text')

  // When switching to HTML mode, trigger fetch if needed
  const handleSwitchToHtml = useCallback(() => {
    setContentMode('html')
    if (hasObjectBackedHtml && !fetchedHtml) {
      fetchHtml()
    }
  }, [hasObjectBackedHtml, fetchedHtml, fetchHtml])

  // Resolve inline images for whichever HTML source is active
  const resolvedHtml = useMemo(() => {
    const rawHtml = hasInlineHtml ? message?.textHtml : fetchedHtml
    return resolveInlineEmailHtml(rawHtml, message?.attachments ?? [])
  }, [hasInlineHtml, message?.textHtml, fetchedHtml, message?.attachments])

  const nonInlineAttachments = useMemo(
    () => (message?.attachments ?? []).filter((attachment) => !attachment.inline),
    [message?.attachments]
  )

  // Whether the toggle should be shown
  const showModeToggle = hasObjectBackedHtml || (hasInlineHtml && !!message?.textPlain)

  // Loading state
  if (isLoading) {
    return <EmailSkeleton />
  }

  // Message not found
  if (!message) {
    return null
  }

  const isMe = !message.isInbound
  const senderInitials = from?.displayName?.charAt(0)?.toUpperCase() ?? '?'

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border bg-background shadow-xs transition-all duration-200 ease-in-out hover:bg-muted',
        { 'ring-5 ring-info/5 hover:ring-info/20 border-info': isMe },
        { 'hover:bg-background transition-none': selected }
      )}
      ref={letterRef}>
      <div onClick={() => setSelected(!selected)}>
        <div className='flex cursor-pointer justify-between gap-2 px-2 py-1'>
          <div className='flex grow items-start gap-1'>
            <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0 mt-2'>
              <Avatar className='size-7 rounded-none shadow-none'>
                <AvatarFallback className={cn('rounded-none bg-transparent')}>
                  {senderInitials}
                </AvatarFallback>
                <AvatarImage />
              </Avatar>
            </div>
            <div
              className='flex flex-col rounded-[6px] px-[7px] py-[3px] hover:bg-muted'
              onClick={(e) => {
                if (selected) {
                  e.stopPropagation()
                }
              }}>
              {selected ? (
                <>
                  <ParticipantList participants={participantEntries} />
                  <div className='flex text-sm'>
                    <span className='mr-[4px] shrink-0 text-muted-foreground'>Subject:</span>
                    <span className='flex-shrink-1 min-w-0 truncate whitespace-nowrap'>
                      {message.subject}
                    </span>
                  </div>
                </>
              ) : (
                <ParticipantList participants={participantEntries} />
              )}
            </div>
            <SendStatusIndicator
              status={message.sendStatus}
              error={message.providerError}
              attempts={message.attempts}
              onRetry={handleRetry}
              className='mt-1'
            />
          </div>
          <div className='flex shrink-0 grow-0 items-start gap-2'>
            <div className='flex flex-col items-end'>
              <div className='flex items-center flex-row justify-end'>
                <DropdownMenuDemo
                  message={message}
                  editorMessage={editorMessage}
                  emailActions={messageActions}
                  onMarkUnread={markAsUnread}
                />
                <Button variant='ghost' size='icon-sm' onClick={handleReply}>
                  <Reply />
                </Button>
              </div>
              <div className='text-xs text-muted-foreground'>
                <Tooltip
                  content={message.sentAt ? new Date(message.sentAt).toString() : ''}
                  delayDuration={0}
                  side='bottom'
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
        </div>
      </div>
      {selected && (
        <div className='border-t border-secondary'>
          {showModeToggle && (
            <div className='flex items-center gap-1 px-4 pt-2'>
              <Button
                variant={contentMode === 'text' ? 'secondary' : 'ghost'}
                size='xs'
                onClick={() => setContentMode('text')}>
                Text
              </Button>
              <Button
                variant={contentMode === 'html' ? 'secondary' : 'ghost'}
                size='xs'
                onClick={handleSwitchToHtml}>
                HTML
              </Button>
            </div>
          )}
          {contentMode === 'html' && isHtmlLoading ? (
            <div className='p-4'>
              <Skeleton className='h-24 w-full' />
            </div>
          ) : contentMode === 'html' && htmlError ? (
            <div className='p-4 text-sm text-destructive'>{htmlError}</div>
          ) : contentMode === 'html' && resolvedHtml ? (
            <div className='p-4'>
              <SandboxedEmailHtml html={resolvedHtml} />
            </div>
          ) : (
            <div className='whitespace-pre-wrap break-words p-4 text-sm'>
              {message.textPlain || message.snippet || ''}
            </div>
          )}
          {nonInlineAttachments.length > 0 && (
            <div className='px-4 pb-4'>
              <div className='flex items-center flex-row'>
                {nonInlineAttachments.map((attachment) => (
                  <AttachmentDisplay
                    key={attachment.id}
                    attachment={attachment as any}
                    showRemoveButton={false}
                    className='inline-flex w-auto'
                  />
                ))}
              </div>
            </div>
          )}
          <div className='flex items-center flex-row gap-2 p-4'>
            <Button
              variant='info'
              className='rounded-full'
              size='sm'
              onClick={handleDirectReplyClick}>
              <Reply className='opacity-70' />
              Reply
            </Button>
            <Button
              variant='info'
              className='rounded-full pr-3!'
              size='sm'
              onClick={handleDirectReplyAllClick}>
              <ReplyAll className='opacity-70' />
              Reply All
              {isLastMessage && (
                <Kbd variant='default' size='sm'>
                  R
                </Kbd>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default EmailDisplay

/**
 * Loading skeleton for email display.
 */
function EmailSkeleton() {
  return (
    <div className='rounded-2xl border p-4 space-y-3'>
      <div className='flex items-center gap-3'>
        <Skeleton className='h-8 w-8 rounded-lg' />
        <div className='space-y-2 flex-1'>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-3 w-48' />
        </div>
        <Skeleton className='h-6 w-16' />
      </div>
    </div>
  )
}

/**
 * Dropdown menu for email actions.
 */
export function DropdownMenuDemo({
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
  const handleEditorAction = (action: (msg: any) => void) => (event?: Event) => {
    if (editorMessage) action(editorMessage)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon-sm'>
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
