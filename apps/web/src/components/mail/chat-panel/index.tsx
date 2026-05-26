// apps/web/src/components/mail/chat-panel/index.tsx
'use client'

import type React from 'react'
import ChatComposer from '../chat-composer'
import type { EditorThread } from '../email-editor/types'
import { ChatPanelHeader } from './header'
import { ChatPanelMessages } from './messages'

interface ChatPanelProps {
  thread: EditorThread
  isDialogMode: boolean
  onClose: () => void
  onSendSuccess: () => void
  onPopOut?: () => void
  onMinimize?: () => void
  onDockBack?: () => void
  instanceId?: string
  /** When set, the header's visitor info region becomes the drag handle. */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

/**
 * Floating chat conversation: header (visitor + window controls),
 * scrollable message log, and the chat composer pinned at the bottom.
 *
 * Mounted by `FloatingCompose` when the thread is a chat thread AND the
 * compose instance is in floating/minimized mode. Inline (docked) chat
 * still renders just the `ChatComposer` — the surrounding thread view
 * already shows the messages.
 */
export function ChatPanel({
  thread,
  isDialogMode,
  onClose,
  onSendSuccess,
  onPopOut,
  onMinimize,
  onDockBack,
  instanceId,
  dragHandleProps,
}: ChatPanelProps) {
  return (
    <div className='relative flex h-[560px] max-h-[calc(100vh-96px)] flex-col bg-gray-300 dark:bg-gray-800 rounded-[20px] border border-transparent shadow-lg'>
      <ChatPanelHeader
        threadId={thread.id}
        isDialogMode={isDialogMode}
        onClose={onClose}
        onPopOut={onPopOut}
        onMinimize={onMinimize}
        onDockBack={onDockBack}
        dragHandleProps={dragHandleProps}
      />

      <ChatPanelMessages threadId={thread.id} popoverClassName='z-[200]' />

      <ChatComposer
        thread={thread}
        isDialogMode={isDialogMode}
        onClose={onClose}
        onSendSuccess={onSendSuccess}
        instanceId={instanceId}
        hideHeader
      />
    </div>
  )
}
