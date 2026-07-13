// packages/ui/src/components/calendar/calendar.tsx

'use client'

import { buttonVariants } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { addMonths, isBefore, setMonth as setMonthOfDate, setYear, subMonths } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import * as React from 'react'
import { CalendarCaption } from './calendar-caption'
import { MonthGrid } from './month-grid'
import type { CalendarProps, CalendarView, DateRange } from './types'
import { useCalendarKeyboard } from './use-calendar-keyboard'
import { isDayDisabled as resolveDayDisabled, toDayKey } from './utils'
import { YearMonthView } from './year-month-view'

interface CalendarContextValue {
  mode: 'single' | 'range'
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  selectedDate?: Date
  selectedRange?: DateRange
  /** Hover preview range (range mode, `from` set and `to` unset). */
  previewRange?: DateRange
  /** `toDayKey` of the day that currently owns `tabIndex=0`. */
  tabbableKey: string
  isDayDisabled: (date: Date) => boolean
  modifiers?: Record<string, (date: Date) => boolean>
  renderDay?: (day: { date: Date; outside: boolean }) => React.ReactNode
  onDaySelect: (date: Date) => void
  onDayFocus: (date: Date) => void
  onDayHoverStart: (date: Date) => void
  onDayHoverEnd: () => void
}

const CalendarContext = React.createContext<CalendarContextValue | null>(null)

/** Consumed by `MonthGrid`/`CalendarDay` to read shared calendar state without prop-drilling. */
export function useCalendarContext(): CalendarContextValue {
  const ctx = React.useContext(CalendarContext)
  if (!ctx) throw new Error('Calendar subcomponents must be rendered inside <Calendar>')
  return ctx
}

function getSelectedAnchor(props: CalendarProps): Date | undefined {
  return props.mode === 'range' ? props.selected?.from : props.selected
}

/**
 * Fluid, container-queried month calendar with single/range selection, multi-month layout,
 * a label or date-time-picker-style dropdown caption, and full keyboard navigation. Replaces
 * `react-day-picker` — see `plans/calendar/custom-calendar-component-plan.md`.
 */
