// apps/web/src/components/workflow/shared/test-events/test-event-list.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { formatDistanceToNow } from 'date-fns'
import { Clock } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { BaseTestEvent } from './types'

interface TestEventListProps<T extends BaseTestEvent> {
  events: T[]
  onClear: () => void
  /** Leading icon shared by every row (all events in a list share a source). Omit for none. */
  icon?: ReactNode
  /** The collapsed row title — a source/method/topic badge. */
  renderTitle: (event: T) => ReactNode
  /** Extra inline meta after the timestamp on the secondary line (eventId, status…). */
  renderMeta?: (event: T) => ReactNode
  /** The expanded body — typically one or more read-only `CodeEditor`s. */
  renderDetail: (event: T) => ReactNode
  /** Optional actions appended inside the expanded body (e.g. "Use shape as schema"). */
  renderActions?: (event: T) => ReactNode
  /** Optional footer below the list (e.g. an "other topics" hint). Shown in the empty state too. */
  footer?: ReactNode
  /** Singular/plural noun for the count label (default event/events). */
  countNoun?: { one: string; many: string }
  emptyTitle?: string
  emptyDescription?: string
}

/**
 * Shared live test-event list — an expandable {@link TreeRow} per captured event with the
 * payload rendered inside via the caller's `renderDetail` (a read-only `CodeEditor`). The
 * source-specific bits (icon, title badge, payload blocks, expanded actions, footer hint) are
 * render-prop seams, so the app-trigger inspector, the generic WebhookEndpoint inspector, and
 * the workflow webhook node all render identically through this one component.
 */
export function TestEventList<T extends BaseTestEvent>({
  events,
  onClear,
  icon,
  renderTitle,
  renderMeta,
  renderDetail,
  renderActions,
  footer,
  countNoun = { one: 'event', many: 'events' },
  emptyTitle = 'No events captured yet',
  emptyDescription = 'Events will appear here in real time',
}: TestEventListProps<T>) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (events.length === 0) {
    return (
      <div className='space-y-2'>
        <EmptySection icon={icon} title={emptyTitle} description={emptyDescription} />
        {footer}
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <span className='text-xs text-muted-foreground'>
          {events.length} {events.length === 1 ? countNoun.one : countNoun.many} captured
        </span>
        <Button variant='ghost' size='xs' className='h-6' onClick={onClear}>
          Clear all
        </Button>
      </div>

      <div className='max-h-96 space-y-0.5 overflow-y-auto'>
        {events.map((event) => (
          <TreeRow
            key={event.id}
            icon={icon}
            title={renderTitle(event)}
            secondary={
              <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                <Clock className='size-3' />
                {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                {event.responseTime != null && <span>{event.responseTime}ms</span>}
                {renderMeta?.(event)}
              </span>
            }
            expandable
            isOpen={expanded.has(event.id)}
            onToggleOpen={() => toggle(event.id)}>
            <div className='space-y-2 py-1.5 pe-2 ps-12'>
              {renderDetail(event)}
              {renderActions?.(event)}
            </div>
          </TreeRow>
        ))}
      </div>

      {footer}
    </div>
  )
}
