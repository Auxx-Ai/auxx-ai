// apps/web/src/components/mail/chat-message-group.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useRef, useState } from 'react'
import type { MessageMeta } from '~/components/threads/store'
import ChatMessageDisplay, { type ChatGroupPosition } from './chat-message-display'
import type { EmailActions } from './email-actions'

interface ChatMessageGroupProps {
  /** Consecutive same-sender chat messages, in chronological order. */
  messages: MessageMeta[]
  messageActions: EmailActions
  /** True when the last message of the run is the latest in the thread. */
  isLast: boolean
  /** Class forwarded to per-message dropdown content — used to bump z-index above floating compose. */
  popoverClassName?: string
}

/**
 * Renders a run of consecutive same-sender chat messages as a merged stack.
 * Inside the run, sibling bubbles are sized to the widest content via CSS
 * grid (`grid-cols-[minmax(0,max-content)]` + per-bubble `w-full`).
 * Clicking any bubble expands the whole group: every bubble gets full
 * rounding, the gap opens, and each shows its own timestamp/receipt.
 */
export function ChatMessageGroup({
  messages,
  messageActions,
  isLast,
  popoverClassName,
}: ChatMessageGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (rootRef.current.contains(e.target as Node)) return
      setExpanded(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [expanded])

  const isInbound = messages[0]?.isInbound ?? false
  const onToggle = () => setExpanded((e) => !e)

  return (
    <div ref={rootRef} className='mx-auto w-full max-w-2xl'>
      <div
        className={cn(
          'grid w-fit max-w-[80%] grid-cols-[minmax(0,max-content)] transition-all duration-300',
          isInbound ? 'mr-auto' : 'ml-auto',
          expanded ? 'gap-2' : 'gap-0.5'
        )}>
        {messages.map((message, index) => {
          const position = positionOf(index, messages.length)
          return (
            <ChatMessageDisplay
              key={message.id}
              messageId={message.id}
              messageActions={messageActions}
              isOpen={isLast && index === messages.length - 1}
              groupPosition={position}
              isExpanded={expanded}
              onToggle={onToggle}
              popoverClassName={popoverClassName}
            />
          )
        })}
      </div>
    </div>
  )
}

function positionOf(index: number, total: number): ChatGroupPosition {
  if (total === 1) return 'solo'
  if (index === 0) return 'first'
  if (index === total - 1) return 'last'
  return 'middle'
}
