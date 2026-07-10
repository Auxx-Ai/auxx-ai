// apps/web/src/components/dispatch/ui/board/visit-chip-content.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Send } from 'lucide-react'
import type { DispatchVisitEvent } from './types'

const STATUS_ACCENT_CLASS: Record<DispatchVisitEvent['status'], string> = {
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
 */
export function VisitChipContent({ event, isOverlapping }: VisitChipContentProps) {
  const contact = event.workOrder?.contactDisplayName

  return (
    <div
      className={cn(
        'relative flex h-full w-full items-stretch gap-1.5 overflow-hidden rounded-[inherit]',
        isOverlapping && 'ring-2 ring-inset ring-amber-500'
      )}>
      <span
        className={cn('w-1 shrink-0 rounded-full', STATUS_ACCENT_CLASS[event.status])}
        aria-hidden
      />
      <div className='min-w-0 flex-1 py-0.5'>
        <div className='flex items-center gap-1 truncate text-[10px] font-semibold sm:text-xs'>
          {event.dispatchedAt && <Send className='size-3 shrink-0 opacity-70' />}
          <span className='truncate'>{event.title}</span>
        </div>
        {contact && <div className='truncate text-[10px] opacity-70'>{contact}</div>}
      </div>
    </div>
  )
}
