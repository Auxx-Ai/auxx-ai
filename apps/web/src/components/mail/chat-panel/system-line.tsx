// apps/web/src/components/mail/chat-panel/system-line.tsx
'use client'

import { toActorId } from '@auxx/types/actor'
import { useSession } from '~/auth/auth-client'
import { useActor } from '~/components/resources/hooks'

export type ChatThreadEventType =
  | 'thread:taken_over'
  | 'thread:returned_to_ai'
  | 'thread:archived'
  | 'thread:reopened'
  | 'thread:assignee:changed'
  | 'thread:visitor:identified'

export interface ChatThreadEvent {
  id: string
  type: ChatThreadEventType
  createdAt: string
  data: Record<string, unknown>
}

interface SystemLineProps {
  event: ChatThreadEvent
}

/**
 * Centered, muted text rendered between message bubbles for thread lifecycle
 * events in the admin chat panel. Mirrors the visitor-facing system line in
 * the widget, but with operator-facing copy ("You joined" vs "An agent
 * joined", "Reassigned to X", "Visitor identified as X").
 */
export function SystemLine({ event }: SystemLineProps) {
  const { data: session } = useSession()
  const currentUserId = session?.user?.id ?? null

  const actorUserId = pickActorUserId(event)
  // `useActor` queues a batched fetch via the actor store. For events on
  // teammates the org cache typically already has them; otherwise we fall
  // back to a generic label until the fetch lands.
  const { actor } = useActor({
    actorId: actorUserId ? toActorId('user', actorUserId) : null,
    enabled: !!actorUserId,
  })

  const text = adminCopyFor(event, {
    currentUserId,
    actorName: actor?.name ?? null,
  })
  if (!text) return null
  const timestamp = new Date(event.createdAt).toLocaleString()
  return (
    <div
      className='self-center px-3 text-center text-xs italic text-muted-foreground'
      title={timestamp}>
      {text}
    </div>
  )
}

/**
 * Resolve the user id whose display name we want for this event line.
 * Returns null for events that don't carry an actor.
 */
function pickActorUserId(event: ChatThreadEvent): string | null {
  switch (event.type) {
    case 'thread:taken_over':
    case 'thread:returned_to_ai':
    case 'thread:archived':
    case 'thread:reopened':
      return typeof event.data.userId === 'string' ? event.data.userId : null
    case 'thread:assignee:changed':
      return typeof event.data.toUserId === 'string' ? event.data.toUserId : null
    case 'thread:visitor:identified':
      return null
    default:
      return null
  }
}

interface CopyContext {
  currentUserId: string | null
  actorName: string | null
}

/**
 * Operator-facing copy for each event type. Falls back to "A teammate" when
 * the actor lookup hasn't resolved yet (org cache hydrates members up front,
 * so this only shows up briefly for fresh events).
 */
function adminCopyFor(event: ChatThreadEvent, ctx: CopyContext): string | null {
  const isSelf = (id: unknown): boolean =>
    typeof id === 'string' && !!ctx.currentUserId && id === ctx.currentUserId
  const nameFor = (id: unknown): string => {
    if (isSelf(id)) return 'You'
    return ctx.actorName ?? 'A teammate'
  }

  switch (event.type) {
    case 'thread:taken_over': {
      const userId = event.data.userId
      return isSelf(userId) ? 'You joined the chat' : `${nameFor(userId)} joined the chat`
    }
    case 'thread:returned_to_ai': {
      const userId = event.data.userId
      return isSelf(userId)
        ? 'You handed the chat back to AI'
        : `${nameFor(userId)} handed the chat back to AI`
    }
    case 'thread:archived':
      return 'Chat ended'
    case 'thread:reopened':
      return 'Chat reopened'
    case 'thread:assignee:changed': {
      const toUserId = event.data.toUserId
      if (!toUserId) return 'Unassigned'
      if (isSelf(toUserId)) return 'Reassigned to you'
      return `Reassigned to ${ctx.actorName ?? 'a teammate'}`
    }
    case 'thread:visitor:identified': {
      const email = event.data.visitorEmail
      if (typeof email !== 'string' || !email) return 'Visitor identified'
      return `Visitor identified as ${email}`
    }
    default:
      return null
  }
}
