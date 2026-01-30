// apps/web/src/components/mail/email-display.tsx
'use client'

import { Letter } from 'react-letter'
import { api } from '~/trpc/react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Tooltip } from '../global/tooltip'
import { ParticipantList, type ParticipantListEntry } from './participant-display'
import { type EmailActions } from './email-actions'
import { SendStatusIndicator } from './send-status-indicator'
import { toastError } from '@auxx/ui/components/toast'
import { AttachmentDisplay } from '~/components/files/utils/attachment-display'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useMessage, useMessageParticipants, useThreadReadStatus } from '~/components/threads/hooks'
import type { MessageMeta } from '~/components/threads/store'

interface EmailDisplayProps {
  /** Message ID to display */
  messageId: string
  /** Actions for this message */
  messageActions: EmailActions
  /** Whether message is expanded by default */
  isOpen: boolean
}

/**
 * Displays a single email message.
 * Fetches its own data from stores.
 */
const EmailDisplay = ({ messageId, messageActions, isOpen }: EmailDisplayProps) => {
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
    onSuccess: () => {
      if (message) {
        utils.thread.getById.invalidate({ id: message.threadId })
      }
    },
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
    if (message) messageActions.onReply(message as any)
  }

  const handleDirectReplyAllClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (message) messageActions.onReplyAll(message as any)
  }

  const handleReply = useCallback(
    (e?: React.SyntheticEvent) => {
      e?.stopPropagation()
      if (message) messageActions.onReply(message as any)
    },
    [message, messageActions]
  )

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
        <div className="flex cursor-pointer justify-between gap-2 px-2 py-1">
          <div className="flex grow items-start gap-1">
            <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0 mt-2">
              <Avatar className="size-7 rounded-none shadow-none">
                <AvatarFallback className={cn('rounded-none bg-transparent')}>
                  {senderInitials}
                </AvatarFallback>
                <AvatarImage />
              </Avatar>
            </div>
            <div
              className="flex flex-col rounded-[6px] px-[7px] py-[3px] hover:bg-muted"
              onClick={(e) => {
                if (selected) {
                  e.stopPropagation()
                }
              }}>
              {selected ? (
                <>
                  <ParticipantList participants={participantEntries} />
                  <div className="flex text-sm">
                    <span className="mr-[4px] shrink-0 text-muted-foreground">Subject:</span>
                    <span className="flex-shrink-1 min-w-0 truncate whitespace-nowrap">
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
              className="mt-1"
            />
          </div>
          <div className="flex shrink-0 grow-0 items-start gap-2">
            <div className="flex flex-col items-end">
              <div className="flex items-center flex-row justify-end">
                <DropdownMenuDemo message={message} emailActions={messageActions} onMarkUnread={markAsUnread} />
                <Button variant="ghost" size="icon-sm" onClick={handleReply}>
                  <Reply />
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                <Tooltip
                  content={message.sentAt ? new Date(message.sentAt).toString() : ''}
                  delayDuration={0}
                  side="bottom"
                  sideOffset={5}
                  className="text-xs text-muted-foreground">
                  <span className="shrink-0 whitespace-nowrap">
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
        <div className="border-t border-secondary">
          <Letter
            className={cn('bg-background p-4 text-foreground')}
            html={message.textHtml ?? message.textPlain ?? ''}
          />
          {message.attachments && message.attachments.length > 0 && (
            <div className="px-4 pb-4">
              <div className="flex items-center flex-row">
                {message.attachments.map((attachment) => (
                  <AttachmentDisplay
                    key={attachment.id}
                    attachment={attachment as any}
                    showRemoveButton={false}
                    className="inline-flex w-auto"
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center flex-row gap-2 p-4">
            <Button
              variant="info"
              className="rounded-full"
              size="sm"
              onClick={handleDirectReplyClick}>
              <Reply className="opacity-70" />
              Reply
            </Button>
            <Button
              variant="info"
              className="rounded-full"
              size="sm"
              onClick={handleDirectReplyAllClick}>
              <ReplyAll className="opacity-70" />
              Reply All
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
    <div className="rounded-2xl border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-6 w-16" />
      </div>
    </div>
  )
}

/**
 * Dropdown menu for email actions.
 */
export function DropdownMenuDemo({
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
        <Button variant="ghost" size="icon-sm">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onReply)}>
            <Reply className="opacity-60" />
            Reply
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onReplyAll)}>
            <ReplyAll className="opacity-60" />
            Reply all
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onForward)}>
            <Forward className="opacity-60" />
            Forward
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onResend)}>
            <Send className="opacity-60" />
            Resend
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onMarkUnread}>
            <Mail className="opacity-60" />
            Mark as unread
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onDelete)} variant="destructive">
            <Trash className="opacity-60" />
            Delete
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onDownload)}>
            <Download className="opacity-60" />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleSelect(emailActions.onPrint)}>
            <Printer className="opacity-60" />
            Print
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSelect(emailActions.onCopyId)}>
          <CopyPlusIcon className="opacity-60" />
          Copy Message ID
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleSelect(emailActions.onViewSource)}>
          <Code className="opacity-60" />
          View Source
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