export function Calendar(props: CalendarProps) {
  const {
    month: monthProp,
    defaultMonth,
    onMonthChange,
    numberOfMonths: numberOfMonthsProp,
    weekStartsOn = 0,
    disabled,
    minDate,
    maxDate,
    showOutsideDays: showOutsideDaysProp,
    fixedWeeks = false,
    hideNavigation = false,
    captionLayout = 'label',
    autoFocus,
    renderDay,
    modifiers,
    className,
  } = props

  const mode: 'single' | 'range' = props.mode === 'range' ? 'range' : 'single'
  const selectedDate = props.mode !== 'range' ? props.selected : undefined
  const selectedRange = props.mode === 'range' ? props.selected : undefined

  const isMonthControlled = monthProp !== undefined
  const [internalMonth, setInternalMonth] = React.useState<Date>(
    () => monthProp ?? defaultMonth ?? getSelectedAnchor(props) ?? new Date()
  )
  const month = isMonthControlled ? (monthProp as Date) : internalMonth

  const goToMonth = (next: Date) => {
    if (!isMonthControlled) setInternalMonth(next)
    onMonthChange?.(next)
  }

  const [view, setView] = React.useState<CalendarView>('days')
  const [hoveredDate, setHoveredDate] = React.useState<Date | undefined>(undefined)

  const numberOfMonths = Math.max(numberOfMonthsProp ?? 1, 1)
  const showOutsideDays = numberOfMonths > 1 ? false : (showOutsideDaysProp ?? true)

  const months = React.useMemo(
    () => Array.from({ length: numberOfMonths }, (_, i) => addMonths(month, i)),
    [month, numberOfMonths]
  )

  const isDisabled = React.useCallback(
    (date: Date) => resolveDayDisabled(date, { disabled, minDate, maxDate }),
    [disabled, minDate, maxDate]
  )

  const previewRange = React.useMemo<DateRange | undefined>(() => {
    if (mode !== 'range' || !selectedRange?.from || selectedRange.to || !hoveredDate) {
      return undefined
    }
    return isBefore(hoveredDate, selectedRange.from)
      ? { from: hoveredDate, to: hoveredDate }
      : { from: selectedRange.from, to: hoveredDate }
  }, [mode, selectedRange, hoveredDate])

  const containerRef = React.useRef<HTMLDivElement>(null)

  const { tabbableDate, onGridKeyDown, setFocusedDate } = useCalendarKeyboard({
    containerRef,
    month,
    numberOfMonths,
    weekStartsOn,
    anchorDate: getSelectedAnchor(props),
    isDayDisabled: isDisabled,
    onMonthChange: goToMonth,
    autoFocus,
  })

  function handleDaySelect(date: Date) {
    if (isDisabled(date)) return
    if (props.mode === 'range') {
      const current = props.selected
      const next: DateRange =
        !current?.from || current.to
          ? { from: date }
          : isBefore(date, current.from)
            ? { from: date }
            : { from: current.from, to: date }
      props.onSelect?.(next)
    } else {
      props.onSelect?.(date)
    }
    setFocusedDate(date)
  }

  function handlePrevMonth() {
    goToMonth(subMonths(month, 1))
  }

  function handleNextMonth() {
    goToMonth(addMonths(month, 1))
  }

  function handleToggleView() {
    setView((v) => (v === 'days' ? 'year-month' : 'days'))
  }

  function handleSelectMonth(monthIndex: number) {
    goToMonth(setMonthOfDate(month, monthIndex))
    setView('days')
  }

  function handleSelectYear(year: number) {
    goToMonth(setYear(month, year))
  }

  const contextValue: CalendarContextValue = {
    mode,
    weekStartsOn,
    selectedDate,
    selectedRange,
    previewRange,
    tabbableKey: toDayKey(tabbableDate),
    isDayDisabled: isDisabled,
    modifiers,
    renderDay,
    onDaySelect: handleDaySelect,
    onDayFocus: setFocusedDate,
    onDayHoverStart: setHoveredDate,
    onDayHoverEnd: () => setHoveredDate(undefined),
  }

  return (
    <CalendarContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        data-slot='calendar'
        // Reserve a definite width so the calendar renders correctly inside width-fitting
        // containers (e.g. `w-auto` popovers), where the fluid `w-full`/`aspect-square` day
        // cells would otherwise collapse to zero. Each month claims ≥14rem (grid + its own
        // `px-2`) plus inter-month gaps; `min-width` still lets the grid grow to fill wider
        // fixed-width containers.
        style={{
          minWidth: `calc(${numberOfMonths} * 14rem + ${numberOfMonths - 1} * 1rem)`,
        }}
        className={cn('@container relative select-none', className)}>
        {!hideNavigation && captionLayout === 'label' && (
          <div
            data-slot='nav'
            className='pointer-events-none absolute inset-x-2 top-2 z-10 flex items-center justify-between'>
            <button
              type='button'
              data-slot='nav-button'
              data-direction='prev'
              aria-label='Previous month'
              onClick={handlePrevMonth}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'pointer-events-auto h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100'
              )}>
              <ChevronLeft className='size-4' />
            </button>
            <button
              type='button'
              data-slot='nav-button'
              data-direction='next'
              aria-label='Next month'
              onClick={handleNextMonth}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'pointer-events-auto h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100'
              )}>
              <ChevronRight className='size-4' />
            </button>
          </div>
        )}
        <div data-slot='months' className='flex gap-4'>
          {months.map((m, index) => {
            const isFirst = index === 0
            const layout = isFirst ? captionLayout : 'label'
            const showYearMonth = isFirst && captionLayout === 'dropdown' && view === 'year-month'
            return (
              <div key={toDayKey(m)} data-slot='month' className='min-w-0 flex-1'>
                <CalendarCaption
                  month={m}
                  layout={layout}
                  view={isFirst ? view : 'days'}
                  onToggleView={isFirst ? handleToggleView : undefined}
                  onPrev={handlePrevMonth}
                  onNext={handleNextMonth}
                  hideNavigation={hideNavigation}
                />
                {showYearMonth ? (
                  <YearMonthView
                    month={m}
                    onSelectMonth={handleSelectMonth}
                    onSelectYear={handleSelectYear}
                  />
                ) : (
                  <MonthGrid
                    month={m}
                    showOutsideDays={showOutsideDays}
                    fixedWeeks={fixedWeeks}
                    onKeyDown={onGridKeyDown}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </CalendarContext.Provider>
  )
}
