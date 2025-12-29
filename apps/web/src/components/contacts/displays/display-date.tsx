// apps/web/src/components/contacts/displays/display-date.tsx
import { format, parseISO, parse } from 'date-fns'
import { usePropertyContext } from '../drawer/property-provider'
import DisplayWrapper from './display-wrapper'
import { FieldType } from '@auxx/database/enums'

/**
 * Get the appropriate format string based on field type
 */
const getFormatString = (fieldType: string): string => {
  switch (fieldType) {
    case FieldType.TIME:
      return 'hh:mm a' // 12:30 PM
    case FieldType.DATETIME:
      return 'PPP hh:mm a' // Dec 16, 2025 12:30 PM
    case FieldType.DATE:
    default:
      return 'PPP' // Dec 16, 2025
  }
}

/**
 * DisplayDate component
 * Renders a formatted date/time/datetime value
 * Works for FieldType.DATE, FieldType.DATETIME, and FieldType.TIME
 */
export function DisplayDate() {
  const { value, field } = usePropertyContext()
  const formatStr = getFormatString(field.type)

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

  const formattedDate = format(date, formatStr)

  return (
    <DisplayWrapper className="" copyValue={formattedDate}>
      {formattedDate}
    </DisplayWrapper>
  )
}
