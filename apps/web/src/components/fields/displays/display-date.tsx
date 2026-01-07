// apps/web/src/components/fields/displays/display-date.tsx
'use client'

import { X } from 'lucide-react'
import { usePropertyContext } from '../property-provider'
import DisplayWrapper from './display-wrapper'
import { FieldOptionButton } from './field-option-button'
import { FieldType } from '@auxx/database/enums'
import { converters, type DateFieldOptions } from '@auxx/lib/field-values/client'

/**
 * DisplayDate component
 * Renders a formatted date/time/datetime value using the dateConverter
 * Works for FieldType.DATE, FieldType.DATETIME, and FieldType.TIME
 */
export function DisplayDate() {
  const { value, field, commitValue } = usePropertyContext()
  // Read display options from field.options (flat structure)
  const opts = field.options as DateFieldOptions | undefined

  if (!value) return null

  // Build display options based on field type
  const displayOpts: DateFieldOptions = {
    ...opts,
    // For TIME fields, use 'time-only' format
    format: field.type === FieldType.TIME ? 'time-only' : (opts?.format ?? 'medium'),
    // For DATETIME fields, always include time
    includeTime: field.type === FieldType.DATETIME || opts?.includeTime,
  }
  // console.log('DisplayDate options:', displayOpts, date.toISOString())
  // Use the converter to format the display value
  const typedValue = { type: 'date' as const, value }
  const formatted = converters.DATE.toDisplayValue(typedValue, displayOpts) as string

  /** Clears the date value */
  const handleClear = () => commitValue(null)

  /** Clear button - only shown if field is not readonly */
  const clearButton = !field.readOnly ? (
    <FieldOptionButton key="clear" label="Clear" onClick={handleClear}>
      <X className="size-2.5" />
    </FieldOptionButton>
  ) : null

  return (
    <DisplayWrapper copyValue={formatted} buttons={clearButton ? [clearButton] : undefined}>
      <span>{formatted}</span>
    </DisplayWrapper>
  )
}
