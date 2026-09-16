// packages/ui/src/components/date-range-picker.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import type {
  CalendarBaseProps,
  DateRange as CalendarDateRange,
} from '@auxx/ui/components/calendar'
import { Calendar } from '@auxx/ui/components/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import {
  endOfDay,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
  subWeeks,
} from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { useState } from 'react'

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
 * One entry in the preset sidebar. `range()` is called when it is clicked and
 * again to decide whether it is the ACTIVE preset, so it must be pure.
 */
interface DateRangePreset {
  label: string
  range: () => DateRange
}

/**
 * DateRangePicker component props
 */
interface DateRangePickerProps {
  /** Selected range. When undefined the trigger shows `placeholder` and no calendar selection. */
  value?: DateRange
  onChange: (value: DateRange) => void
  triggerClassName?: string
  triggerVariant?: 'default' | 'outline' | 'ghost'
  showShortLabel?: boolean
  /** Hide the left-hand preset sidebar (Today / Last 7 days / …). Defaults to shown. */
  showPresets?: boolean
  /**
   * Replace the default preset list.
   *
   * The default list is calendar-generic ("Today", "Last 7 days") and its
   * "All time" is a hardcoded 2020-01-01, so a caller whose domain has its own
   * floor and its own vocabulary — an accounting period, a fiscal year — passes
   * its own rather than living with presets that answer the wrong question.
   */
  presets?: readonly DateRangePreset[]
  /** Trigger label shown when `value` is undefined. */
  placeholder?: string
  /**
   * Custom trigger renderer. Receives the popover open state, the computed label, and whether a
   * range is set. Return element is wrapped in `PopoverTrigger asChild`. When omitted, a default
   * outline `Button` is rendered. Lets app-layer callers pass their own trigger (e.g. `PickerTrigger`)
   * without `packages/ui` depending on `apps/web`.
   */
  trigger?: (state: { open: boolean; label: string; hasValue: boolean }) => React.ReactNode
}

/**
 * Extra Calendar passthrough props. `mode`/`selected`/`onSelect` are owned by this component;
 * everything else on `CalendarBaseProps` (month, disabled, minDate, className, etc.) is
 * forwarded as-is.
 */
type DateRangePickerCalendarProps = Partial<CalendarBaseProps>

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

/** Two ranges naming the same pair of calendar days. */
const sameRange = (a: DateRange, b: DateRange): boolean =>
  isSameDay(a.from, b.from) && isSameDay(a.to, b.to)

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
const calculateDisplayLabel = (
  dateRange: DateRange,
  showShortLabel: boolean,
  detectBuiltInTimeFrames: boolean
): string => {
  // Prefer a built-in timeframe name, but only when the built-in list is the
  // one on screen: naming a range "Last 12 months" next to a sidebar that does
  // not offer it describes a preset the caller never had.
  const detectedTimeFrame = detectBuiltInTimeFrames ? detectTimeFrameFromDateRange(dateRange) : null
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
  showPresets = true,
  placeholder = 'Select dates',
  presets,
  trigger,
  ...calendarProps
}: DateRangePickerProps & DateRangePickerCalendarProps) {
  const [open, setOpen] = useState(false)
  const presetList: readonly DateRangePreset[] =
    presets ??
    timeFrameOptions.map((option) => ({
      label: option.label,
      range: () => getDateRangeForTimeFrame(option.value),
    }))

  /**
   * The half-picked range, held between the two clicks a range takes.
   *
   * STOP: `Calendar` in range mode is fully controlled. The first click hands
   * back `{ from }` with no `to`, and it works out what the SECOND click means
   * by reading `selected` back. Only ever pushing COMPLETE ranges into `value`
   * (and dropping the partial one on the floor) therefore meant `selected` was
   * never half-picked, so every click read as "start a new range", was dropped
   * for having no `to`, and the calendar could not change the range at all -
   * the presets were the only thing on this control that worked.
   */
  const [draft, setDraft] = useState<CalendarDateRange | null>(null)

  const handlePresetSelect = (preset: DateRangePreset) => {
    setDraft(null)
    onChange(preset.range())
    setOpen(false)
  }

  /**
   * Handle calendar date range selection. The first click only parks the anchor;
   * the second completes the range, and is the only one that commits.
   */
  const handleCalendarSelect = (range: CalendarDateRange) => {
    if (!range.to) {
      setDraft(range)
      return
    }
    setDraft(null)
    // Whole days, the same ends the presets use, so a range picked on the
    // calendar and "Last 7 days" mean the same thing to a caller that filters
    // on timestamps rather than on calendar days.
    onChange({ from: startOfDay(range.from), to: endOfDay(range.to) })
  }

  const activePresetLabel = value
    ? (presetList.find((preset) => sameRange(preset.range(), value))?.label ?? null)
    : null
  const displayLabel = value
    ? (activePresetLabel ?? calculateDisplayLabel(value, showShortLabel, !presets))
    : placeholder

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // An abandoned first click never becomes a range.
        if (!next) setDraft(null)
      }}>
      <PopoverTrigger asChild>
        {trigger ? (
          trigger({ open, label: displayLabel, hasValue: !!value })
        ) : (
          <Button
            variant={triggerVariant}
            size='sm'
            className={cn('justify-start text-left font-normal', triggerClassName)}>
            <CalendarIcon />
            {displayLabel}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0' align='start'>
        <div className='flex items-start flex-row'>
          {showPresets && (
            <div className='border-r border-border min-w-[140px] h-full'>
              <div className='p-2 space-y-1 flex flex-col overflow-y-auto'>
                {presetList.map((preset) => {
                  const isSelected = activePresetLabel === preset.label
                  return (
                    <Button
                      key={preset.label}
                      variant={isSelected ? 'secondary' : 'ghost'}
                      size='sm'
                      className={cn(
                        'justify-start',
                        isSelected && 'bg-secondary text-secondary-foreground'
                      )}
                      onClick={() => handlePresetSelect(preset)}>
                      {preset.label}
                    </Button>
                  )
                })}
              </div>
            </div>
          )}
          <Calendar
            mode='range'
            className='relative'
            selected={draft ?? value}
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
export type { DateRange, DateRangePreset, TimeFrameOption }
