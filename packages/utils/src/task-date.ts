// packages/utils/src/task-date.ts

import type { PredefinedDateOption, RelativeDate } from '@auxx/types/task'
import { findPredefinedOption } from '@auxx/types/task'
import {
  addDays as dateFnsAddDays,
  addMonths as dateFnsAddMonths,
  addYears as dateFnsAddYears,
} from 'date-fns'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'

/**
 * Add days to a date
 * @param baseDate Starting date
 * @param days Number of days to add (can be negative)
 * @returns New date with days added
 */
export function addDays(baseDate: Date, days: number): Date {
  return dateFnsAddDays(baseDate, days)
}

/**
 * Add months to a date
 * Handles month-end dates intelligently (Jan 31 + 1 month = Feb 28/29)
 * @param baseDate Starting date
 * @param months Number of months to add (can be negative)
 * @returns New date with months added
 */
export function addMonths(baseDate: Date, months: number): Date {
  return dateFnsAddMonths(baseDate, months)
}

/**
 * Add years to a date
 * Handles Feb 29 in leap years
 * @param baseDate Starting date
 * @param years Number of years to add (can be negative)
 * @returns New date with years added
 */
export function addYears(baseDate: Date, years: number): Date {
  return dateFnsAddYears(baseDate, years)
}

/**
 * Calculate target date by applying relative duration to base date
 * Pure function - no timezone handling
 * @param baseDate Reference date
 * @param duration Relative date offset to apply
 * @returns Target date with duration applied
 */
export function calculateTargetDate(baseDate: Date, duration: RelativeDate): Date {
  let result = new Date(baseDate)

  if (duration.years) {
    result = addYears(result, duration.years)
  }
  if (duration.months) {
    result = addMonths(result, duration.months)
  }

  const totalDays = (duration.days ?? 0) + (duration.weeks ?? 0) * 7
  if (totalDays !== 0) {
    result = addDays(result, totalDays)
  }

  return result
}

/**
 * Calculate target date in user's timezone
 * This is the PRIMARY method for calculating deadlines
 * @param duration Relative duration to add
 * @param timezone IANA timezone string (e.g., "America/New_York")
 * @param baseDate Optional base date (defaults to now)
 * @returns Target date as UTC Date object (for database storage)
 */
export function calculateTargetDateInTimezone(
  duration: RelativeDate,
  timezone: string,
  baseDate: Date = new Date()
): Date {
  const zonedDate = toZonedTime(baseDate, timezone)
  const targetZoned = calculateTargetDate(zonedDate, duration)
  targetZoned.setHours(0, 0, 0, 0)
  return fromZonedTime(targetZoned, timezone)
}

/**
 * Calculate the end of month date in user's timezone
 * @param timezone IANA timezone string
 * @param baseDate Optional base date (defaults to now)
 * @returns End of month as UTC Date object
 */
export function calculateEndOfMonth(timezone: string, baseDate: Date = new Date()): Date {
  const zonedDate = toZonedTime(baseDate, timezone)
  const year = zonedDate.getFullYear()
  const month = zonedDate.getMonth()
  const lastDay = new Date(year, month + 1, 0)
  lastDay.setHours(0, 0, 0, 0)
  return fromZonedTime(lastDay, timezone)
}

/**
 * Calculate the start of next quarter in user's timezone
 * @param timezone IANA timezone string
 * @param baseDate Optional base date (defaults to now)
 * @returns Start of next quarter as UTC Date object
 */
export function calculateNextQuarter(timezone: string, baseDate: Date = new Date()): Date {
  const zonedDate = toZonedTime(baseDate, timezone)
  const currentMonth = zonedDate.getMonth()
  const currentQuarter = Math.floor(currentMonth / 3)
  const nextQuarterMonth = (currentQuarter + 1) * 3
  const year = nextQuarterMonth >= 12 ? zonedDate.getFullYear() + 1 : zonedDate.getFullYear()
  const month = nextQuarterMonth % 12
  const nextQuarterDate = new Date(year, month, 1)
  nextQuarterDate.setHours(0, 0, 0, 0)
  return fromZonedTime(nextQuarterDate, timezone)
}

/**
 * Calculate duration between two dates
 * Returns relative duration in human terms
 * @param startDate Earlier date
 * @param endDate Later date
 * @returns Duration object with largest applicable units
 */
export function calculateDuration(startDate: Date, endDate: Date): RelativeDate {
  const isNegative = endDate < startDate
  const [earlier, later] = isNegative ? [endDate, startDate] : [startDate, endDate]

  let current = new Date(earlier)
  const result: RelativeDate = {}

  // Count years
  let years = 0
  while (addYears(current, 1) <= later) {
    years++
    current = addYears(current, 1)
  }
  if (years > 0) result.years = isNegative ? -years : years

  // Count months
  let months = 0
  while (addMonths(current, 1) <= later) {
    months++
    current = addMonths(current, 1)
  }
  if (months > 0) result.months = isNegative ? -months : months

  // Count remaining days
  const daysDiff = Math.floor((later.getTime() - current.getTime()) / (1000 * 60 * 60 * 24))
  if (daysDiff > 0) result.days = isNegative ? -daysDiff : daysDiff

  return result
}

/**
 * Format relative date as human-readable string
 * @param duration Relative duration
 * @param isNegative If true, format in past tense
 * @returns Formatted string or null if unsupported
 */
export function formatRelativeDate(duration: RelativeDate, isNegative = false): string | null {
  const preset = findPredefinedOption(duration)
  if (preset) {
    return preset.label
  }

  const direction = isNegative ? 'ago' : 'from now'
  const parts: string[] = []

  if (duration.years) {
    const years = Math.abs(duration.years)
    parts.push(`${years} ${years === 1 ? 'year' : 'years'}`)
  }
  if (duration.months) {
    const months = Math.abs(duration.months)
    parts.push(`${months} ${months === 1 ? 'month' : 'months'}`)
  }
  if (duration.weeks) {
    const weeks = Math.abs(duration.weeks)
    parts.push(`${weeks} ${weeks === 1 ? 'week' : 'weeks'}`)
  }
  if (duration.days) {
    const days = Math.abs(duration.days)
    parts.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  }

  if (parts.length === 0) {
    return null
  }

  if (parts.length === 1) {
    return `${parts[0]} ${direction}`
  }

  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]} ${direction}`
}

/**
 * Format time remaining until deadline
 * @param deadline Target date
 * @param baseDate Reference date (default: now)
 * @returns Formatted string describing time until deadline
 */
export function formatTimeRemaining(deadline: Date, baseDate = new Date()): string {
  const now = new Date(baseDate)
  now.setHours(0, 0, 0, 0)

  const deadlineDate = new Date(deadline)
  deadlineDate.setHours(0, 0, 0, 0)

  const diffMs = deadlineDate.getTime() - now.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return 'due today'
  } else if (diffDays === 1) {
    return 'due tomorrow'
  } else if (diffDays === -1) {
    return '1 day overdue'
  } else if (diffDays < 0) {
    return `${Math.abs(diffDays)} days overdue`
  } else if (diffDays <= 7) {
    return `${diffDays} days remaining`
  } else {
    const weeks = Math.floor(diffDays / 7)
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} remaining`
  }
}

/**
 * Format absolute date for display with timezone
 * @param date Date to format
 * @param timezone IANA timezone string
 * @returns Formatted date string (e.g., "Jan 15, 2026")
 */
export function formatAbsoluteDate(date: Date, timezone: string = 'UTC'): string {
  return formatInTimeZone(date, timezone, 'MMM d, yyyy')
}
