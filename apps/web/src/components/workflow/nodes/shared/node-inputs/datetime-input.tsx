// apps/web/src/components/workflow/nodes/shared/node-inputs/datetime-input.tsx
'use client'

import { format } from 'date-fns'
import React from 'react'
import { DateTimePicker, type PickerMode } from '~/components/pickers/date-time-picker'
import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface DateTimeInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Type of input: date, time, or datetime */
  type?: 'date' | 'time' | 'datetime'
  /** Minimum date */
  minDate?: Date
  /** Maximum date */
  maxDate?: Date
  /** Date format string (unused, for backward compatibility) */
  dateFormat?: string
  /** Trigger customization options */
  triggerProps?: PickerTriggerOptions
  /** Controlled open state */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
}

/**
 * DateTime input component using DateTimePicker
 * Wraps DateTimePicker to match node-input interface (ISO string values)
 */
export const DateTimeInput = createNodeInput<DateTimeInputProps>(
  ({
    inputs,
    errors,
    onChange,
    onError,
    isLoading,
    name,
    type = 'datetime',
    minDate,
    maxDate,
    triggerProps,
    open,
    onOpenChange,
  }) => {
    const value = inputs[name]
    const error = errors[name]

    // Parse ISO string to Date object
    const dateValue = value ? new Date(value) : undefined
    const isValidDate = dateValue && !isNaN(dateValue.getTime())

    // Map type prop to mode prop
    const mode: PickerMode = type

    /** Handle DateTimePicker onChange (receives Date, stores ISO string) */
    const handleChange = (date: Date | undefined) => {
      if (!date) {
        onError(name, null)
        onChange(name, undefined)
        return
      }

      // Validate date range
      if (minDate && date < minDate) {
        onError(name, `Date must be after ${format(minDate, 'PPP')}`)
        return
      }
      if (maxDate && date > maxDate) {
        onError(name, `Date must be before ${format(maxDate, 'PPP')}`)
        return
      }

      onError(name, null)
      // Store as ISO string (maintains existing behavior)
      onChange(name, date.toISOString())
    }

    /** Get placeholder based on mode */
    const getPlaceholder = () => {
      switch (type) {
        case 'date':
          return 'Pick a date'
        case 'time':
          return 'Pick a time'
        default:
          return 'Pick date & time'
      }
    }

    return (
      <DateTimePicker
        value={isValidDate ? dateValue : undefined}
        onChange={handleChange}
        mode={mode}
        placeholder={getPlaceholder()}
        minDate={minDate}
        maxDate={maxDate}
        disabled={isLoading}
        hideNowButton={false}
        notClearable={false}
        className='w-full'
        triggerProps={triggerProps}
        open={open}
        onOpenChange={onOpenChange}
      />
    )
  }
)
