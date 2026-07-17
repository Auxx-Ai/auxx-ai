// apps/web/src/components/calendar/core/use-calendar-range.ts

'use client'

import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { useCallback, useEffect, useRef, useState } from 'react'

/** The calendar shell's grid modes — shared by dispatch's `BoardViewMode`. `timeline` is the
 * dispatch resource-stream mode (plan 18); it behaves like `day` for range quantization. */
export type CalendarRangeView = 'day' | 'week' | 'month' | 'timeline'

export interface DateRange {
  from: Date
  to: Date
}

/** The covering fetch window for a date in a given view — the day/week/month the calendar renders
 * around `date`. Used to seed the initial `range` (below) so a deep-linked date+view fetches its
 * real window on first paint instead of today's day and then correcting on mount. Mirrors
 * `EventCalendar`'s own `rangeFrom/rangeTo` derivation. */
function windowFor(date: Date, view: CalendarRangeView, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6) {
  if (view === 'month') {
    const monthStart = startOfMonth(endOfWeek(date, { weekStartsOn }))
    return {
      from: startOfWeek(monthStart, { weekStartsOn }),
      to: endOfWeek(endOfMonth(monthStart), { weekStartsOn }),
    }
  }
  if (view === 'week') {
    return { from: startOfWeek(date, { weekStartsOn }), to: endOfWeek(date, { weekStartsOn }) }
  }
  return { from: startOfDay(date), to: endOfDay(date) }
}

/**
 * Date/view/range state shared by every calendar shell consumer, extracted verbatim from
 * `dispatch/ui/board/hooks/use-board-data.ts:41-83` (plan §3.2). `range` is fed by
 * `EventCalendar`'s `onRangeChange` — stored by timestamp so identical ranges (same
 * day/view recomputed) don't churn a consumer's query key.
 */
export function useCalendarRange(
  initialView: CalendarRangeView = 'day',
  /** `date-fns` week-start index — no caller currently threads the org's `organization.weekStart`
   * setting through this hook (both call sites compute it a level away, for their own toolbar
   * needs), so this defaults to Monday like the rest of the app's fallback chain. Only used to
   * quantize the week stream's fetch window (below) to whole weeks; a mismatched boundary still
   * over-covers the true visible range, it just doesn't align the padding to the org's actual
   * week start. */
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1,
  /** Optional controlled `date`/`view` — when a consumer owns these elsewhere (e.g. the dispatch
   * board persists them in the URL via nuqs), pass them here and this hook reads them instead of
   * its own state; the returned `setDate`/`setView` then only drive the fallback internal state
   * (unused by controlled consumers, which write through their own setters). Omit for the internal
   * state behaviour (schedule page, records calendar view). */
  controlled?: { date?: Date; view?: CalendarRangeView }
) {
  const [internalDate, setInternalDate] = useState(() => new Date())
  const [internalView, setInternalView] = useState<CalendarRangeView>(initialView)
  const date = controlled?.date ?? internalDate
  const view = controlled?.view ?? internalView
  const setDate = setInternalDate
  const setView = setInternalView
  // Seed the fetch window from the (possibly controlled) date+view so a deep-linked month/week
  // fetches its real range on first paint. For the default day view this equals the calendar's
  // own day-view calc, so the first `onRangeChange` (in the calendar's mount effect) is a no-op
  // query-key match instead of a second fetch.
  const [range, setRange] = useState<DateRange>(() =>
    windowFor(controlled?.date ?? new Date(), controlled?.view ?? initialView, weekStartsOn)
  )

  const rangeDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(rangeDebounceRef.current), [])

  const handleRangeChange = useCallback(
    (from: Date, to: Date) => {
      // Every mode now reports a sliding rendered-window range on each scroll frame — month/week
      // stream whole months/weeks, and `day`/`timeline` are rolling day-streams (plan 18). Quantize
      // to the whole covering unit so a consumer's range-scoped query key only changes when a new
      // month/week/day scrolls into view, and debounce so a fast fling doesn't fetch every one crossed.
      const quantizedFrom =
        view === 'month'
          ? startOfMonth(from)
          : view === 'week'
            ? startOfWeek(from, { weekStartsOn })
            : startOfDay(from)
      const quantizedTo =
        view === 'month'
          ? endOfMonth(to)
          : view === 'week'
            ? endOfWeek(to, { weekStartsOn })
            : endOfDay(to)
      const apply = () =>
        setRange((prev) =>
          prev.from.getTime() === quantizedFrom.getTime() &&
          prev.to.getTime() === quantizedTo.getTime()
            ? prev
            : { from: quantizedFrom, to: quantizedTo }
        )
      clearTimeout(rangeDebounceRef.current)
      rangeDebounceRef.current = setTimeout(apply, 250)
    },
    [view, weekStartsOn]
  )

  return { date, setDate, view, setView, range, handleRangeChange }
}
