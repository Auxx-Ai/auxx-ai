// apps/web/src/components/pickers/date-time-picker/index.tsx
'use client'

import React, { useState, useMemo, useCallback } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Calendar as CalendarIcon, Clock } from 'lucide-react'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'

import { type DateTimePickerProps } from './types'
import { formatTime12Hour, formatDateDisplay, formatDateTimeDisplay } from './utils'
import { DateTimePickerContent } from './date-time-picker-content'

/**
 * DateTimePicker
 *
 * Full popover-wrapped date/time picker.
 * For embedding inside another popover, use DateTimePickerContent instead.
 */
export function DateTimePicker({
  value,
  onChange,
  onClear,
  mode = 'datetime',
  placeholder,
  dateFormat = 'PPP',
  timeFormat = 'hh:mm a',
  hideTimePicker = false,
  hideNowButton = false,
  noConfirm = false,
  notClearable = false,
  showPresets = false,
  presets,
  minDate,
  maxDate,
  disabledDates,
  minuteFilter,
  disabled = false,
  className,
  align = 'start',
  side,
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  triggerProps,
}: DateTimePickerProps) {
  // Controlled vs uncontrolled open state
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen

  /** Handle value change from content - close popover after */
  const handleChange = useCallback(
    (newValue: Date | undefined) => {
      onChange(newValue)
      setOpen(false)
    },
    [onChange, setOpen]
  )

  /** Handle clear */
  const handleClear = useCallback(() => {
    onChange(undefined)
    onClear?.()
    setOpen(false)
  }, [onChange, onClear, setOpen])

  /** Formatted display value */
  const displayValue = useMemo(() => {
    if (!value) return ''
    switch (mode) {
      case 'date':
        return formatDateDisplay(value, dateFormat)
      case 'time':
        return formatTime12Hour(value)
      case 'datetime':
        return formatDateTimeDisplay(value, dateFormat, timeFormat)
    }
  }, [value, mode, dateFormat, timeFormat])

  /** Default placeholder based on mode */
  const defaultPlaceholder = useMemo(() => {
    switch (mode) {
      case 'date':
        return 'Select date'
      case 'time':
        return 'Select time'
      case 'datetime':
        return 'Select date and time'
    }
  }, [mode])

  /** Icon based on mode */
  const TriggerIcon = mode === 'time' ? Clock : CalendarIcon
  const triggerIcon = triggerProps?.icon ?? <TriggerIcon className="size-4 text-primary-400" />

  // Default trigger using PickerTrigger
  const defaultTrigger = (
    <PickerTrigger
      open={open}
      disabled={disabled}
      variant={triggerProps?.variant ?? 'transparent'}
      hasValue={!!displayValue}
      placeholder={placeholder || defaultPlaceholder}
      icon={triggerIcon}
      iconPosition={triggerProps?.iconPosition ?? 'start'}
      className={cn('w-[240px] justify-start', triggerProps?.className)}>
      <span className="truncate">{displayValue}</span>
    </PickerTrigger>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children || defaultTrigger}
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-0 w-[240px] bg-background/50 backdrop-blur-sm!', className)}
        align={align}
        side={side}>
        <DateTimePickerContent
          value={value}
          onChange={handleChange}
          onClear={handleClear}
          mode={mode}
          hideTimePicker={hideTimePicker}
          hideNowButton={hideNowButton}
          noConfirm={noConfirm}
          showPresets={showPresets}
          presets={presets}
          minDate={minDate}
          maxDate={maxDate}
          disabledDates={disabledDates}
          minuteFilter={minuteFilter}
        />
      </PopoverContent>
    </Popover>
  )
}

// Re-export content component for standalone use
export { DateTimePickerContent } from './date-time-picker-content'

// Re-export types and utilities
export { Period, ViewType } from './types'
export type {
  DateTimePickerProps,
  DateTimePickerContentProps,
  PickerMode,
  RelativeDatePreset,
} from './types'
export { DEFAULT_DATE_PRESETS } from './presets'
export { formatTime12Hour, formatDateDisplay, formatDateTimeDisplay } from './utils'
