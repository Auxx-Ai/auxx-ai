// apps/web/src/components/mail/chat-panel/system-line-run.tsx
'use client'

import type { ActorId, ActorType } from '@auxx/types/actor'
import { isWorkerActor, toActorId } from '@auxx/types/actor'
import { AnimatedCollapsibleContent, CollapsibleChevron } from '@auxx/ui/components/collapsible'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '~/auth/auth-client'
import { useActors } from '~/components/resources/hooks'
import { getActorStoreState } from '~/components/resources/store/actor-store'
import { ActorAvatar } from '~/components/resources/ui/actor-badge'
import { actorAvatarType } from '~/components/resources/utils/actor-id'
import {
  composeEventGroupSummary,
  type EventBlockEntry,
  eventActorKey,
  formatEventGroupSummary,
  type GroupActorLabelResolver,
} from '../chat-timeline'
import { type ChatThreadEvent, formatTimeOnly, pickEventSource, SystemLine } from './system-line'

interface EventBlockProps {
  /** The block's entries, ASC — produced by `buildChatTimeline`. */
  entries: EventBlockEntry[]
  /** Trailing blocks (events after the last message) start expanded (§15.4.3). */
  isTrailing: boolean
}

/**
 * One event block: a shared left rail (`mx-auto w-full max-w-2xl`, matching
 * the message column) drawing every row in the block — loose singles and
 * collapsed group-rows alike. Expanding a group splices its sub-rows onto the
 * same rail in place (plans/threads/thread-events.md §15.2).
 */
export function EventBlock({ entries, isTrailing }: EventBlockProps) {
  return (
    <div className='mx-auto w-full max-w-2xl'>
      <div className='flex flex-col'>
        {entries.map((entry, i) => {
          const continuesAfter = i !== entries.length - 1
          if (entry.kind === 'single') {
            return <SystemLine key={entry.event.id} event={entry.event} showRail={continuesAfter} />
          }
          return (
            <GroupRow
              key={entry.events[0]!.id}
              events={entry.events}
              continuesAfter={continuesAfter}
              defaultExpanded={isTrailing}
            />
          )
        })}
      </div>
    </div>
  )
}

interface FacepileActor {
  key: string
  type: ActorType
  avatarUrl: string | null
  isTeam?: boolean
}

/**
 * Collapsed group-row (≥3 contiguous same-day events, mixed actors welcome):
 * condensed count dot + facepile (up to 3 stacked `ActorAvatar`s) + net-effect
 * summary + time range, all on the block's shared rail. Expands in place to
 * splice each event's own `SystemLine` row below it (§15.4.4).
 */
