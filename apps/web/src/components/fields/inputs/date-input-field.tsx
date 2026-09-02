// apps/web/src/components/fields/inputs/date-input-field.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { fromCalendarDayIso, toCalendarDayIso } from '@auxx/lib/field-values/client'
import { useCallback, useEffect, useState } from 'react'
import { DateTimePickerContent, type PickerMode } from '~/components/pickers/date-time-picker'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { usePropertyContext } from '../property-provider'

/**
 * Maps FieldType to DateTimePicker mode
 */
const fieldTypeToPickerMode: Record<string, PickerMode> = {
  [FieldType.DATE]: 'date',
  [FieldType.DATETIME]: 'datetime',
  [FieldType.TIME]: 'time',
}

/**
 * Parse date value from various formats to Date object.
 *
 * A DATE field is a calendar day stored as UTC midnight, so it is read back as the
 * local day with the same Y/M/D rather than as the instant, which would highlight
 * the previous day for every viewer west of UTC. DATETIME and TIME are instants.
 */
const parseDateValue = (value: unknown, fieldType: string): Date | undefined => {
  if (fieldType === FieldType.DATE) return fromCalendarDayIso(value)
  if (!value) return undefined
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
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
  const mode: PickerMode = fieldTypeToPickerMode[field.fieldType] || 'date'

  // Parse the incoming value
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() =>
    parseDateValue(value, field.fieldType)
  )

  /**
   * Handle date selection from DateTimePickerContent
   * Fire-and-forget save, then close
   *
   * A DATE field commits the picked local day as `YYYY-MM-DDT00:00:00.000Z`, so the
   * viewer's zone never crosses the wire. DATETIME and TIME commit the instant.
   */
  const handleChange = useCallback(
    (date: Date | undefined) => {
      setSelectedDate(date)
      const isDay = field.fieldType === FieldType.DATE
      const isoValue = date ? (isDay ? toCalendarDayIso(date) : date.toISOString()) : null
      commitValue(isoValue)
      close()
    },
    [commitValue, close, field.fieldType]
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
