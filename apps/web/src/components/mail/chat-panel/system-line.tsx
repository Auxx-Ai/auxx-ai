// apps/web/src/components/mail/chat-panel/system-line.tsx
'use client'

import type { ThreadEventSource, ThreadEventType } from '@auxx/lib/thread-events/client'
import { type ActorId, toActorId } from '@auxx/types/actor'
import { Badge } from '@auxx/ui/components/badge'
import type { ReactNode } from 'react'
import { useSession } from '~/auth/auth-client'
import { useActor } from '~/components/resources/hooks'
import { api } from '~/trpc/react'

export type ChatThreadEventType = ThreadEventType

export interface ChatThreadEvent {
  id: string
  type: ChatThreadEventType
  createdAt: string
  /** Branded ActorId string ('user:…' / 'agent:…'), null for system/automation. */
  actorId?: string | null
  data: Record<string, unknown>
}

interface SystemLineProps {
  event: ChatThreadEvent
}

/**
 * Centered, muted text rendered between message bubbles for thread lifecycle
 * events in the admin thread view (email, SMS and chat alike). Copy is
 * channel-neutral — "took over the conversation", "marked as done" — because
 * the same events fire on every transport, unlike the widget's chat-specific
 * visitor copy.
 */
export function SystemLine({ event }: SystemLineProps) {
  const actor = useEventActor(event)
  const assignee = useEventAssignee(event)
  const content = eventContent(event, actor, assignee)
  if (!content) return null
  const timestamp = new Date(event.createdAt).toLocaleString()
  return (
    <div
      className='self-center px-3 text-center text-xs italic text-muted-foreground'
      title={timestamp}>
      {content}
    </div>
  )
}

export interface EventActor {
  /** Display prefix ("You", "Lena", 'Workflow "Auto-close"'), null when the line has no actor. */
  label: string | null
  /** The acting principal's branded id when one exists (column or legacy payload). */
  actorId: ActorId | null
}

/**
 * Resolve the actor prefix for an event line (shared with `SystemLineRun`).
 *
 * Precedence (plans/threads/thread-events.md §5.5): the persisted `actorId`
 * column (can name an agent, resolved lazily via the actor store) → the legacy
 * `data.userId` payload on pre-cut-over rows → `data.source` provenance for
 * automated changes (workflow names refine live via `api.workflow.getById`,
 * favorites-style, falling back to the emit-time snapshot, then a generic
 * label) → null for system events, which render with no actor prefix.
 */
export function useEventActor(event: ChatThreadEvent | undefined): EventActor {
  const { data: session } = useSession()
  const currentUserId = session?.user?.id ?? null

  const fallbackUserId = event ? pickActorUserId(event) : null
  const actorId: ActorId | null =
    event && typeof event.actorId === 'string' && event.actorId
      ? (event.actorId as ActorId)
      : fallbackUserId
        ? toActorId('user', fallbackUserId)
        : null
  // `useActor` queues a batched fetch via the actor store. For events on
  // teammates the org cache typically already has them; otherwise we fall
  // back to a generic label until the fetch lands.
  const { actor } = useActor({ actorId, enabled: !!actorId })

  const source = event ? pickEventSource(event) : null
  // Live-name refinement for workflow provenance only (favorites pattern:
  // staleTime + enabled gating, react-query dedupes across lines citing the
  // same workflow). Filters and rules stay snapshot-only by design.
  const workflowId = !actorId && source?.kind === 'workflow' && source.id ? source.id : null
  const { data: workflow } = api.workflow.getById.useQuery(
    { id: workflowId ?? '' },
    { enabled: !!workflowId, staleTime: 5 * 60_000, refetchOnWindowFocus: false }
  )

  if (actorId) {
    if (currentUserId && actorId === toActorId('user', currentUserId)) {
      return { label: 'You', actorId }
    }
    return { label: actor?.name ?? 'A teammate', actorId }
  }
  if (!source) return { label: null, actorId: null }
  switch (source.kind) {
    case 'workflow': {
      const name = workflow?.name ?? source.name
      return { label: name ? `Workflow "${name}"` : 'A workflow', actorId: null }
    }
    case 'mail_filter':
      return { label: source.name ? `Filter "${source.name}"` : 'A filter', actorId: null }
    case 'record_rule':
      return { label: source.name ? `Rule "${source.name}"` : 'A rule', actorId: null }
    case 'classification':
      return { label: 'AI classification', actorId: null }
    default:
      // 'system' (or an unknown future kind): no actor prefix.
      return { label: null, actorId: null }
  }
}

interface EventAssignee {
  actorId: ActorId | null
  name: string | null
  isSelf: boolean
}

/**
 * Resolve the NEW assignee for `thread:assignee:changed` — a referenced actor,
 * not the acting principal. New rows carry a branded `data.assigneeActorId`
 * ('user:…' / 'agent:…'); legacy rows carry a bare `data.toUserId`.
 */
