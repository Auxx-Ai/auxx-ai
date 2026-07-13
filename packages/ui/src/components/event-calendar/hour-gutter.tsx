// packages/ui/src/components/event-calendar/hour-gutter.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'

import { CurrentTimeGutterLabel } from './current-time-line'

interface HourGutterProps {
  hours: Date[]
  /** When set, renders the current-time pill at this vertical percentage. */
  nowIndicator?: { position: number; label: string }
  className?: string
}

/**
 * Fixed-width hour-label column shared by day/week/resource grids — labels
 * render "9 AM"-style (12h, matching the app's en-US convention), small and
 * muted, straddling each hour rule (Notion-calendar look). No vertical border
 * against the grid — the gutter reads as a clean label rail, not a boxed cell.
 */
export function HourGutter({ hours, nowIndicator, className }: HourGutterProps) {
  return (
    <div className={cn('relative w-12 shrink-0 sm:w-14', className)}>
      {hours.map((hour, index) => (
        <div
          key={hour.toISOString()}
          className='relative flex h-[var(--week-cells-height)] items-start justify-center border-b border-border/70 last:border-b-0'>
          {index > 0 && (
            <span className='text-muted-foreground/70 -translate-y-1/2 text-[10px] font-medium'>
              {format(hour, 'h a')}
            </span>
          )}
        </div>
      ))}
      {nowIndicator && (
        <CurrentTimeGutterLabel position={nowIndicator.position} label={nowIndicator.label} />
      )}
    </div>
  )
}
