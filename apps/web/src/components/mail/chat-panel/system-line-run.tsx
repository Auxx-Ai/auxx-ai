// apps/web/src/components/mail/chat-panel/system-line-run.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown } from 'lucide-react'
import { Fragment, type ReactNode, useState } from 'react'
import { eventActorKey } from '../chat-timeline'
import { type ChatThreadEvent, SystemLine, TagLine, useEventActor } from './system-line'

interface SystemLineRunProps {
  /** ≥2 consecutive same-actor events, ASC — produced by `buildChatTimeline`. */
  events: ChatThreadEvent[]
}

/**
 * Collapsed summary line for an `event-run` timeline item (admin surfaces
 * only — the widget keeps flat lines). Same centered/muted visual language as
 * `SystemLine`: the actor prefix once, then composed fragments — "Markus
 * marked as done and tagged with x, y" — with a chevron toggle that expands to
 * the individual `SystemLine` rows. Runs that don't compose cleanly (a
 * non-composable type, or the mixed-actor case that shouldn't occur by
 * construction) fall back to "made N updates".
 */
export function SystemLineRun({ events }: SystemLineRunProps) {
  const [expanded, setExpanded] = useState(false)
  const first = events[0]
  const actor = useEventActor(first)
  if (!first) return null

  const prefix = actor.label
  // Actor identity is part of the run key, so a mixed run shouldn't exist —
  // but guard anyway and degrade to the count summary.
  const sameActor = events.every((e) => eventActorKey(e) === eventActorKey(first))
  const fragments = events.map(eventRunFragment)
  const composable = sameActor && fragments.every((f) => f !== null)

  let summary: ReactNode
  if (!composable) {
    const count = `made ${events.length} updates`
    summary = sameActor && prefix ? `${prefix} ${count}` : `${events.length} updates`
  } else {
    const parts: ReactNode[] = []
    fragments.forEach((fragment, i) => {
      if (!fragment) return
      if (i > 0) parts.push(i === fragments.length - 1 ? ' and ' : ', ')
      const text = i === 0 && !prefix ? capitalize(fragment.text) : fragment.text
      if (fragment.tags && fragment.tags.length > 0) {
        parts.push(<TagLine text={text} tags={fragment.tags} />)
      } else {
        parts.push(text)
      }
    })
    summary = (
      <>
        {prefix ? `${prefix} ` : null}
        {parts.map((part, i) => (
          <Fragment key={i}>{part}</Fragment>
        ))}
      </>
    )
  }

  const timestamp = `${new Date(first.createdAt).toLocaleString()} – ${new Date(
    events[events.length - 1]!.createdAt
  ).toLocaleString()}`

  return (
    <div className='flex flex-col items-stretch gap-1 self-center'>
      <button
        type='button'
        onClick={() => setExpanded((v) => !v)}
        title={timestamp}
        aria-expanded={expanded}
        className='inline-flex flex-wrap items-center justify-center gap-1 self-center px-3 text-center text-xs italic text-muted-foreground transition-colors hover:text-foreground'>
        <span className='inline-flex flex-wrap items-center justify-center gap-1'>{summary}</span>
        <ChevronDown
          className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-180')}
        />
      </button>
      {expanded && events.map((event) => <SystemLine key={event.id} event={event} />)}
    </div>
  )
}

/**
 * The composable verb phrase for one event inside a run summary — no actor
 * prefix, no per-event lookups. Returns null for types that only read as a
 * full sentence (visitor identified); a null anywhere makes the whole run fall
 * back to the "made N updates" summary.
 */
export function eventRunFragment(event: ChatThreadEvent): { text: string; tags?: string[] } | null {
  switch (event.type) {
    case 'thread:taken_over':
      return { text: 'took over the conversation' }
    case 'thread:returned_to_ai':
      return { text: 'returned the conversation to AI' }
    case 'thread:archived':
      return { text: 'marked as done' }
    case 'thread:reopened':
      return { text: 'reopened the conversation' }
    case 'thread:assignee:changed':
      // The summary stays generic; the expanded row names the assignee.
      return { text: 'changed the assignee' }
    case 'thread:tagged':
      return { text: 'tagged with', tags: pickTags(event) }
    case 'thread:untagged':
      return { text: 'removed tags', tags: pickTags(event) }
    case 'thread:merged':
      return { text: 'merged a conversation into this one' }
    default:
      return null
  }
}

function pickTags(event: ChatThreadEvent): string[] {
  const names = event.data.tagNames
  if (!Array.isArray(names)) return []
  return names.filter((n): n is string => typeof n === 'string' && n.length > 0)
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
