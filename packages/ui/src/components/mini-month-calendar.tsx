// packages/ui/src/components/mini-month-calendar.tsx

'use client'

import { buttonVariants } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { format, isSameMonth } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import * as React from 'react'
import { type DayButtonProps, DayPicker, DayButton as RdpDayButton } from 'react-day-picker'

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
 * navigation, a visible-range highlight, and per-day density dots. Wraps `react-day-picker`
 * v9 using the same `classNames` styling approach as `calendar.tsx`, sized down to fit a
 * 16rem sidebar.
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

  const DensityDayButton = React.useCallback(
    (props: DayButtonProps) => {
      const key = format(props.day.date, 'yyyy-MM-dd')
      const count = density?.[key] ?? 0

      return (
        <RdpDayButton {...props}>
          <span>{props.day.date.getDate()}</span>
          {count > 0 && (
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-current',
                count >= 4 ? 'opacity-90' : 'opacity-40'
              )}
            />
          )}
        </RdpDayButton>
      )
    },
    [density]
  )

  return (
    <DayPicker
      mode='single'
      required
      selected={selected}
      onSelect={onSelect}
      month={month}
      onMonthChange={handleMonthChange}
      weekStartsOn={weekStartsOn}
      showOutsideDays
      modifiers={visibleRange ? { inVisibleRange: visibleRange } : undefined}
      modifiersClassNames={{ inVisibleRange: 'bg-accent/50' }}
      className={cn('p-2', className)}
      classNames={{
        months: 'flex flex-col',
        month: 'flex flex-col gap-1.5',
        month_caption: 'flex justify-center relative items-center w-full',
        caption_label: 'text-xs font-medium h-6 flex items-center',
        nav: 'flex items-center gap-1',
        button_previous: cn(
          buttonVariants({ variant: 'outline' }),
          'size-6 top-0.5 bg-transparent p-0 opacity-50 hover:opacity-100 absolute left-1 z-10'
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline' }),
          'size-6 top-0.5 bg-transparent p-0 opacity-50 hover:opacity-100 absolute right-1 z-10'
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-7 font-normal text-[0.65rem]',
        week: 'flex w-full mt-0.5',
        day: 'relative size-7 p-0 text-center',
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'relative size-7 p-0 text-xs font-normal aria-selected:opacity-100'
        ),
        selected:
          'bg-info text-white hover:bg-info! hover:text-primary-foreground focus:bg-info focus:text-primary-foreground',
        today: 'rounded-lg bg-accent-100 font-semibold text-info hover:bg-accent-200',
        outside: 'outside text-primary-300 aria-selected:text-muted-foreground',
        disabled: 'text-muted-foreground opacity-50',
        hidden: 'invisible',
      }}
      components={{
        DayButton: DensityDayButton,
        Chevron: ({ orientation, className: chevronClassName }) =>
          orientation === 'left' ? (
            <ChevronLeft className={cn('size-3.5', chevronClassName)} />
          ) : (
            <ChevronRight className={cn('size-3.5', chevronClassName)} />
          ),
      }}
    />
  )
}

export { MiniMonthCalendar }
