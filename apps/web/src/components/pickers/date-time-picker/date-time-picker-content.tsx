// apps/web/src/components/pickers/date-time-picker/date-time-picker-content.tsx
'use client'

import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { addMonths, subMonths, setMonth, setYear } from 'date-fns'

import { ViewType, Period, type DateTimePickerContentProps } from './types'
import {
  to24Hour,
  getHourIn12HourFormat,
  getPeriod,
  formatTime12Hour,
  createDateWithTime,
  cloneTimeToDate,
  startOfDay,
} from './utils'
import PickerHeader from './components/picker-header'
import PickerFooter from './components/picker-footer'
import CalendarView from './views/calendar-view'
import YearMonthView from './views/year-month-view'
import TimeView from './views/time-view'
import { DEFAULT_DATE_PRESETS } from './presets'

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
  className,
}: DateTimePickerContentProps) {
  // Current view state
  const [view, setView] = useState<ViewType>(() =>
    mode === 'time' ? ViewType.Time : ViewType.Calendar
  )

  // Internal state for pending selection
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(value)
  const [currentMonth, setCurrentMonth] = useState<Date>(value || new Date())

  // Year/month picker state
  const [selectedMonth, setSelectedMonth] = useState<number>((value || new Date()).getMonth())
  const [selectedYear, setSelectedYear] = useState<number>((value || new Date()).getFullYear())

  // Sync internal state when value changes externally
  useEffect(() => {
    setSelectedDate(value)
    if (value) {
      setCurrentMonth(value)
      setSelectedMonth(value.getMonth())
      setSelectedYear(value.getFullYear())
    }
  }, [value])

  // Determine if time picker toggle should be shown
  const showTimeToggle = mode === 'datetime' && !hideTimePicker

  /** Navigate to next month */
  const handleNextMonth = useCallback(() => {
    setCurrentMonth((prev) => addMonths(prev, 1))
  }, [])

  /** Navigate to previous month */
  const handlePrevMonth = useCallback(() => {
    setCurrentMonth((prev) => subMonths(prev, 1))
  }, [])

  /** Open year/month picker */
  const handleOpenYearMonthPicker = useCallback(() => {
    setSelectedMonth(currentMonth.getMonth())
    setSelectedYear(currentMonth.getFullYear())
    setView(ViewType.YearMonth)
  }, [currentMonth])

  /** Close year/month picker */
  const handleCloseYearMonthPicker = useCallback(() => {
    setView(ViewType.Calendar)
  }, [])

  /** Handle month selection in year/month picker */
  const handleMonthSelect = useCallback((month: number) => {
    setSelectedMonth(month)
  }, [])

  /** Handle year selection in year/month picker */
  const handleYearSelect = useCallback((year: number) => {
    setSelectedYear(year)
  }, [])

  /** Cancel year/month selection */
  const handleYearMonthCancel = useCallback(() => {
    setView(ViewType.Calendar)
  }, [])

  /** Confirm year/month selection */
  const handleYearMonthConfirm = useCallback(() => {
    setCurrentMonth((prev) => setYear(setMonth(prev, selectedMonth), selectedYear))
    setView(ViewType.Calendar)
  }, [selectedMonth, selectedYear])

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
      if (noConfirm && mode === 'date') {
        onChange(newDate)
      }
    },
    [selectedDate, noConfirm, mode, onChange]
  )

  /** Handle hour selection */
  const handleSelectHour = useCallback(
    (hourStr: string) => {
      const hour12 = parseInt(hourStr, 10)
      const currentPeriod = selectedDate ? getPeriod(selectedDate) : Period.AM
      const hour24 = to24Hour(hour12, currentPeriod)
      const currentMinutes = selectedDate?.getMinutes() ?? 0
      setSelectedDate(createDateWithTime(selectedDate, hour24, currentMinutes))
    },
    [selectedDate]
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
    [onChange, presets]
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
        <div className="grid grid-cols-2 gap-1 border-b p-2">
          {presets.map((preset) => (
            <Button
              key={preset.value}
              variant="ghost"
              size="sm"
              className="h-7 justify-start text-xs"
              onClick={() => handlePresetSelect(preset)}>
              {preset.label}
            </Button>
          ))}
        </div>
      )}

      {/* Header */}
      <PickerHeader
        view={view}
        mode={mode}
        currentMonth={currentMonth}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onOpenYearMonthPicker={handleOpenYearMonthPicker}
        onCloseYearMonthPicker={handleCloseYearMonthPicker}
        onNextMonth={handleNextMonth}
        onPrevMonth={handlePrevMonth}
      />

      {/* Content based on view */}
      {view === ViewType.Calendar && (
        <CalendarView
          currentMonth={currentMonth}
          selectedDate={selectedDate}
          onDateSelect={handleDateSelect}
          minDate={minDate}
          maxDate={maxDate}
          disabledDates={disabledDates}
        />
      )}

      {view === ViewType.YearMonth && (
        <YearMonthView
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          onMonthSelect={handleMonthSelect}
          onYearSelect={handleYearSelect}
        />
      )}

      {view === ViewType.Time && (
        <TimeView
          selectedTime={selectedDate}
          minuteFilter={minuteFilter}
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
          onYearMonthCancel={handleYearMonthCancel}
          onYearMonthConfirm={handleYearMonthConfirm}
          hideNowButton={hideNowButton}
        />
      )}
    </div>
  )
}
