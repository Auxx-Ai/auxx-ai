// apps/chat-widget/src/views/conversation/bubble.tsx
//
// Bubble shell used by the message list AND synthetic bubbles (welcome,
// future typing/streaming previews). Three render modes:
//   - `group`   → stacked message pills from a grouped cluster
//   - `typing`  → single pill with bouncing dots
//   - children  → single pill wrapping arbitrary content
//
// SYSTEM senders render as a centered italic line (no avatar, no pill).

import { User } from 'lucide-react'
import type { ComponentChildren } from 'preact'
import { cn } from '~/lib/cn'
import type { ChatMessage } from '~/transport/chat-api'

export type BubbleSender = 'USER' | 'AGENT' | 'SYSTEM'

export interface MessageGroup {
  sender: ChatMessage['sender']
  messages: ChatMessage[]
}

export interface BubbleAvatar {
  name?: string | null
  avatarUrl?: string | null
}

interface BubbleProps {
  /** Required unless `group` is passed (sender is derived from the group). */
  sender?: BubbleSender
  /** Avatar override for non-USER bubbles; falls back to a generic glyph. */
  avatar?: BubbleAvatar
  /** Render a single typing-dots pill instead of message content. */
  typing?: boolean
  /** Render a clustered message group (used by the real message list). */
  group?: MessageGroup
  /** Single-pill body for synthetic bubbles when neither `group` nor `typing`. */
  children?: ComponentChildren
}

export function Bubble({ sender, avatar, typing, group, children }: BubbleProps) {
  const effectiveSender: BubbleSender = sender ?? group?.sender ?? 'AGENT'
  const isUser = effectiveSender === 'USER'
  const isSystem = effectiveSender === 'SYSTEM'

  if (isSystem) {
    return (
      <div className='self-center text-center text-xs italic text-muted-foreground'>
        {group ? group.messages.map((m) => m.content).join(' ') : children}
      </div>
    )
  }

  return (
    <div className={cn('flex items-end gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {!isUser ? <Avatar avatar={avatar} /> : null}
      <div
        className={cn('flex max-w-[80%] flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
        {typing ? (
          <div className={pillClass(isUser, true, true)}>
            <TypingDots />
          </div>
        ) : group ? (
          group.messages.map((m, i) => (
            <div key={m.id} className={pillClass(isUser, i === 0, i === group.messages.length - 1)}>
              {m.content}
            </div>
          ))
        ) : (
          <div className={pillClass(isUser, true, true)}>{children}</div>
        )}
      </div>
    </div>
  )
}

function pillClass(isUser: boolean, first: boolean, last: boolean): string {
  return cn(
    'whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm',
    isUser
      ? 'bg-primary text-primary-foreground'
      : 'border border-border bg-background text-foreground',
    first && (isUser ? 'rounded-tr-md' : 'rounded-tl-md'),
    last && (isUser ? 'rounded-br-sm' : 'rounded-bl-sm')
  )
}

function Avatar({ avatar }: { avatar?: BubbleAvatar }) {
  const initials = avatar ? bubbleInitials(avatar.name ?? null) : null
  return (
    <div className='flex size-7 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-background text-[10px] font-medium uppercase text-muted-foreground'>
      {avatar?.avatarUrl ? (
        <img src={avatar.avatarUrl} alt='' className='size-full object-cover' />
      ) : initials ? (
        <span aria-hidden='true'>{initials}</span>
      ) : (
        <User className='size-3.5' aria-hidden='true' />
      )}
    </div>
  )
}

function bubbleInitials(name: string | null): string | null {
  if (!name) return null
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/** Generic bouncing-dots indicator. Sender-agnostic — used for welcome bubble,
 * real-time typing, anything that needs "someone is composing". */
function TypingDots() {
  return (
    <span className='inline-flex items-center gap-1 py-1' role='status' aria-label='Typing'>
      <span className='size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.2s]' />
      <span className='size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.1s]' />
      <span className='size-1.5 animate-bounce rounded-full bg-muted-foreground/60' />
    </span>
  )
}
