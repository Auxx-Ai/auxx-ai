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
 * muted, aligned to each hour rule (Notion-calendar look). No full-width rules
 * inside the gutter (they'd strike the labels) — just a short right-edge tick
 * continuing each grid rule.
 *
 * Each hour boundary also carries a full-gutter-width drag handle
 * (`data-hour-zoom-handle`) — the vertical grids' hour-zoom affordance, the
 * counterpart to the timeline's draggable hour borders. The gutter stays dumb:
 * `EventCalendar` owns the gesture via pointer delegation on that attribute.
 */
export function HourGutter({ hours, nowIndicator, className }: HourGutterProps) {
  return (
    <div data-slot='hour-gutter' className={cn('relative w-12 shrink-0 sm:w-14', className)}>
      {hours.map((hour, index) => (
        <div
          key={hour.toISOString()}
          className='relative flex h-[var(--week-cells-height)] items-start justify-center'>
          {index > 0 && (
            <>
              <span className='text-muted-foreground/70 -translate-y-1/2 text-[10px] font-medium'>
                {format(hour, 'h a')}
              </span>
              {/* Hour-zoom drag handle straddling the boundary — drag to rescale the hour
                  grid, double-click to reset. The tick stays small; it darkens and widens
                  a touch on hover as the affordance. */}
              <div
                data-hour-zoom-handle={index}
                className='group/zoom absolute inset-x-0 top-0 h-3 -translate-y-1/2 cursor-ns-resize touch-none'>
                <div className='bg-border/70 group-hover/zoom:bg-muted-foreground/60 absolute top-1/2 right-0 h-px w-1.5 -translate-y-1/2 transition-all group-hover/zoom:w-3' />
              </div>
            </>
          )}
        </div>
      ))}
      {nowIndicator && (
        <CurrentTimeGutterLabel position={nowIndicator.position} label={nowIndicator.label} />
      )}
    </div>
  )
}
