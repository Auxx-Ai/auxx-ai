// apps/web/src/components/dispatch/ui/sidebar/mini-calendar-section.tsx

'use client'

import { useState } from 'react'
import { MiniCalendarSection as GenericMiniCalendarSection } from '~/components/calendar/ui/mini-calendar-section'
import type { WeekStartIndex } from '../board/utils'
import { useMiniCalendarDensity } from './hooks/use-mini-calendar-density'

interface MiniCalendarSectionProps {
  date: Date
  onDateChange: (date: Date) => void
  /** The board's current visible range — already end-inclusive (`endOfDay`/`endOfWeek`/
   * `endOfMonth`, the `use-board-data.ts` convention), so it's passed straight through to
   * `MiniMonthCalendar`'s `visibleRange` without adjustment (except for `view === 'week'`, see
   * `view` below). */
  visibleRange: { from: Date; to: Date }
  weekStartsOn: WeekStartIndex
  hiddenWorkerIds: string[]
  /** Week view narrows the band to the visible week (13-week-view-horizontal-stream.md §2.4);
   * unset (map mode) falls back to `visibleRange`. */
  view?: 'day' | 'week' | 'month'
}

/**
 * Dispatch's mini month calendar header (v3 sidebar plan §1.2/§1.4, thinned onto the shared
 * shell per plan §3.4) — owns the density query's displayed month + the
 * `useMiniCalendarDensity` call (dispatch-shaped: filtered by worker visibility), then renders
 * the generic `MiniCalendarSection` from `~/components/calendar/ui/` fully controlled.
 */
export function MiniCalendarSection({
  date,
  onDateChange,
  visibleRange,
  weekStartsOn,
  hiddenWorkerIds,
  view,
}: MiniCalendarSectionProps) {
  const [displayMonth, setDisplayMonth] = useState(date)
  const { density } = useMiniCalendarDensity(displayMonth, weekStartsOn, hiddenWorkerIds)

  return (
    <GenericMiniCalendarSection
      date={date}
      onDateChange={onDateChange}
      visibleRange={visibleRange}
      weekStartsOn={weekStartsOn}
      density={density}
      onMonthChange={setDisplayMonth}
      view={view}
    />
  )
}
