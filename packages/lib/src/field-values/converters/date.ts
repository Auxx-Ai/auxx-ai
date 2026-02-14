// packages/lib/src/field-values/converters/date.ts

import type { DateFieldValue, TypedFieldValue, TypedFieldValueInput } from '@auxx/types/field-value'
import { DEFAULT_DATE_OPTIONS } from '../../custom-fields/defaults'
import type { FieldOptions, FieldValueConverter } from './index'

/**
 * Converter for date-based field types:
 * DATE, DATETIME, TIME
 *
 * All store as valueDate in the database (ISO 8601 format).
 */
export const dateConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts Date object, ISO string, timestamp number, or null/undefined.
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'date') {
        const dateValue = (typed as DateFieldValue).value
        if (!dateValue) return null
        return { type: 'date', value: dateValue }
      }
    }

    // Handle empty string
    if (typeof value === 'string' && value.trim() === '') {
      return null
    }

    // Parse Date object
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        return null
      }
      return { type: 'date', value: value.toISOString() }
    }

    // Parse ISO string
    if (typeof value === 'string') {
      const date = new Date(value)
      if (isNaN(date.getTime())) {
        return null
      }
      return { type: 'date', value: date.toISOString() }
    }

    // Parse timestamp number
    if (typeof value === 'number') {
      const date = new Date(value)
      if (isNaN(date.getTime())) {
        return null
      }
      return { type: 'date', value: date.toISOString() }
    }

    return null
  },

  /**
   * Convert TypedFieldValue/Input to raw ISO string value.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): string | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle TypedFieldValue or TypedFieldValueInput
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'date') {
        return (typed as DateFieldValue).value ?? null
      }
      return null
    }

    // Handle Date object
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return null
      return value.toISOString()
    }

    // Handle raw string passthrough
    if (typeof value === 'string') {
      const date = new Date(value)
      if (isNaN(date.getTime())) return null
      return date.toISOString()
    }

    return null
  },

  /**
   * Convert TypedFieldValue to display string.
   * Applies display options for format, timezone, and timeFormat.
   */
  toDisplayValue(value: TypedFieldValue, options?: FieldOptions): string {
    if (!value) {
      return ''
    }

    const typed = value as DateFieldValue
    const dateString = typed.value

    if (!dateString) {
      return ''
    }

    const date = new Date(dateString)
    if (isNaN(date.getTime())) {
      return ''
    }

    // Merge defaults with provided options
    const opts = { ...DEFAULT_DATE_OPTIONS, ...options }

    // For time-only display (e.g., TIME field type)
    if (opts.format === 'time-only') {
      const formatOptions: Intl.DateTimeFormatOptions = {
        timeZone: opts.timeZone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: opts.timeFormat === '12h',
      }
      return date.toLocaleTimeString(undefined, formatOptions)
    }

    const formatOptions: Intl.DateTimeFormatOptions = {
      timeZone: opts.timeZone,
    }

    switch (opts.format) {
      case 'short':
        formatOptions.dateStyle = 'short'
        if (opts.includeTime) formatOptions.timeStyle = 'short'
        break
      case 'medium':
        formatOptions.dateStyle = 'medium'
        if (opts.includeTime) formatOptions.timeStyle = 'short'
        break
      case 'long':
        formatOptions.dateStyle = 'long'
        if (opts.includeTime) formatOptions.timeStyle = 'medium'
        break
      case 'relative':
        return formatRelativeTime(date)
      case 'iso':
        return dateString
      default:
        formatOptions.dateStyle = 'medium'
    }

    return date.toLocaleString(undefined, formatOptions)
  },
}

/**
 * Format a date as relative time (e.g., "2 days ago", "in 3 hours")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffSeconds = Math.round(diffMs / 1000)
  const diffMinutes = Math.round(diffSeconds / 60)
  const diffHours = Math.round(diffMinutes / 60)
  const diffDays = Math.round(diffHours / 24)

  // Use Intl.RelativeTimeFormat if available
  if (typeof Intl !== 'undefined' && Intl.RelativeTimeFormat) {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

    if (Math.abs(diffSeconds) < 60) {
      return rtf.format(diffSeconds, 'second')
    }
    if (Math.abs(diffMinutes) < 60) {
      return rtf.format(diffMinutes, 'minute')
    }
    if (Math.abs(diffHours) < 24) {
      return rtf.format(diffHours, 'hour')
    }
    if (Math.abs(diffDays) < 30) {
      return rtf.format(diffDays, 'day')
    }
    // Fall back to standard date format for older dates
    return date.toLocaleDateString(undefined, { dateStyle: 'medium' })
  }

  // Fallback for environments without Intl.RelativeTimeFormat
  if (Math.abs(diffDays) < 1) {
    if (Math.abs(diffHours) < 1) {
      return `${Math.abs(diffMinutes)} minutes ${diffMinutes < 0 ? 'ago' : 'from now'}`
    }
    return `${Math.abs(diffHours)} hours ${diffHours < 0 ? 'ago' : 'from now'}`
  }
  return `${Math.abs(diffDays)} days ${diffDays < 0 ? 'ago' : 'from now'}`
}