function GroupRow({
  events,
  continuesAfter,
  defaultExpanded,
}: {
  events: ChatThreadEvent[]
  continuesAfter: boolean
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const { actorLabel, facepile } = useGroupActorResolution(events)

  const summary = useMemo(
    () => formatEventGroupSummary(composeEventGroupSummary(events, actorLabel)),
    [events, actorLabel]
  )

  const first = events[0]!
  const last = events[events.length - 1]!
  const timeRange = `${formatTimeOnly(new Date(first.createdAt))} – ${formatTimeOnly(new Date(last.createdAt))}`
  const fullRange = `${new Date(first.createdAt).toLocaleString()} – ${new Date(last.createdAt).toLocaleString()}`

  const headerHasRail = continuesAfter || expanded

  return (
    <div className='flex flex-col'>
      <button
        type='button'
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={fullRange}
        className={cn(
          'relative flex w-full items-center gap-2 rounded-md py-1 pl-0 text-left transition-colors hover:bg-muted',
          headerHasRail &&
            'before:absolute before:inset-y-0 before:left-[7.5px] before:w-px before:bg-border'
        )}>
        <span
          aria-hidden
          className='relative z-10 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground'>
          {events.length}
        </span>
        <Facepile actors={facepile} />
        <span className='min-w-0 flex-1 truncate text-sm text-foreground'>{summary}</span>
        <span className='shrink-0 text-[10px] text-muted-foreground'>{timeRange}</span>
        <CollapsibleChevron open={expanded} className='size-3 shrink-0 text-muted-foreground' />
      </button>
      <AnimatedCollapsibleContent open={expanded}>
        <div className='flex flex-col pt-1'>
          {events.map((event, idx) => (
            <SystemLine
              key={event.id}
              event={event}
              showRail={idx !== events.length - 1 || continuesAfter}
            />
          ))}
        </div>
      </AnimatedCollapsibleContent>
    </div>
  )
}

/**
 * Viewer-local day divider spanning the whole conversation — message bubbles
 * AND event rows share this one day spine (§15.6). "Today" / "Yesterday" /
 * weekday / "Aug 12" labeling comes from `buildChatTimeline`; this just draws
 * the Slack/WhatsApp-style centered line.
 */
export function DaySeparator({ label }: { label: string }) {
  return (
    <div
      role='separator'
      aria-label={label}
      className='mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-1'>
      <Separator className='flex-1' />
      <span className='shrink-0 text-[11px] font-medium text-muted-foreground'>{label}</span>
      <Separator className='flex-1' />
    </div>
  )
}

function Facepile({ actors }: { actors: FacepileActor[] }) {
  if (actors.length === 0) return null
  return (
    <span className='flex shrink-0 items-center'>
      {actors.map((a, i) => (
        <ActorAvatar
          key={a.key}
          type={a.type}
          avatarUrl={a.avatarUrl}
          isTeam={a.isTeam}
          className={cn('size-4 rounded-full ring-2 ring-background', i > 0 && '-ml-1.5')}
        />
      ))}
    </span>
  )
}

/**
 * Resolve display names + a facepile for a group's events, without the
 * per-row live workflow-name refinement (`useEventActor` does that for
 * expanded rows) — the group summary is a compact net-effect line, so it
 * stays on the actor store's already-hydrated names and the emit-time
 * automation snapshot. Actors not yet in the store get requested here too.
 */
function useGroupActorResolution(events: ChatThreadEvent[]): {
  actorLabel: GroupActorLabelResolver
  facepile: FacepileActor[]
} {
  const { data: session } = useSession()
  const currentUserId = session?.user?.id ?? null
  const currentUserKey = currentUserId ? `actor:${toActorId('user', currentUserId)}` : null

  const actorIds = useMemo(() => {
    const seen = new Set<string>()
    const ids: ActorId[] = []
    const add = (id: string) => {
      if (seen.has(id)) return
      seen.add(id)
      ids.push(id as ActorId)
    }
    for (const e of events) {
      if (typeof e.actorId === 'string' && e.actorId) add(e.actorId)
      else {
        // Legacy pre-cut-over rows: `eventActorKey` falls back to `data.userId`,
        // so the summary resolver will ask for that actor — request it too.
        const legacy = e.data?.userId
        if (typeof legacy === 'string' && legacy) add(toActorId('user', legacy))
      }
      if (e.type === 'thread:assignee:changed') {
        const branded = e.data.assigneeActorId
        const legacyTo = e.data?.toUserId
        if (typeof branded === 'string' && branded) add(branded)
        else if (typeof legacyTo === 'string' && legacyTo) add(toActorId('user', legacyTo))
      }
    }
    return ids
  }, [events])

  useEffect(() => {
    for (const id of actorIds) getActorStoreState().requestActor(id)
  }, [actorIds])

  const actorsMap = useActors(actorIds)

  const actorLabel = useCallback<GroupActorLabelResolver>(
    (actorKey, sample) => {
      if (currentUserKey && actorKey === currentUserKey) return 'You'
      if (actorKey.startsWith('actor:')) {
        const id = actorKey.slice('actor:'.length) as ActorId
        const actor = actorsMap.get(id)
        return actor?.name || 'A teammate'
      }
      if (actorKey.startsWith('source:')) {
        const source = pickEventSource(sample)
        if (!source) return 'Automation'
        switch (source.kind) {
          case 'workflow':
            return source.name ? `Workflow "${source.name}"` : 'A workflow'
          case 'mail_filter':
            return source.name ? `Filter "${source.name}"` : 'A filter'
          case 'record_rule':
            return source.name ? `Rule "${source.name}"` : 'A rule'
          case 'classification':
            return 'AI classification'
          default:
            return 'Automation'
        }
      }
      return 'System'
    },
    [actorsMap, currentUserKey]
  )

  const facepile = useMemo<FacepileActor[]>(() => {
    const seen = new Set<string>()
    const result: FacepileActor[] = []
    for (const e of events) {
      const key = eventActorKey(e)
      if (seen.has(key) || result.length >= 3) continue
      seen.add(key)
      if (key.startsWith('actor:')) {
        const id = key.slice('actor:'.length) as ActorId
        const actor = actorsMap.get(id)
        result.push({
          key,
          type: actorAvatarType(id, actor?.type),
          avatarUrl: actor?.avatarUrl ?? null,
          isTeam: !!actor && isWorkerActor(actor) && actor.workerType === 'team',
        })
      } else {
        result.push({ key, type: 'system', avatarUrl: null })
      }
    }
    return result
  }, [events, actorsMap])

  return { actorLabel, facepile }
}
