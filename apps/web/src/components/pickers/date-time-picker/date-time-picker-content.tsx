// apps/web/src/components/pickers/date-time-picker/date-time-picker-content.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import PickerFooter from './components/picker-footer'
import { DEFAULT_DATE_PRESETS } from './presets'
import { type DateTimePickerContentProps, Period, ViewType } from './types'
import {
  cloneTimeToDate,
  createDateWithTime,
  formatTime12Hour,
  getHourIn12HourFormat,
  getPeriod,
  startOfDay,
  to24Hour,
} from './utils'
import CalendarView from './views/calendar-view'
import TimeView from './views/time-view'

/**
 * Min-height for the calendar view's wrapper. The Calendar component's own `h-10` dropdown
 * caption plus a 6-week month's day grid (the tallest case — months render 4-6 weeks) needs
 * ~291px; holding the shell at that height stops the popover/footer from jumping as the user
 * pages between shorter and longer months.
 */
const CALENDAR_VIEW_MIN_HEIGHT = 'min-h-[291px]'

/**
 * DateTimePickerContent
 *
 * Standalone picker content without popover wrapper.
 * Use this when embedding the picker inside another popover/dialog.
 *
 * For a complete popover-wrapped picker, use DateTimePicker instead.
 */
export function DateTimePickerContent({
  value,
  onChange,
  onClear,
  mode = 'datetime',
  hideTimePicker = false,
  hideNowButton = false,
  noConfirm = false,
  showPresets = false,
  presets = DEFAULT_DATE_PRESETS,
  minDate,
  maxDate,
  disabledDates,
  minuteFilter,
  use24HourTime = false,
  className,
}: DateTimePickerContentProps) {
  // Current view state
  const [view, setView] = useState<ViewType>(() =>
    mode === 'time' ? ViewType.Time : ViewType.Calendar
  )

  // Internal state for pending selection
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(value)
  // Displayed (anchor) month for the calendar view — controlled on the Calendar component.
  // Updated on date selection, external `value` changes, and via the Calendar's own
  // onMonthChange (prev/next nav + picks in its built-in year-month view).
  const [currentMonth, setCurrentMonth] = useState<Date>(value || new Date())

  // Sync internal state when value changes externally
  useEffect(() => {
    setSelectedDate(value)
    if (value) setCurrentMonth(value)
  }, [value])

  // Determine if time picker toggle should be shown
  const showTimeToggle = mode === 'datetime' && !hideTimePicker

  /** Toggle between calendar and time view */
  const handleToggleTimePicker = useCallback(() => {
    setView((prev) => (prev === ViewType.Calendar ? ViewType.Time : ViewType.Calendar))
  }, [])

  /** Handle date selection from calendar */
  const handleDateSelect = useCallback(
    (date: Date) => {
      // Preserve time from existing selection or use start of day
      const newDate = selectedDate ? cloneTimeToDate(date, selectedDate) : startOfDay(date)
      setSelectedDate(newDate)
      setCurrentMonth(date)

      // Auto-confirm if noConfirm is true and mode is date
      if (noConfirm) {
        onChange(newDate)
      }
    },
    [selectedDate, noConfirm, onChange]
  )

  /** Handle hour selection */
  const handleSelectHour = useCallback(
    (hourStr: string) => {
      const selectedHour = parseInt(hourStr, 10)
      const currentPeriod = selectedDate ? getPeriod(selectedDate) : Period.AM
      const hour24 = use24HourTime ? selectedHour : to24Hour(selectedHour, currentPeriod)
      const currentMinutes = selectedDate?.getMinutes() ?? 0
      setSelectedDate(createDateWithTime(selectedDate, hour24, currentMinutes))
    },
    [selectedDate, use24HourTime]
  )

  /** Handle minute selection */
  const handleSelectMinute = useCallback(
    (minuteStr: string) => {
      const minute = parseInt(minuteStr, 10)
      const currentHours = selectedDate?.getHours() ?? 0
      setSelectedDate(createDateWithTime(selectedDate, currentHours, minute))
    },
    [selectedDate]
  )

  /** Handle period selection */
  const handleSelectPeriod = useCallback(
    (period: Period) => {
      if (!selectedDate) {
        const hour24 = period === Period.PM ? 12 : 0
        setSelectedDate(createDateWithTime(undefined, hour24, 0))
        return
      }
      const currentHour12 = getHourIn12HourFormat(selectedDate)
      const hour24 = to24Hour(currentHour12, period)
      const currentMinutes = selectedDate.getMinutes()
      setSelectedDate(createDateWithTime(selectedDate, hour24, currentMinutes))
    },
    [selectedDate]
  )

  /** Handle "Now" / "Today" button */
  const handleSelectNow = useCallback(() => {
    const now = new Date()
    onChange(mode === 'date' ? startOfDay(now) : now)
  }, [mode, onChange])

  /** Handle confirm button */
  const handleConfirm = useCallback(() => {
    onChange(selectedDate)
  }, [selectedDate, onChange])

  /** Handle preset selection */
  const handlePresetSelect = useCallback(
    (preset: (typeof presets)[number]) => {
      const date = preset.getDate()
      onChange(date)
    },
    [onChange]
  )

  /** Formatted time for footer display */
  const displayTime = useMemo(() => {
    if (!selectedDate) return '--:-- --'
    return formatTime12Hour(selectedDate)
  }, [selectedDate])

  return (
    <div className={cn('w-[240px] min-w-[240px]', className)}>
      {/* Presets (optional) */}
      {showPresets && mode !== 'time' && view === ViewType.Calendar && (
        <div className='grid grid-cols-2 gap-1 border-b p-2'>
          {presets.map((preset) => (
            <Button
              key={preset.value}
              variant='ghost'
              size='sm'
              className='h-7 justify-start text-xs'
              onClick={() => handlePresetSelect(preset)}>
              {preset.label}
            </Button>
          ))}
        </div>
      )}

      {/* Header (time view only — the calendar view renders its own dropdown caption) */}
      {view === ViewType.Time && (
        <div className='border-b px-1 p-2 h-10 flex items-center'>
          <div className='flex items-center gap-x-0.5 rounded-xl px-2 py-1.5 text-sm font-semibold text-primary-900 hover:bg-primary-100 cursor-default'>
            <span>Select Time</span>
          </div>
        </div>
      )}

      {/* Content based on view */}
      {view === ViewType.Calendar && (
        <div className={CALENDAR_VIEW_MIN_HEIGHT}>
          <CalendarView
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            selectedDate={selectedDate}
            onDateSelect={handleDateSelect}
            minDate={minDate}
            maxDate={maxDate}
            disabledDates={disabledDates}
          />
        </div>
      )}

      {view === ViewType.Time && (
        <TimeView
          selectedTime={selectedDate}
          minuteFilter={minuteFilter}
          use24HourTime={use24HourTime}
          onSelectHour={handleSelectHour}
          onSelectMinute={handleSelectMinute}
          onSelectPeriod={handleSelectPeriod}
        />
      )}

      {/* Footer (not shown for noConfirm date-only mode in calendar view) */}
      {!(noConfirm && mode === 'date' && view === ViewType.Calendar) && (
        <PickerFooter
          view={view}
          mode={mode}
          showTimeToggle={showTimeToggle}
          displayTime={displayTime}
          onToggleTimePicker={handleToggleTimePicker}
          onSelectNow={handleSelectNow}
          onConfirm={handleConfirm}
          hideNowButton={hideNowButton}
        />
      )}
    </div>
  )
}
