// apps/web/src/components/dispatch/ui/board/visit-chip-content.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { format, getMinutes } from 'date-fns'
import { Send } from 'lucide-react'
import type { DispatchVisitEvent } from './types'

/** Shared status→dot-color mapping — also used by the module sidebar's Backlog group rows
 * (`dispatch/ui/sidebar/backlog-group.tsx`). */
export const STATUS_ACCENT_CLASS: Record<DispatchVisitEvent['status'], string> = {
  scheduled: 'bg-info-500',
  en_route: 'bg-amber-500',
  on_site: 'bg-violet-500',
  done: 'bg-success-500',
  canceled: 'bg-muted-foreground/50',
}

interface VisitChipContentProps {
  event: DispatchVisitEvent
  isOverlapping?: boolean
}

/**
 * The board chip's inner content (07 §D.2): WO number + title + contact, a status-accent
 * left bar, and a dispatched indicator. Worker identity is carried by `event.color` (the
 * default chip tint, still applied by the surrounding `EventItem` wrapper the calendar
 * renders — `renderEvent` only replaces this inner content, not the outer chip shell).
 *
 * Height-tiered via container queries against the chip shell (plan 43 — `draggable-event.tsx`
 * makes explicitly-sized chips `container-type: size`): under 40px the contact inlines after
 * the title on one line; at ≥ 40px it gets its own line; at ≥ 56px the work order's address
 * appears as a third line. Duration-tall week/day chips hit the same tiers for free. With no
 * query container (e.g. a bare render outside the calendar) only the one-line base renders.
 */
export function VisitChipContent({ event, isOverlapping }: VisitChipContentProps) {
  const contact = event.workOrder?.contactDisplayName
  const address = event.workOrder?.addressText
  const canceled = event.status === 'canceled'
  const done = event.status === 'done'

  return (
    <div
      className={cn(
        'relative flex h-full w-full items-stretch gap-1.5 overflow-hidden rounded-[inherit]',
        done && 'opacity-60',
        canceled && 'opacity-50'
        // isOverlapping && 'ring-2 ring-inset ring-amber-500'
      )}>
      <span
        className={cn('w-1 shrink-0 rounded-full', STATUS_ACCENT_CLASS[event.status])}
        aria-hidden
      />
      <div className='min-w-0 flex-1 py-0.5'>
        <div
          className={cn(
            'flex items-center gap-1 text-[10px] font-semibold sm:text-xs',
            canceled && 'line-through'
          )}>
          {event.dispatchedAt && <Send className='size-3 shrink-0 opacity-70' />}
          <span className='truncate'>{event.title}</span>
          {contact && (
            <span className='min-w-0 truncate font-normal opacity-70 [@container(min-height:40px)]:hidden'>
              · {contact}
            </span>
          )}
        </div>
        {contact && (
          <div className='hidden truncate text-[10px] opacity-70 [@container(min-height:40px)]:block'>
            {contact}
          </div>
        )}
        {address && (
          <div className='hidden truncate text-[10px] opacity-60 [@container(min-height:56px)]:block'>
            {address}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Month-view chip content: a single dense line on the filled tinted chip (status-accent bar +
 * WO title + start time). Worker identity is the chip's tinted fill (set by the surrounding
 * `EventItem` wrapper via `--ec-color`); the left bar carries status. The rich two-line
 * `VisitChipContent` doesn't fit the fixed 24px month chip height.
 */
export function VisitChipMonthContent({ event }: { event: DispatchVisitEvent }) {
  const canceled = event.status === 'canceled'
  const done = event.status === 'done'
  // Provisional = planner math, never promised to a human (plan 20 §4.2/§4.3) — a tilde prefix
  // is enough treatment for the compact month chip; the surrounding opacity already mutes it,
  // and chips already open a popover so no title tooltip here.
  const provisional = event.timeConfirmedAt == null
  return (
    <div
      className={cn(
        'flex h-full w-full min-w-0 items-center gap-1.5',
        done && 'opacity-60',
        canceled && 'opacity-50'
      )}>
      <span
        className={cn('h-full w-1 shrink-0 rounded-full', STATUS_ACCENT_CLASS[event.status])}
        aria-hidden
      />
      <span className={cn('min-w-0 flex-1 truncate font-semibold', canceled && 'line-through')}>
        {event.title}
      </span>
      {event.dispatchedAt && <Send className='size-3 shrink-0 opacity-70' />}
      <span className='shrink-0 font-normal opacity-70'>
        {provisional && '~'}
        {format(event.start, getMinutes(event.start) === 0 ? 'ha' : 'h:mma').toLowerCase()}
      </span>
    </div>
  )
}
