'use client'

import { Letter } from 'react-letter'
import { api, type RouterOutputs } from '~/trpc/react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
// import useThreads from '~/hooks/use-threads'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'

// import Avatar from 'react-avatar'
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
import { ParticipantList } from './participant-display'
import { type EmailActions } from './email-actions'
import { SendStatusIndicator } from './send-status-indicator'
import { toastError } from '@auxx/ui/components/toast'
import { AttachmentDisplay } from '~/components/files/utils/attachment-display'

export type MessageType = RouterOutputs['thread']['getById']['messages'][number]

type Props = {
  message: MessageType
  // onReplyClick: () => void // Add the new prop type
  messageActions: EmailActions // Use the grouped actions prop
  isOpen: boolean
}

/**
 * Displays multipe emails from a thread.
 * The email itselfis rendered using the Letter component.
 */
const EmailDisplay = ({ message, messageActions, isOpen }: Props) => {
  // const { account } = useThreads()
  const letterRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState(isOpen)
  const utils = api.useUtils()

  // Retry send mutation
  const retrySendMessage = api.thread.retrySendMessage.useMutation({
    onSuccess: () => {
      // Invalidate thread to refresh the message status
      utils.thread.getById.invalidate({ id: message.threadId })
    },
    onError: (error) => {
      toastError({
        title: 'Failed to retry sending',
        description: error.message,
      })
    },
  })

  const handleRetry = useCallback(() => {
    retrySendMessage.mutate({ messageId: message.id })
  }, [message.id, retrySendMessage])

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
    messageActions.onReply(message)
  }
  const handleDirectReplyAllClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    messageActions.onReplyAll(message)
  }

  const handleMore = (e: React.MouseEvent) => {
    e.stopPropagation()
    // console.log('more')
  }

  const handleReply = useCallback(
    (e?: React.SyntheticEvent) => {
      // Allow optional event arg for dropdown compatibility
      e?.stopPropagation()
      console.log('handleReply', message)
      messageActions.onReply(message)
      // onReplyClick() // Call the function passed from the parent
    },
    [messageActions] // Add dependency
  )
  const isMe = !message.isInbound // user?.email === message?.from?.identifier

  return (
    <div
      className={cn(
        'flex flex-col  rounded-2xl border bg-background shadow-xs transition-all duration-200 ease-in-out hover:bg-muted',
        { 'ring-5 ring-info/5 hover:ring-info/20 border-info': isMe },
        { 'hover:bg-background transition-none': selected }
        // { 'bg-muted': selected }
      )}
      ref={letterRef}>
      <div onClick={() => setSelected(!selected)}>
        <div className="flex cursor-pointer justify-between gap-2  px-2 py-1 ">
          <div className="flex grow items-start gap-1 ">
            <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0 mt-2">
              <Avatar className={`size-7 rounded-none shadow-none`}>
                <AvatarFallback className={cn('rounded-none bg-transparent')}>
                  {message.from.initials}
                </AvatarFallback>
                <AvatarImage />
              </Avatar>
            </div>
            <div
              className="flex flex-col rounded-[6px] px-[7px] py-[3px] hover:bg-muted"
              onClick={(e) => {
                console.log('onClick')
                if (selected) {
                  e.stopPropagation()
                }
              }}>
              {selected ? (
                <>
                  <ParticipantList participants={message?.participants ?? []} />
                  <div className="flex text-sm">
                    <span className="mr-[4px] shrink-0 text-muted-foreground">Subject:</span>
                    <span className="flex-shrink-1 min-w-0 truncate whitespace-nowrap">
                      {message.subject}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <ParticipantList participants={message?.participants ?? []} />
                </>
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
          <div className={cn('flex shrink-0 grow-0 items-start gap-2', {})}>
            <div className="flex flex-col items-end">
              {/* {selected && ( */}
              <div className="flex items-center flex-row justify-end">
                <DropdownMenuDemo message={message} emailActions={messageActions} />
                <Button variant="ghost" size="icon-sm" onClick={handleReply}>
                  <Reply />
                </Button>
              </div>
              {/* )} */}

              <div className="text-xs text-muted-foreground">
                <Tooltip
                  content={message.sentAt ? message.sentAt.toString() : ''}
                  delayDuration={0}
                  side="bottom"
                  sideOffset={5}
                  className="text-xs text-muted-foreground">
                  <span className="shrink-0 whitespace-nowrap">
                    {formatDistanceToNow(message.sentAt ?? new Date(), { addSuffix: true })}
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
            html={message?.textHtml ?? message?.textPlain ?? ''}
          />
          {message.attachments && message.attachments.length > 0 && (
            <div className="px-4 pb-4">
              <div className="flex items-center flex-row ">
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

export function DotPopover({}: Props) {
  return <div>DotPopover</div>
}

export function DropdownMenuDemo({
  message,
  emailActions,
}: {
  message: MessageType
  emailActions: EmailActions
}) {
  const handleSelect = (action: (msg: MessageType) => void) => (event?: Event) => {
    // event?.preventDefault(); // Prevent default browser actions if any
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
          <DropdownMenuItem onSelect={handleSelect(emailActions.onMarkUnread)}>
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
