// packages/ui/src/components/calendar/types.ts

import type * as React from 'react'

/** An inclusive date range. `to` is undefined while the range is still being picked. */
export type DateRange = {
  from: Date
  to?: Date
}

/** Which body is rendered under the caption for the *first* month. */
export type CalendarView = 'days' | 'year-month'

export type CalendarBaseProps = {
  /** Displayed (anchor) month. Controlled — pass together with `onMonthChange`. */
  month?: Date
  /** Uncontrolled initial month. Falls back to `selected` (or its `.from`) then today. */
  defaultMonth?: Date
  /** Fires whenever the displayed month changes: nav clicks, keyboard paging, year-month pick. */
  onMonthChange?: (month: Date) => void
  /** Months rendered side by side. Default 1. */
  numberOfMonths?: number
  /** 0 = Sunday. Default 0. */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  /** Predicate for disabled days, combined with `minDate`/`maxDate`. */
  disabled?: (date: Date) => boolean
  minDate?: Date
  maxDate?: Date
  /** Show leading/trailing days from adjacent months. Default true; forced false when
   * `numberOfMonths > 1`. */
  showOutsideDays?: boolean
  /**
   * Always render 6 week rows, padding short months with trailing days so the calendar's
   * height never changes when paging between months. Default false.
   */
  fixedWeeks?: boolean
  hideNavigation?: boolean
  /**
   * `'label'` = static centered caption (default). `'dropdown'` = the date-time-picker
   * header look — clicking the month/year label swaps the grid body for `YearMonthView`.
   */
  captionLayout?: 'label' | 'dropdown'
  /** Focus the roving-tabindex day button on mount. */
  autoFocus?: boolean
  /** Extra content rendered inside the day button (density dots, event indicators). */
  renderDay?: (day: { date: Date; outside: boolean }) => React.ReactNode
  /**
   * Named predicates → `data-<kebab-name>` boolean attributes on the day cell, e.g.
   * `{ visibleRange: fn }` renders `data-visible-range` on matching days.
   */
  modifiers?: Record<string, (date: Date) => boolean>
  className?: string
}

export type CalendarSingleProps = CalendarBaseProps & {
  mode?: 'single'
  selected?: Date
  onSelect?: (date: Date) => void
}

export type CalendarRangeProps = CalendarBaseProps & {
  mode: 'range'
  selected?: DateRange
  onSelect?: (range: DateRange) => void
}

/**
 * Props for `Calendar`. Discriminated on `mode` — `mode: 'range'` narrows `selected`/`onSelect`
 * to `DateRange`; omitted or `'single'` narrows them to `Date`. Clicking a day always selects
 * it (no deselection).
 */
export type CalendarProps = CalendarSingleProps | CalendarRangeProps

/** Internal, fully-resolved options shared by the day-disabled resolver. */
export type DisabledResolverOptions = {
  disabled?: (date: Date) => boolean
  minDate?: Date
  maxDate?: Date
}
