// packages/ui/src/components/event-calendar/time-range-pill.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'

import { formatTimeWithOptionalMinutes } from './utils'

interface TimeRangePillProps {
  start: Date
  end: Date
  className?: string
}

/**
 * The small dark start–end readout shown while a chip is being drag-moved (on the `DragOverlay`
 * ghost) or edge-resized (anchored to the dragged edge) — plan 35 §3. Deliberately a fixed dark
 * chip in BOTH themes so it reads as a floating tooltip, not a chip.
 */
export function TimeRangePill({ start, end, className }: TimeRangePillProps) {
  return (
    <span
      className={cn(
        'pointer-events-none rounded-md bg-zinc-950/90 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-zinc-50 tabular-nums shadow-sm dark:bg-zinc-800/95',
        className
      )}>
      {formatTimeWithOptionalMinutes(start)} – {formatTimeWithOptionalMinutes(end)}
    </span>
  )
}
