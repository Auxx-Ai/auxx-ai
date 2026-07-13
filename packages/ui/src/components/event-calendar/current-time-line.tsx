// packages/ui/src/components/event-calendar/current-time-line.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'

import { CurrentTimeLabelClass, CurrentTimeLineClass } from './constants'

/** The "HH:mm" pill hanging in the hour gutter, aligned to `position`. */
export function CurrentTimeGutterLabel({ position, label }: { position: number; label: string }) {
  return (
    <div
      className='pointer-events-none absolute inset-x-0 z-20 flex justify-center'
      style={{ top: `${position}%` }}>
      <span
        className={cn(
          '-translate-y-1/2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap',
          CurrentTimeLabelClass
        )}>
        {label}
      </span>
    </div>
  )
}

/**
 * The hairline "now" indicator spanning a single day/resource column, aligned
 * to `position` — a 1px accent rule with a small leading dot at the gutter
 * edge (Notion-calendar look).
 */
export function CurrentTimeLine({ position }: { position: number }) {
  return (
    <div
      className='pointer-events-none absolute inset-x-0 z-20 flex -translate-y-1/2 items-center'
      style={{ top: `${position}%` }}>
      <span className={cn('-ml-1 size-2 shrink-0 rounded-full', CurrentTimeLineClass)} />
      <div className={cn('h-px w-full', CurrentTimeLineClass)} />
    </div>
  )
}
