// packages/ui/src/components/mini-month-calendar.tsx

'use client'

import { Calendar } from '@auxx/ui/components/calendar'
import { cn } from '@auxx/ui/lib/utils'
import { format, isAfter, isBefore, isSameMonth, startOfDay } from 'date-fns'
import * as React from 'react'

interface MiniMonthCalendarProps {
  /** The selected/anchor date (e.g. the board date). */
  selected: Date
  onSelect: (date: Date) => void
  /** Highlighted date range (e.g. the board's visible days) — independent of `selected`. */
  visibleRange?: { from: Date; to: Date }
  /** Visit-density counts keyed by `'yyyy-MM-dd'`, rendered as a dot under the day number. */
  density?: Record<string, number>
  /** First day of the week (0 = Sunday), from the org's `weekStart` setting — keep in sync
   * with the main calendar grid. */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  className?: string
  /** Fires whenever the displayed month changes (free navigation or `selected` resyncing it) —
   * lets a caller fetch density data for whichever month is actually on screen. */
  onMonthChange?: (month: Date) => void
}

/**
 * Compact month calendar for the module sidebar (Notion-Calendar style): free month
 * navigation, a visible-range highlight, and per-day density dots. Built on the custom
 * `@auxx/ui/components/calendar` primitive, sized down to fit a 16rem sidebar.
 *
 * The displayed month follows `selected` (resyncs whenever `selected` moves to a different
 * month, e.g. the board date jumps via the toolbar) but the user can freely page prev/next
 * without that immediately re-selecting a date.
 */
function MiniMonthCalendar({
  selected,
  onSelect,
  visibleRange,
  density,
  weekStartsOn,
  className,
  onMonthChange,
}: MiniMonthCalendarProps) {
  const [month, setMonth] = React.useState(selected)

  // Read the current month via a ref so this effect can stay keyed to `selected` without a `month`
  // dep (which would fight free prev/next navigation). Both `setMonth` and the parent-owned
  // `onMonthChange` run in the effect BODY — calling `onMonthChange` inside a `setMonth` updater
  // would fire a parent setState during this component's render ("Cannot update a component while
  // rendering a different component"), which destabilizes sibling commits.
  const monthRef = React.useRef(month)
  monthRef.current = month

  React.useEffect(() => {
    if (isSameMonth(monthRef.current, selected)) return
    setMonth(selected)
    onMonthChange?.(selected)
  }, [selected, onMonthChange])

  const handleMonthChange = React.useCallback(
    (nextMonth: Date) => {
      setMonth(nextMonth)
      onMonthChange?.(nextMonth)
    },
    [onMonthChange]
  )

  const renderDay = React.useCallback(
    ({ date }: { date: Date; outside: boolean }) => {
      const key = format(date, 'yyyy-MM-dd')
      const count = density?.[key] ?? 0
      if (count <= 0) return null

      return (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-current',
            count >= 4 ? 'opacity-90' : 'opacity-40'
          )}
        />
      )
    },
    [density]
  )

  const modifiers = React.useMemo(() => {
    if (!visibleRange) return undefined
    const from = startOfDay(visibleRange.from)
    const to = startOfDay(visibleRange.to)
    return {
      visibleRange: (date: Date) => {
        const day = startOfDay(date)
        return !isBefore(day, from) && !isAfter(day, to)
      },
    }
  }, [visibleRange])

  return (
    <Calendar
      selected={selected}
      onSelect={onSelect}
      month={month}
      onMonthChange={handleMonthChange}
      weekStartsOn={weekStartsOn}
      showOutsideDays
      // Always render 6 rows so paging between 5- and 6-week months doesn't shift the
      // sidebar's height (and the board content below it).
      fixedWeeks
      renderDay={renderDay}
      modifiers={modifiers}
      className={cn('p-2 [&_[data-slot=day][data-visible-range]]:bg-accent/50', className)}
    />
  )
}

export { MiniMonthCalendar }
