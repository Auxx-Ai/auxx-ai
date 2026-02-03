// src/components/mail/thread-details.tsx
'use client'

import { useThreadContext } from './thread-provider'
import { useThread } from '~/components/threads/hooks'
import { toRecordId } from '@auxx/lib/field-values/client'

// Import components
import { ThreadHeader } from './thread-header'
import { ThreadMessages } from './thread-messages'
import { ThreadFooter } from './thread-footer'
import { CommentList } from '../global/comments/comment-list'
import ReplyComposeEditor from './email-editor'

/**
 * Main component for displaying thread details.
 * Includes messages, reply functionality, and comments.
 */
export default function ThreadDetails() {
  // Get actions from context
  const { threadId, replyBox, handlers } = useThreadContext()

  // Get thread data from store
  const { thread, isLoading, isNotFound } = useThread({ threadId })

  // Early return if no thread
  if (!thread) {
    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
        </div>
      )
    }
    if (isNotFound) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-red-500">Thread not found</div>
        </div>
      )
    }
    return null
  }

  // Get specific data from context
  const { isOpen: isShowReplyBox, mode: editorMode, sourceMessage, ref: replyBoxRef, draft } =
    replyBox

  return (
    <div className="relative flex h-full flex-col overflow-y-auto overflow-x-hidden flex-1 w-full">
      {/* Thread header with actions - self-contained, uses context directly */}
      <ThreadHeader />

      {/* Scrollable content area */}
      <div className="flex-1 ">
        {/* Render Sent Messages */}
        <ThreadMessages />

        {/* Comments Section */}
        <div className="px-4 pb-6 pt-4 md:px-6 md:pb-10">
          <CommentList recordId={toRecordId('thread', thread.id)} />
        </div>

        <div className="grow"></div>
      </div>

      {/* Reply/Compose Editor Area */}
      <div ref={replyBoxRef} className="">
        {isShowReplyBox && (
          <div className="px-4 py-4 pb-[90px]">
            <ReplyComposeEditor
              key={`${thread.id}-${editorMode}-${sourceMessage?.id ?? 'new'}-${draft?.id ?? ''}`}
              mode={editorMode}
              sourceMessage={sourceMessage}
              thread={thread}
              draft={draft}
              onClose={() => handlers.closeReplyBox()}
              onSendSuccess={() => {
                console.log('onSendSuccess callback triggered')
              }}
            />
          </div>
        )}
      </div>

      <ThreadFooter />
    </div>
  )
}
