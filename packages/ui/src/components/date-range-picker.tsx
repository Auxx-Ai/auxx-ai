// packages/ui/src/components/date-range-picker.tsx
'use client'

import { useState } from 'react'
import {
  format,
  subWeeks,
  subMonths,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  isSameDay,
  startOfDay,
  endOfDay,
} from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Button } from '@auxx/ui/components/button'
import { Calendar } from '@auxx/ui/components/calendar'
import { cn } from '@auxx/ui/lib/utils'

/**
 * DateRange type definition
 */
type DateRange = { from: Date; to: Date }

/**
 * Available predefined time frame options
 */
type TimeFrameOption =
  | 'today'
  | 'last7days'
  | 'last4weeks'
  | 'last3months'
  | 'last12months'
  | 'monthToDate'
  | 'quarterToDate'
  | 'yearToDate'
  | 'allTime'

/**
 * DateRangePicker component props
 */
interface DateRangePickerProps {
  value: DateRange
  onChange: (value: DateRange) => void
  triggerClassName?: string
  triggerVariant?: 'default' | 'outline' | 'ghost'
  showShortLabel?: boolean
  // Rest of Calendar props
  [key: string]: any
}

/**
 * Predefined time frame options configuration
 */
const timeFrameOptions = [
  { value: 'today' as TimeFrameOption, label: 'Today' },
  { value: 'last7days' as TimeFrameOption, label: 'Last 7 days' },
  { value: 'last4weeks' as TimeFrameOption, label: 'Last 4 weeks' },
  { value: 'last3months' as TimeFrameOption, label: 'Last 3 months' },
  { value: 'last12months' as TimeFrameOption, label: 'Last 12 months' },
  { value: 'monthToDate' as TimeFrameOption, label: 'Month to date' },
  { value: 'quarterToDate' as TimeFrameOption, label: 'Quarter to date' },
  { value: 'yearToDate' as TimeFrameOption, label: 'Year to date' },
  { value: 'allTime' as TimeFrameOption, label: 'All time' },
] as const

/**
 * Calculate date range for a given time frame option
 */
const getDateRangeForTimeFrame = (timeFrame: TimeFrameOption): DateRange => {
  const now = new Date()

  switch (timeFrame) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) }
    case 'last7days':
      return { from: startOfDay(subWeeks(now, 1)), to: endOfDay(now) }
    case 'last4weeks':
      return { from: startOfDay(subWeeks(now, 4)), to: endOfDay(now) }
    case 'last3months':
      return { from: startOfDay(subMonths(now, 3)), to: endOfDay(now) }
    case 'last12months':
      return { from: startOfDay(subMonths(now, 12)), to: endOfDay(now) }
    case 'monthToDate':
      return { from: startOfDay(startOfMonth(now)), to: endOfDay(now) }
    case 'quarterToDate':
      return { from: startOfDay(startOfQuarter(now)), to: endOfDay(now) }
    case 'yearToDate':
      return { from: startOfDay(startOfYear(now)), to: endOfDay(now) }
    case 'allTime':
      return { from: startOfDay(new Date('2020-01-01')), to: endOfDay(now) }
  }
}

/**
 * Detect if current DateRange matches a predefined timeframe
 */
const detectTimeFrameFromDateRange = (dateRange: DateRange): TimeFrameOption | null => {
  const timeFrames: TimeFrameOption[] = [
    'today',
    'last7days',
    'last4weeks',
    'last3months',
    'last12months',
    'monthToDate',
    'quarterToDate',
    'yearToDate',
    'allTime',
  ]

  for (const timeFrame of timeFrames) {
    const expectedRange = getDateRangeForTimeFrame(timeFrame)
    if (
      isSameDay(expectedRange.from, dateRange.from) &&
      isSameDay(expectedRange.to, dateRange.to)
    ) {
      return timeFrame
    }
  }
  return null
}

/**
 * Get display name for a time frame option
 */
const getTimeFrameDisplayName = (timeFrame: TimeFrameOption): string => {
  const option = timeFrameOptions.find((opt) => opt.value === timeFrame)
  return option?.label || ''
}

/**
 * Calculate display label based on date range and showShortLabel preference
 */
const calculateDisplayLabel = (dateRange: DateRange, showShortLabel: boolean): string => {
  // Always prefer detected timeframe if found
  const detectedTimeFrame = detectTimeFrameFromDateRange(dateRange)
  if (detectedTimeFrame) {
    return getTimeFrameDisplayName(detectedTimeFrame)
  }

  // Use short format if requested
  if (showShortLabel) {
    // Same month and year - use compact format like "Jan 15-20, 2024"
    if (
      dateRange.from.getMonth() === dateRange.to.getMonth() &&
      dateRange.from.getFullYear() === dateRange.to.getFullYear()
    ) {
      const fromDay = format(dateRange.from, 'd')
      const toDay = format(dateRange.to, 'd')
      const month = format(dateRange.from, 'MMM')
      const year = dateRange.to.getFullYear()
      return `${month} ${fromDay}-${toDay}, ${year}`
    }

    // Different months or years - use abbreviated format
    const fromFormatted = format(dateRange.from, 'MMM d, yyyy')
    const toFormatted = format(dateRange.to, 'MMM d, yyyy')
    return `${fromFormatted} - ${toFormatted}`
  }

  // Fall back to full date range format
  return `${format(dateRange.from, 'PPP')} - ${format(dateRange.to, 'PPP')}`
}

/**
 * DateRangePicker Component
 * A reusable date range picker with predefined options and custom calendar selection
 */
export function DateRangePicker({
  value,
  onChange,
  triggerClassName,
  triggerVariant = 'outline',
  showShortLabel = false,
  ...calendarProps
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false)

  /**
   * Handle selection of predefined time frame option
   */
  const handleTimeFrameSelect = (timeFrame: TimeFrameOption) => {
    const newRange = getDateRangeForTimeFrame(timeFrame)
    onChange(newRange)
    setOpen(false)
  }

  /**
   * Handle calendar date range selection
   */
  const handleCalendarSelect = (range: any) => {
    if (range && range.from && range.to) {
      onChange(range as DateRange)
      // setOpen(false)
    }
  }

  const displayLabel = calculateDisplayLabel(value, showShortLabel)
  const activeTimeFrame = detectTimeFrameFromDateRange(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={triggerVariant}
          size="sm"
          className={cn('justify-start text-left font-normal', triggerClassName)}>
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex items-start flex-row">
          <div className="border-r border-border min-w-[140px] h-full">
            <div className="p-2 space-y-1 flex flex-col overflow-y-auto">
              {timeFrameOptions.map((option) => {
                const isSelected = activeTimeFrame === option.value
                return (
                  <Button
                    key={option.value}
                    variant={isSelected ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn(
                      'justify-start',
                      isSelected && 'bg-secondary text-secondary-foreground'
                    )}
                    onClick={() => handleTimeFrameSelect(option.value)}>
                    {option.label}
                  </Button>
                )
              })}
            </div>
          </div>
          <Calendar
            mode="range"
            className="relative"
            selected={value}
            showOutsideDays={false}
            onSelect={handleCalendarSelect}
            numberOfMonths={2}
            {...calendarProps}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Export types for external use
export type { DateRange, TimeFrameOption }
