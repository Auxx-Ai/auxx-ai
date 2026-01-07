// apps/web/src/components/fields/displays/display-date.tsx
import { parseISO, parse } from 'date-fns'
import { usePropertyContext } from '../property-provider'
import DisplayWrapper from './display-wrapper'
import { FieldType } from '@auxx/database/enums'
import { converters, type DateDisplayOptions } from '@auxx/lib/field-values/client'

/**
 * DisplayDate component
 * Renders a formatted date/time/datetime value using the dateConverter
 * Works for FieldType.DATE, FieldType.DATETIME, and FieldType.TIME
 */
export function DisplayDate() {
  const { value, field } = usePropertyContext()
  // Read display options from field.options (flat structure)
  const opts = field.options as DateDisplayOptions | undefined

  if (!value) return null

  // Parse date based on format
  let date: Date
  if (value instanceof Date) {
    date = value
  } else if (typeof value === 'string') {
    // Try ISO format first (e.g., 2024-01-15T10:30:00.000Z), then yyyy-MM-dd
    date = value.includes('T') ? parseISO(value) : parse(value, 'yyyy-MM-dd', new Date())
  } else {
    return null
  }

  // Validate parsed date
  if (isNaN(date.getTime())) return null

  // Build display options based on field type
  const displayOpts: DateDisplayOptions = {
    ...opts,
    // For TIME fields, use 'time-only' format
    format: field.type === FieldType.TIME ? 'time-only' : (opts?.format ?? 'medium'),
    // For DATETIME fields, always include time
    includeTime: field.type === FieldType.DATETIME || opts?.includeTime,
  }

  // Use the converter to format the display value
  const typedValue = { type: 'date' as const, value: date.toISOString() }
  const formatted = converters.DATE.toDisplayValue(typedValue, displayOpts)

  return (
    <DisplayWrapper copyValue={formatted}>
      {formatted}
    </DisplayWrapper>
  )
}
