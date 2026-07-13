// apps/web/src/components/dispatch/ui/sidebar/mini-calendar-section.tsx

'use client'

import { MiniMonthCalendar } from '@auxx/ui/components/mini-month-calendar'
import { useState } from 'react'
import type { WeekStartIndex } from '../board/utils'
import { useMiniCalendarDensity } from './hooks/use-mini-calendar-density'

interface MiniCalendarSectionProps {
  date: Date
  onDateChange: (date: Date) => void
  /** The board's current visible range — already end-inclusive (`endOfDay`/`endOfWeek`/
   * `endOfMonth`, the `use-board-data.ts` convention), so it's passed straight through to
   * `MiniMonthCalendar`'s `visibleRange` without adjustment. */
  visibleRange: { from: Date; to: Date }
  weekStartsOn: WeekStartIndex
  hiddenWorkerIds: string[]
}

/** Mini month calendar header (v3 sidebar plan §1.2/§1.4) — owns the density query's displayed
 * month (via `MiniMonthCalendar`'s `onMonthChange`), independent of the board's own `date`. */
export function MiniCalendarSection({
  date,
  onDateChange,
  visibleRange,
  weekStartsOn,
  hiddenWorkerIds,
}: MiniCalendarSectionProps) {
  const [displayMonth, setDisplayMonth] = useState(date)
  const { density } = useMiniCalendarDensity(displayMonth, weekStartsOn, hiddenWorkerIds)

  return (
    <div className='border-sidebar-border border-b'>
      <MiniMonthCalendar
        selected={date}
        onSelect={onDateChange}
        visibleRange={visibleRange}
        density={density}
        weekStartsOn={weekStartsOn}
        onMonthChange={setDisplayMonth}
      />
    </div>
  )
}
