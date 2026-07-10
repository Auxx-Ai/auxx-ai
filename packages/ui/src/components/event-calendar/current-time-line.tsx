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
          '-translate-y-1/2 rounded-full px-1.5 py-0.5 text-sm font-semibold whitespace-nowrap',
          CurrentTimeLabelClass
        )}>
        {label}
      </span>
    </div>
  )
}

/** The 2px accent line spanning a single day/resource column, aligned to `position`. */
export function CurrentTimeLine({ position }: { position: number }) {
  return (
    <div className='pointer-events-none absolute inset-x-0 z-20' style={{ top: `${position}%` }}>
      <div className={cn('h-0.5 w-full -translate-y-1/2', CurrentTimeLineClass)} />
    </div>
  )
}
