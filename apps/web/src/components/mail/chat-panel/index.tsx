// apps/web/src/components/mail/chat-panel/index.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import ChatComposer from '../chat-composer'
import type { EditorThread } from '../email-editor/types'
import { ChatPanelHeader } from './header'
import { ChatPanelMessages } from './messages'

interface ChatPanelProps {
  thread: EditorThread
  /**
   * Undocked: the panel wears its own chrome — window header and the message
   * log above the composer. Docked, the surrounding thread view already shows
   * both, so only the composer renders.
   *
   * 🔴 This is a flag rather than two call sites on purpose. `FloatingCompose`
   * used to pick between `<ChatPanel>` and a bare `<ChatComposer>`, which are
   * different element types at the same tree position — so popping a chat out
   * remounted the composer, destroying its Tiptap editor along with whatever
   * the agent had typed and attached. Rendering one component whose chrome is
   * conditional keeps the composer in a stable slot, and React keeps its state.
   */
  expanded: boolean
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
 * The chat surface for one thread: the composer, plus — when undocked — a
 * header (visitor + window controls) and the scrollable message log above it.
 *
 * Mounted by `FloatingCompose` for every chat thread, docked or not.
 */
export function ChatPanel({
  thread,
  expanded,
  onClose,
  onSendSuccess,
  onPopOut,
  onMinimize,
  onDockBack,
  instanceId,
  dragHandleProps,
}: ChatPanelProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col',
        expanded &&
          'h-[560px] max-h-[calc(100vh-96px)] bg-gray-300 dark:bg-gray-800 rounded-[20px] border border-transparent shadow-lg'
      )}>
      {/* Both slots stay in place when collapsed — `false` holds the position,
          so the composer below never shifts index and never remounts. */}
      {expanded && (
        <ChatPanelHeader
          threadId={thread.id}
          isDialogMode={true}
          onClose={onClose}
          onMinimize={onMinimize}
          onDockBack={onDockBack}
          dragHandleProps={dragHandleProps}
        />
      )}
      {expanded && <ChatPanelMessages threadId={thread.id} popoverClassName='z-[200]' />}
      <ChatComposer
        thread={thread}
        isDialogMode={expanded}
        onClose={onClose}
        onSendSuccess={onSendSuccess}
        // Docked, the composer wears the header itself — and it is the only
        // place the pop-out control appears.
        onPopOut={expanded ? undefined : onPopOut}
        instanceId={instanceId}
        hideHeader={expanded}
      />
    </div>
  )
}
