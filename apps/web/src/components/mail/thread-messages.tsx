// apps/web/src/components/mail/thread-messages.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import React from 'react'
import { useMessages, useThread } from '~/components/threads/hooks'
import EmailDisplay from './email-display'
import MessageDisplay from './message-display'
import { useThreadContext, useThreadEmailActions } from './thread-provider'

/**
 * Display component for thread messages.
 * Fetches messages from store and renders them.
 */
export function ThreadMessages() {
  // Get thread context for threadId
  const { threadId } = useThreadContext()
  const { thread } = useThread({ threadId })
  const messageActions = useThreadEmailActions()

  // Fetch messages from store
  const { messages, isLoading } = useMessages({
    threadId: thread?.id ?? null,
    enabled: !!thread,
  })

  if (!thread) return null

  // Loading state
  if (isLoading && messages.length === 0) {
    return (
      <div className='flex flex-col gap-4 px-4 py-2'>
        {[1, 2, 3].map((i) => (
          <MessageSkeleton key={i} />
        ))}
      </div>
    )
  }

  return (
    <div className='flex flex-col overflow-y-auto'>
      <div className='flex flex-1 flex-col space-y-4'>
        {/* Email messages */}
        <div className='flex flex-col gap-4 px-4 py-2'>
          {messages.map((message, index) => {
            // Check if this is the last message in the array
            const isLastMessage = index === messages.length - 1

            // Route to appropriate component based on message type
            switch (message.messageType) {
              case 'EMAIL':
                return (
                  <EmailDisplay
                    key={message.id}
                    messageId={message.id}
                    messageActions={messageActions}
                    isOpen={isLastMessage}
                  />
                )
              default:
                return (
                  <MessageDisplay
                    key={message.id}
                    messageId={message.id}
                    messageActions={messageActions}
                    isOpen={isLastMessage}
                  />
                )
            }
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Skeleton for loading message.
 */
function MessageSkeleton() {
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
      <Skeleton className='h-20 w-full' />
    </div>
  )
}
