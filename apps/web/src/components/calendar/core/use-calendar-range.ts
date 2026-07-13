// apps/web/src/components/calendar/core/use-calendar-range.ts

'use client'

import { endOfDay, endOfMonth, startOfDay, startOfMonth } from 'date-fns'
import { useCallback, useEffect, useRef, useState } from 'react'

/** The calendar shell's three grid modes — shared by dispatch's `BoardViewMode`. */
export type CalendarRangeView = 'day' | 'week' | 'month'

export interface DateRange {
  from: Date
  to: Date
}

/**
 * Date/view/range state shared by every calendar shell consumer, extracted verbatim from
 * `dispatch/ui/board/hooks/use-board-data.ts:41-83` (plan §3.2). `range` is fed by
 * `EventCalendar`'s `onRangeChange` — stored by timestamp so identical ranges (same
 * day/view recomputed) don't churn a consumer's query key.
 */
export function useCalendarRange(initialView: CalendarRangeView = 'day') {
  const [date, setDate] = useState(() => new Date())
  const [view, setView] = useState<CalendarRangeView>(initialView)
  // Matches the calendar's own day-view range calc (`startOfDay`/`endOfDay`) so the first
  // `onRangeChange` firing (in the calendar's mount effect) is a no-op query-key match
  // instead of a second fetch.
  const [range, setRange] = useState<DateRange>(() => ({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  }))

  const rangeDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(rangeDebounceRef.current), [])

  const handleRangeChange = useCallback(
    (from: Date, to: Date) => {
      // The month stream reports a sliding week window on every scroll — quantize it to
      // whole covering months so a consumer's range-scoped query key only changes when a new
      // month scrolls into view, and debounce so a fast fling doesn't fetch every month
      // crossed.
      const quantizedFrom = view === 'month' ? startOfMonth(from) : from
      const quantizedTo = view === 'month' ? endOfMonth(to) : to
      const apply = () =>
        setRange((prev) =>
          prev.from.getTime() === quantizedFrom.getTime() &&
          prev.to.getTime() === quantizedTo.getTime()
            ? prev
            : { from: quantizedFrom, to: quantizedTo }
        )
      clearTimeout(rangeDebounceRef.current)
      if (view === 'month') {
        rangeDebounceRef.current = setTimeout(apply, 250)
      } else {
        apply()
      }
    },
    [view]
  )

  return { date, setDate, view, setView, range, handleRangeChange }
}
