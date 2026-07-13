// packages/ui/src/components/calendar/use-calendar-keyboard.ts

'use client'

import {
  addDays,
  addMonths,
  addYears,
  endOfMonth,
  endOfWeek,
  isAfter,
  isBefore,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
  subYears,
} from 'date-fns'
import * as React from 'react'
import { getMonthWeeks, toDayKey } from './utils'

export interface UseCalendarKeyboardOptions {
  /** Ref on the calendar root — used to imperatively focus a day button by its `data-day`. */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Anchor (first visible) month. */
  month: Date
  numberOfMonths: number
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  /** Preferred default focus target (selected date, or a range's `from`) when nothing has been
   * focused yet — used only if it falls within the currently visible month(s). */
  anchorDate?: Date
  isDayDisabled: (date: Date) => boolean
  /** Called to page the anchor month when keyboard nav moves past the visible window. */
  onMonthChange: (month: Date) => void
  /** Focus the roving-tabindex day button once, on mount. */
  autoFocus?: boolean
}

export interface UseCalendarKeyboardResult {
  /** The date that currently owns `tabIndex=0` — exactly one day button per calendar. */
  tabbableDate: Date
  onGridKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  /** Sync the roving-tabindex target from outside (day click, day focus/tab-into). */
  setFocusedDate: (date: Date) => void
}

/**
 * Roving-tabindex + arrow-key navigation for the calendar grid(s). Arrow keys always move the
 * focus target by a day/week regardless of `disabled` (disabled days are inert, not skipped —
 * see `CalendarDay`'s doc comment). Moving past the visible month(s) re-anchors the displayed
 * window so the target month becomes the first visible month, keeping focus on the target day.
 */
export function useCalendarKeyboard({
  containerRef,
  month,
  numberOfMonths,
  weekStartsOn,
  anchorDate,
  isDayDisabled,
  onMonthChange,
  autoFocus,
}: UseCalendarKeyboardOptions): UseCalendarKeyboardResult {
  const [focusedDate, setFocusedDate] = React.useState<Date | undefined>(undefined)

  const visibleStart = startOfMonth(month)
  const visibleEnd = endOfMonth(addMonths(month, Math.max(numberOfMonths, 1) - 1))
  const inVisibleRange = React.useCallback(
    (date: Date) => !isBefore(date, visibleStart) && !isAfter(date, visibleEnd),
    [visibleStart, visibleEnd]
  )

  const defaultTarget = React.useMemo(() => {
    if (anchorDate && inVisibleRange(anchorDate)) return anchorDate
    const today = new Date()
    if (inVisibleRange(today)) return today
    const weeks = getMonthWeeks(month, weekStartsOn)
    const days = weeks.flat()
    const firstEnabled = days.find((d) => isSameMonth(d, month) && !isDayDisabled(d))
    return firstEnabled ?? days[0] ?? month
  }, [anchorDate, inVisibleRange, month, weekStartsOn, isDayDisabled])

  const tabbableDate = focusedDate ?? defaultTarget

  const focusDay = React.useCallback(
    (date: Date) => {
      const key = toDayKey(date)
      const target = containerRef.current?.querySelector<HTMLButtonElement>(`[data-day="${key}"]`)
      if (target && document.activeElement !== target) target.focus()
    },
    [containerRef]
  )

  // Imperatively move DOM focus whenever the focus target actually changes (keyboard nav or an
  // explicit day focus/click) — but never on mount unless `autoFocus`, and never as a side
  // effect of paging the month via mouse (that would steal focus from the nav button just
  // clicked).
  React.useEffect(() => {
    if (!focusedDate) return
    focusDay(focusedDate)
  }, [focusedDate, focusDay])

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus the initial target once, on mount only
  React.useEffect(() => {
    if (autoFocus) focusDay(defaultTarget)
  }, [])

  const onGridKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const current = focusedDate ?? tabbableDate
      let next: Date | undefined

      switch (event.key) {
        case 'ArrowLeft':
          next = addDays(current, -1)
          break
        case 'ArrowRight':
          next = addDays(current, 1)
          break
        case 'ArrowUp':
          next = addDays(current, -7)
          break
        case 'ArrowDown':
          next = addDays(current, 7)
          break
        case 'Home':
          next = startOfWeek(current, { weekStartsOn })
          break
        case 'End':
          next = endOfWeek(current, { weekStartsOn })
          break
        case 'PageUp':
          next = event.shiftKey ? subYears(current, 1) : subMonths(current, 1)
          break
        case 'PageDown':
          next = event.shiftKey ? addYears(current, 1) : addMonths(current, 1)
          break
        default:
          return
      }

      event.preventDefault()
      setFocusedDate(next)
      if (!inVisibleRange(next)) onMonthChange(startOfMonth(next))
    },
    [focusedDate, tabbableDate, weekStartsOn, inVisibleRange, onMonthChange]
  )

  return { tabbableDate, onGridKeyDown, setFocusedDate }
}
