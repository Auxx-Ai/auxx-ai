// packages/lib/src/utils/timezone.ts

/**
 * Timezone utility functions for formatting dates in user's preferred timezone
 */

import { formatInTimeZone } from 'date-fns-tz'

/**
 * Format date in user's timezone using date-fns-tz
 * @param date - Date to format
 * @param timezone - User's preferred timezone (e.g., "America/Los_Angeles")
 * @param formatStr - date-fns format string (default: 'PPpp')
 * @returns Formatted date string
 */
export function formatInTimezone(
  date: Date | string | number,
  timezone: string = 'UTC',
  formatStr: string = 'PPpp'
): string {
  try {
    return formatInTimeZone(date, timezone, formatStr)
  } catch (error) {
    // Fallback to UTC if timezone is invalid
    console.warn('Invalid timezone, falling back to UTC:', timezone)
    return formatInTimeZone(date, 'UTC', formatStr)
  }
}

/**
 * Format relative time with timezone awareness
 * @param date - Date to format
 * @param timezone - User's preferred timezone
 * @returns Relative time string (e.g., "2 hours ago") or formatted date
 */
export function formatRelativeTimeWithTimezone(
  date: Date | string,
  timezone: string = 'UTC'
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  // For short durations (< 24 hours), show relative time
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`

  // For longer durations, show formatted date in user's timezone
  return formatInTimezone(d, timezone, 'PP')
}

/**
 * Get current time in user's timezone
 * @param timezone - User's preferred timezone
 * @returns Formatted current time string
 */
export function getCurrentTimeInTimezone(
  timezone: string = 'UTC',
  formatStr: string = 'PPpp'
): string {
  return formatInTimezone(new Date(), timezone, formatStr)
}
