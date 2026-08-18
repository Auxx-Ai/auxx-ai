// apps/web/src/components/mail/chat-panel/system-line.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import type { ThreadEventSource, ThreadEventType } from '@auxx/lib/thread-events/client'
import { type ActorId, toActorId } from '@auxx/types/actor'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useSession } from '~/auth/auth-client'
import { useActor, useRecord } from '~/components/resources/hooks'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { TagBadge } from '~/components/tags/ui/tag-badge'
import { api } from '~/trpc/react'
import { ThreadEventDot } from '../thread-event-icon'

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
  /**
   * Whether the shared left rail continues below this row — every row in a
   * block draws the same rail (§15.2/§15.3), except the block's visually LAST
   * row, which hides its trailing segment. Defaults to `true`.
   */
  showRail?: boolean
}

/**
 * One event-block row: type-icon dot + copy + right-aligned time-only
 * timestamp (full datetime in the hover title), left-aligned on the block's
 * shared rail. Used both for a block's loose single rows and for an expanded
 * group's spliced-in sub-rows (plans/threads/thread-events.md §15.3).
 */
export function SystemLine({ event, showRail = true }: SystemLineProps) {
  const actor = useEventActor(event)
  const assignee = useEventAssignee(event)
  const content = eventContent(event, actor, assignee)
  if (!content) return null
  const date = new Date(event.createdAt)
  return (
    <div
      className={cn(
        'relative flex items-start gap-2.5 py-1',
        showRail &&
          'before:absolute before:inset-y-0 before:left-[7.5px] before:w-px before:bg-border'
      )}>
      <ThreadEventDot type={event.type} className='relative z-10 mt-0.5' />
      <div className='min-w-0 flex-1 text-sm text-foreground'>{content}</div>
      <time
        dateTime={event.createdAt}
        title={date.toLocaleString()}
        className='shrink-0 pt-0.5 text-[10px] text-muted-foreground'>
        {formatTimeOnly(date)}
      </time>
    </div>
  )
}

/** "2:41 PM" — time-only; the day is established by the §15.6 day separators. */
export function formatTimeOnly(date: Date): string {
  return format(date, 'h:mm a')
}

export interface EventActor {
  /** Display prefix ("You", "Lena", 'Workflow "Auto-close"'), null when the line has no actor. */
  label: string | null
  /** The acting principal's branded id when one exists (column or legacy payload). */
  actorId: ActorId | null
  /** Discriminates how {@link EventActorPrefix} renders the label. */
  kind: 'self' | 'actor' | 'workflow' | 'mail_filter' | 'record_rule' | 'classification' | 'none'
  /** Link target for provenance kinds that have one — workflow editor / mail filter settings. */
  href: string | null
}

/**
 * Resolve the actor prefix for an event line (shared with the group summary).
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
      return { label: 'You', actorId, kind: 'self', href: null }
    }
    return { label: actor?.name ?? 'A teammate', actorId, kind: 'actor', href: null }
  }
  if (!source) return { label: null, actorId: null, kind: 'none', href: null }
  switch (source.kind) {
    case 'workflow': {
      const name = workflow?.name ?? source.name
      return {
        label: name ? `Workflow "${name}"` : 'A workflow',
        actorId: null,
        kind: 'workflow',
        // The workflow builder route — deep-links straight to the editor.
        href: source.id ? `/app/workflows/${source.id}` : null,
      }
    }
    case 'mail_filter':
      return {
        label: source.name ? `Filter "${source.name}"` : 'A filter',
        actorId: null,
        kind: 'mail_filter',
        // No per-filter deep link exists yet — the Rules settings page hosts
        // every org's mail filters, so that's the closest honest target.
        href: '/app/settings/rules',
      }
    case 'record_rule':
      return {
        label: source.name ? `Rule "${source.name}"` : 'A rule',
        actorId: null,
        kind: 'record_rule',
        href: null,
      }
    case 'classification':
      return { label: 'AI classification', actorId: null, kind: 'classification', href: null }
    default:
      // 'system' (or an unknown future kind): no actor prefix.
      return { label: null, actorId: null, kind: 'none', href: null }
  }
}

/**
 * Renders an {@link EventActor} as the row's leading prefix: plain "You" for
 * self, `ActorBadge variant='text'` for an addressable actor, a link to the
 * workflow editor / mail filter settings for automation provenance that has
 * one, else plain text (§15.3 — provenance isn't an `ActorId`, by design, so
 * it never gets the avatar badge treatment).
 */
function EventActorPrefix({ actor }: { actor: EventActor }): ReactNode {
  if (!actor.label) return null
  if (actor.kind === 'self') return <>You</>
  if (actor.kind === 'actor' && actor.actorId) {
    return <ActorBadge actorId={actor.actorId} variant='text' size='sm' />
  }
  if (actor.href) {
    return (
      <Link
        href={actor.href}
        className='font-medium text-foreground underline-offset-2 hover:underline'>
        {actor.label}
      </Link>
    )
  }
  return <>{actor.label}</>
}

