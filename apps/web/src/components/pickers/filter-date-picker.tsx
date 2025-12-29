// src/components/pickers/filter-date-picker.tsx
'use client'

import * as React from 'react'
import { Calendar as CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'

import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { Calendar } from '@auxx/ui/components/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Separator } from '@auxx/ui/components/separator'

/**
 * Defines the structure for a relative date option.
 */
interface RelativeOption {
  value: string // The key used by parseDateValue (e.g., "today")
  label: string // The user-friendly display label (e.g., "Today")
}

/**
 * Predefined relative date ranges based on mail-view-query-builder.
 */
const relativeOptions: RelativeOption[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 days' },
  { value: 'last30days', label: 'Last 30 days' },
  { value: 'thismonth', label: 'This month' },
  { value: 'lastmonth', label: 'Last month' },
]

/**
 * Props for the FilterDatePicker component.
 */
interface FilterDatePickerProps {
  /** The current selected value (ISO string or relative range key) or null/undefined. */
  value?: string | null
  /** Callback function triggered when the value changes. Receives the new value string or null. */
  onChange: (value: string | null) => void
  /** Optional additional CSS class names for the PopoverContent. */
  className?: string
  /** Optional additional CSS class names for the trigger Button. */
  triggerClassName?: string
  /** Whether the picker is disabled. */
  disabled?: boolean
  /** Placeholder text when no value is selected. */
  placeholder?: string
  /** Custom trigger element - if provided, will be used instead of default button */
  children?: React.ReactNode
}

/**
 * A date picker component tailored for mail view filters.
 * Allows selection of specific dates or predefined relative ranges.
 * Outputs either an ISO date string or a relative range key string.
 */
export function FilterDatePicker({
  value,
  onChange,
  className,
  triggerClassName,
  disabled = false,
  placeholder = 'Select date...',
  children,
}: FilterDatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  /**
   * Determines the display text for the trigger button based on the current value.
   * @returns The string to display.
   */
  const getDisplayText = (): string => {
    if (!value) return placeholder
    // Check if the value matches a predefined relative option
    const relativeMatch = relativeOptions.find((opt) => opt.value === value)
    if (relativeMatch) return relativeMatch.label

    // Otherwise, try to parse it as a date and format it
    try {
      const date = new Date(value)
      // Check if parsing resulted in a valid date
      if (!isNaN(date.getTime())) {
        return format(date, 'PPP') // e.g., "Dec 31st, 2023"
      }
    } catch (e) {
      // Ignore errors if value is not a parsable date string
    }
    // Fallback: if value is not null, not relative, and not parsable, show the raw value
    return value
  }

  /**
   * Handles the selection of a predefined relative date range.
   * @param relativeValue The selected relative range key (e.g., "today").
   */
  const handleRelativeSelect = (relativeValue: string) => {
    onChange(relativeValue)
    setIsOpen(false) // Close the popover after selection
  }

  /**
   * Handles the selection of a specific date from the calendar.
   * @param selectedDate The selected Date object, or undefined if cleared/no selection.
   */
  const handleDateSelect = (selectedDate?: Date) => {
    if (selectedDate) {
      // Output date as ISO string, consistent with how parseDateValue expects specific dates
      onChange(selectedDate.toISOString())
    } else {
      // If the calendar allows clearing, handle setting value to null
      // onChange(null); // Uncomment this if clearing is desired/possible
    }
    setIsOpen(false) // Close the popover after selection
  }

  /**
   * Determines the date currently selected in the calendar, if the value is a valid date string.
   * Returns undefined if the value is a relative range key or invalid/null.
   */
  const selectedCalendarDate = React.useMemo(() => {
    if (!value) return undefined
    // Check if it's a relative option value
    if (relativeOptions.some((opt) => opt.value === value)) {
      return undefined // Don't highlight a date in calendar for relative ranges
    }
    // Try to parse as a date
    try {
      const date = new Date(value)
      return !isNaN(date.getTime()) ? date : undefined
    } catch {
      return undefined // Invalid date string
    }
  }, [value])

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {children || (
          <Button
            type="button"
            variant="input"
            className={cn(
              'w-full justify-start text-left font-normal',
              !value && 'text-muted-foreground', // Style placeholder differently
              triggerClassName
            )}
            disabled={disabled}>
            <CalendarIcon />
            {getDisplayText()}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('w-auto p-0', className)} align="start">
        {/* Section for Relative Ranges */}
        <div className="grid grid-cols-2 gap-1 p-2">
          {relativeOptions.map((option) => (
            <Button
              type="button"
              key={option.value}
              variant={value === option.value ? 'default' : 'ghost'} // Highlight selected relative range
              size="sm"
              className="h-8 justify-start text-xs"
              onClick={() => handleRelativeSelect(option.value)}>
              {option.label}
            </Button>
          ))}
        </div>

        <Separator />

        {/* Calendar for Specific Date Selection */}
        <Calendar
          mode="single"
          selected={selectedCalendarDate}
          onSelect={handleDateSelect} // Calendar's onSelect provides Date | undefined
          disabled={disabled}
          initialFocus // Focus the calendar when popover opens
          // You might want to add month/year navigation controls if needed
          // showOutsideDays={false} // Optionally hide days from other months
        />
      </PopoverContent>
    </Popover>
  )
}
