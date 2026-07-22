// apps/web/src/components/calendar/ui/mini-calendar-section.tsx

'use client'

import { MiniMonthCalendar } from '@auxx/ui/components/mini-month-calendar'
import { addDays } from 'date-fns'

interface MiniCalendarSectionProps {
  date: Date
  onDateChange: (date: Date) => void
  /** The shell's current visible range — already end-inclusive (`endOfDay`/`endOfWeek`/
   * `endOfMonth`, the `useCalendarRange` convention), so it's passed straight through to
   * `MiniMonthCalendar`'s `visibleRange` without adjustment (except for `view === 'week'`,
   * see below). */
  visibleRange: { from: Date; to: Date }
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  /** Per-day density counts (keyed `'yyyy-MM-dd'`), rendered as a dot under the day number. */
  density?: Record<string, number>
  /** Fires whenever the displayed month changes — the consumer owns the displayed-month
   * state and its own density query (plan §3.4); this component has no internal state of
   * its own. */
  onMonthChange?: (month: Date) => void
  /** Optional — no caller currently threads this through (13-week-view-horizontal-stream.md
   * §2.4 gap: `view` isn't part of any of this component's callers' props today). When
   * provided and `'week'`, the highlighted band narrows to the true visible week
   * (`date .. date+6`) instead of `visibleRange`, which is now the week stream's wider
   * rendered window (~17 days incl. overscan). Leave unset to keep current (month/day)
   * behavior. `timeline` (plan 18) falls through to `visibleRange` like `day`/`month`. */
  view?: 'day' | 'week' | 'month' | 'timeline'
}

/**
 * Mini month calendar header, generalized from dispatch's `MiniCalendarSection` (plan §3.4) —
 * fully controlled: the consumer owns the displayed month and computes `density`, this
 * component only renders `MiniMonthCalendar` inside the shared bordered-section wrapper.
 */
export function MiniCalendarSection({
  date,
  onDateChange,
  visibleRange,
  weekStartsOn,
  density,
  onMonthChange,
  view,
}: MiniCalendarSectionProps) {
  const band = view === 'week' ? { from: date, to: addDays(date, 6) } : visibleRange
  return (
    <div className='border-sidebar-border border-b pb-2'>
      <MiniMonthCalendar
        selected={date}
        onSelect={onDateChange}
        visibleRange={band}
        density={density}
        weekStartsOn={weekStartsOn}
        onMonthChange={onMonthChange}
      />
    </div>
  )
}