interface EventAssignee {
  actorId: ActorId | null
  isSelf: boolean
}

/**
 * Resolve the NEW assignee for `thread:assignee:changed` — a referenced actor,
 * not the acting principal. New rows carry a branded `data.assigneeActorId`
 * ('user:…' / 'agent:…'); legacy rows carry a bare `data.toUserId`. The name
 * itself is rendered live via `ActorBadge`, so this only needs the id + the
 * self-assign check.
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
  const isSelf = !!currentUserId && assigneeId === toActorId('user', currentUserId)
  return { actorId: assigneeId, isSelf }
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

/** Extract `data.tagIds` for tagged/untagged events. */
function pickTagIds(event: ChatThreadEvent): string[] {
  const ids = event.data.tagIds
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/** Extract `data.tagNames` for tagged/untagged events (snapshot fallback for deleted tags). */
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
  const hasPrefix = !!actor.label
  const prefix = hasPrefix ? <EventActorPrefix actor={actor} /> : null
  const wrap = (fragment: string): ReactNode =>
    hasPrefix ? (
      <>
        {prefix} {fragment}
      </>
    ) : (
      capitalize(fragment)
    )

  switch (event.type) {
    case 'thread:taken_over':
      return wrap('took over the conversation')
    case 'thread:returned_to_ai':
      return wrap('returned the conversation to AI')
    case 'thread:archived':
      return wrap('marked as done')
    case 'thread:reopened':
      return wrap('reopened the conversation')
    case 'thread:assignee:changed': {
      if (!assignee.actorId) return wrap('unassigned the conversation')
      const targetNode: ReactNode = assignee.isSelf ? (
        'you'
      ) : (
        <ActorBadge actorId={assignee.actorId} variant='text' size='sm' />
      )
      // Skip the actor prefix when the actor IS the assignee (self-assign, or
      // legacy rows whose only identity was `toUserId`).
      if (!hasPrefix || actor.actorId === assignee.actorId) {
        return <>Assigned to {targetNode}</>
      }
      return (
        <>
          {prefix} assigned this to {targetNode}
        </>
      )
    }
    case 'thread:visitor:identified': {
      const email = event.data.visitorEmail
      if (typeof email !== 'string' || !email) return 'Visitor identified'
      return `Visitor identified as ${email}`
    }
    case 'thread:tagged':
      return (
        <TagLine
          prefix={prefix}
          hasPrefix={hasPrefix}
          verb='tagged with'
          tagIds={pickTagIds(event)}
          tagNames={pickTagNames(event)}
        />
      )
    case 'thread:untagged':
      return (
        <TagLine
          prefix={prefix}
          hasPrefix={hasPrefix}
          verb='removed tags'
          tagIds={pickTagIds(event)}
          tagNames={pickTagNames(event)}
        />
      )
    case 'thread:merged':
      // `data.sourceThreadId` names the merged-in thread, but that thread is
      // typically hidden post-merge — plain copy degrades gracefully instead
      // of fetching a row the viewer can no longer open.
      return prefix ? (
        <>{prefix} merged a conversation into this one</>
      ) : (
        'A conversation was merged into this one'
      )
    default:
      return null
  }
}

/**
 * "{prefix} {verb} {chip chip chip}" — colored tag chips resolved live by
 * `tagIds` (org cache via `TagBadge`), falling back to the emit-time
 * `tagNames` snapshot for a deleted tag — same live-then-snapshot precedence
 * as workflow provenance (§5.5/§15.3).
 */
export function TagLine({
  prefix,
  hasPrefix,
  verb,
  tagIds,
  tagNames,
}: {
  prefix: ReactNode
  hasPrefix: boolean
  verb: string
  tagIds: string[]
  tagNames: string[]
}) {
  const lead = hasPrefix ? (
    <>
      {prefix} {verb}
    </>
  ) : (
    capitalize(verb)
  )
  if (tagIds.length === 0 && tagNames.length === 0) return <>{lead}</>
  return (
    <span className='inline-flex flex-wrap items-center gap-1'>
      <span>{lead}</span>
      {tagIds.length > 0
        ? tagIds.map((id, i) => <EventTagChip key={id} tagId={id} fallbackName={tagNames[i]} />)
        : tagNames.map((name, i) => (
            <Badge variant='pill' size='sm' className='not-italic' key={`${name}:${i}`}>
              {name}
            </Badge>
          ))}
    </span>
  )
}

/**
 * One tag chip inside an event line: the live-resolved `TagBadge` (color +
 * emoji, org cache) when the tag record still exists, else a plain pill using
 * the emit-time snapshot name for a deleted tag.
 */
function EventTagChip({ tagId, fallbackName }: { tagId: string; fallbackName?: string }) {
  const recordId = tagId as RecordId
  const { isNotFound } = useRecord({ recordId, enabled: !!tagId })
  if (isNotFound) {
    return (
      <Badge variant='pill' size='sm' className='not-italic'>
        {fallbackName ?? 'Unknown tag'}
      </Badge>
    )
  }
  return <TagBadge recordId={recordId} size='sm' />
}
