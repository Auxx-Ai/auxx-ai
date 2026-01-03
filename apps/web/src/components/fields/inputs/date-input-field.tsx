// apps/web/src/components/fields/inputs/date-input-field.tsx
'use client'

import { usePropertyContext } from '../property-provider'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { useState, useCallback, useEffect } from 'react'
import { DateTimePickerContent, type PickerMode } from '~/components/pickers/date-time-picker'
import { FieldType } from '@auxx/database/enums'

/**
 * Maps FieldType to DateTimePicker mode
 */
const fieldTypeToPickerMode: Record<string, PickerMode> = {
  [FieldType.DATE]: 'date',
  [FieldType.DATETIME]: 'datetime',
  [FieldType.TIME]: 'time',
}

/**
 * Parse date value from various formats to Date object
 */
const parseDateValue = (value: unknown): Date | undefined => {
  if (!value) return undefined
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return isNaN(parsed.getTime()) ? undefined : parsed
  }
  return undefined
}

/**
 * DateInputField
 * Editor for DATE, DATETIME, and TIME field types using DateTimePickerContent
 *
 * Pattern C: Selection picker
 * - commitValue fires immediately on selection (fire-and-forget)
 * - close() called after selection
 * - CAPTURES arrow keys for calendar navigation
 */
export function DateInputField() {
  const { value, commitValue, close, field } = usePropertyContext()
  const nav = useFieldNavigationOptional()

  // Capture keys while open (calendar uses arrows for date navigation)
  useEffect(() => {
    nav?.setPopoverCapturing(true)
    return () => nav?.setPopoverCapturing(false)
  }, [nav])

  // Determine picker mode from field type
  const mode: PickerMode = fieldTypeToPickerMode[field.type] || 'date'

  // Parse the incoming value
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => parseDateValue(value))

  /**
   * Handle date selection from DateTimePickerContent
   * Fire-and-forget save, then close
   */
  const handleChange = useCallback(
    (date: Date | undefined) => {
      setSelectedDate(date)
      const isoValue = date ? date.toISOString() : null
      commitValue(isoValue)
      close()
    },
    [commitValue, close]
  )

  return (
    <DateTimePickerContent
      value={selectedDate}
      onChange={handleChange}
      onClear={() => handleChange(undefined)}
      mode={mode}
      noConfirm={mode === 'date'}
      hideNowButton={false}
    />
  )
}