function useEventAssignee(event: ChatThreadEvent): EventAssignee {
  const { data: session } = useSession()
  const currentUserId = session?.user?.id ?? null

  let assigneeId: ActorId | null = null
  if (event.type === 'thread:assignee:changed') {
    const branded = event.data.assigneeActorId
    const legacy = event.data.toUserId
    assigneeId =
      typeof branded === 'string' && branded
        ? (branded as ActorId)
        : typeof legacy === 'string' && legacy
          ? toActorId('user', legacy)
          : null
  }
  const { actor } = useActor({ actorId: assigneeId, enabled: !!assigneeId })
  const isSelf = !!currentUserId && assigneeId === toActorId('user', currentUserId)
  return { actorId: assigneeId, name: actor?.name ?? null, isSelf }
}

/**
 * Resolve the legacy user id whose display name we want for this event line.
 * Only the four lifecycle types historically wrote `data.userId`; the assignee
 * event's `toUserId` is the assignee (a referenced actor), never the actor.
 */
function pickActorUserId(event: ChatThreadEvent): string | null {
  switch (event.type) {
    case 'thread:taken_over':
    case 'thread:returned_to_ai':
    case 'thread:archived':
    case 'thread:reopened':
      return typeof event.data.userId === 'string' ? event.data.userId : null
    default:
      return null
  }
}

/** Extract `data.source` provenance when present and minimally well-formed. */
export function pickEventSource(event: ChatThreadEvent): ThreadEventSource | null {
  const source = event.data?.source
  if (!source || typeof source !== 'object') return null
  if (typeof (source as { kind?: unknown }).kind !== 'string') return null
  return source as ThreadEventSource
}

/** Extract `data.tagNames` for tagged/untagged events. */
function pickTagNames(event: ChatThreadEvent): string[] {
  const names = event.data.tagNames
  if (!Array.isArray(names)) return []
  return names.filter((n): n is string => typeof n === 'string' && n.length > 0)
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Channel-neutral, operator-facing content for each event type. Falls back to
 * "A teammate" while the actor lookup resolves (org cache hydrates members up
 * front, so that only shows briefly for fresh events). "Marked as done"
 * follows the mail toolbar's product language for the ARCHIVED status.
 */
function eventContent(
  event: ChatThreadEvent,
  actor: EventActor,
  assignee: EventAssignee
): ReactNode | null {
  const prefix = actor.label
  const withPrefix = (fragment: string): string =>
    prefix ? `${prefix} ${fragment}` : capitalize(fragment)

  switch (event.type) {
    case 'thread:taken_over':
      return withPrefix('took over the conversation')
    case 'thread:returned_to_ai':
      return withPrefix('returned the conversation to AI')
    case 'thread:archived':
      return withPrefix('marked as done')
    case 'thread:reopened':
      return withPrefix('reopened the conversation')
    case 'thread:assignee:changed': {
      if (!assignee.actorId) return withPrefix('unassigned the conversation')
      const target = assignee.isSelf ? 'you' : (assignee.name ?? 'a teammate')
      // Skip the actor prefix when the actor IS the assignee (self-assign, or
      // legacy rows whose only identity was `toUserId`).
      if (!prefix || actor.actorId === assignee.actorId) {
        return `Assigned to ${target}`
      }
      return `${prefix} assigned this to ${target}`
    }
    case 'thread:visitor:identified': {
      const email = event.data.visitorEmail
      if (typeof email !== 'string' || !email) return 'Visitor identified'
      return `Visitor identified as ${email}`
    }
    case 'thread:tagged':
      return <TagLine text={withPrefix('tagged with')} tags={pickTagNames(event)} />
    case 'thread:untagged':
      return <TagLine text={withPrefix('removed tags')} tags={pickTagNames(event)} />
    case 'thread:merged':
      // `data.sourceThreadId` names the merged-in thread, but that thread is
      // typically hidden post-merge — plain copy degrades gracefully instead
      // of fetching a row the viewer can no longer open.
      return prefix
        ? `${prefix} merged a conversation into this one`
        : 'A conversation was merged into this one'
    default:
      return null
  }
}

/**
 * "{text} {pill pill pill}" — the same Badge-pill idiom the record timeline
 * uses for TAG_ADDED / TAG_REMOVED in `~/components/timeline/event-description.tsx`.
 */
export function TagLine({ text, tags }: { text: string; tags: string[] }) {
  if (tags.length === 0) return <>{text}</>
  return (
    <span className='inline-flex flex-wrap items-center justify-center gap-1'>
      <span>{text}</span>
      {tags.map((tag, idx) => (
        <Badge variant='pill' size='sm' className='not-italic' key={idx}>
          {tag}
        </Badge>
      ))}
    </span>
  )
}
