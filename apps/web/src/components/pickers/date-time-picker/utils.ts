// apps/web/src/components/pickers/date-time-picker/utils.ts

import { format, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns'
import { Period } from './types'

/**
 * Get hour in 12-hour format (1-12)
 */
export function getHourIn12HourFormat(date: Date): number {
  const hours = date.getHours()
  return hours % 12 || 12
}

/**
 * Convert 12-hour format to 24-hour format
 */
export function to24Hour(hour12: number, period: Period): number {
  const normalized = hour12 % 12
  return period === Period.PM ? normalized + 12 : normalized
}

/**
 * Get period (AM/PM) from date
 */
export function getPeriod(date: Date): Period {
  return date.getHours() >= 12 ? Period.PM : Period.AM
}

/**
 * Format time for display (hh:mm A)
 */
export function formatTime12Hour(date: Date): string {
  return format(date, 'hh:mm a')
}

/**
 * Format date for display
 */
export function formatDateDisplay(date: Date, formatStr: string = 'PPP'): string {
  return format(date, formatStr)
}

/**
 * Format date-time for display
 */
export function formatDateTimeDisplay(
  date: Date,
  dateFormat: string = 'PP',
  timeFormat: string = 'hh:mm a'
): string {
  return format(date, `${dateFormat} ${timeFormat}`)
}

/**
 * Clone time from one date to another
 * Preserves the date part from targetDate but uses time from sourceTime
 */
export function cloneTimeToDate(targetDate: Date, sourceTime: Date): Date {
  const result = new Date(targetDate)
  result.setHours(
    sourceTime.getHours(),
    sourceTime.getMinutes(),
    sourceTime.getSeconds(),
    sourceTime.getMilliseconds()
  )
  return result
}

/**
 * Create a date with specific time components
 */
export function createDateWithTime(
  baseDate: Date | undefined,
  hours: number,
  minutes: number
): Date {
  const date = baseDate ? new Date(baseDate) : new Date()
  return setMilliseconds(setSeconds(setMinutes(setHours(date, hours), minutes), 0), 0)
}

/**
 * Get start of day (00:00:00.000)
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}
