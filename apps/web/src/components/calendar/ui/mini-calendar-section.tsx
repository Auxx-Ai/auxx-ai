// apps/web/src/components/calendar/ui/mini-calendar-section.tsx

'use client'

import { MiniMonthCalendar } from '@auxx/ui/components/mini-month-calendar'

interface MiniCalendarSectionProps {
  date: Date
  onDateChange: (date: Date) => void
  /** The shell's current visible range — already end-inclusive (`endOfDay`/`endOfWeek`/
   * `endOfMonth`, the `useCalendarRange` convention), so it's passed straight through to
   * `MiniMonthCalendar`'s `visibleRange` without adjustment. */
  visibleRange: { from: Date; to: Date }
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  /** Per-day density counts (keyed `'yyyy-MM-dd'`), rendered as a dot under the day number. */
  density?: Record<string, number>
  /** Fires whenever the displayed month changes — the consumer owns the displayed-month
   * state and its own density query (plan §3.4); this component has no internal state of
   * its own. */
  onMonthChange?: (month: Date) => void
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
}: MiniCalendarSectionProps) {
  return (
    <div className='border-sidebar-border border-b'>
      <MiniMonthCalendar
        selected={date}
        onSelect={onDateChange}
        visibleRange={visibleRange}
        density={density}
        weekStartsOn={weekStartsOn}
        onMonthChange={onMonthChange}
      />
    </div>
  )
}
