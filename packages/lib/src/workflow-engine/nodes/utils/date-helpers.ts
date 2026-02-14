// packages/lib/src/workflow-engine/nodes/utils/date-helpers.ts

/**
 * Date utility functions for workflow nodes
 * Used by if-else node for date comparisons
 */

/**
 * Check if two dates are on the same day (ignoring time)
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

/**
 * Check if a date is within N days from now
 */
export function isWithinDays(date: Date, days: number): boolean {
  const now = new Date()
  const diff = Math.abs(now.getTime() - date.getTime())
  const daysDiff = diff / (1000 * 60 * 60 * 24)
  return daysDiff <= days
}

/**
 * Check if a date is older than N days from now
 */
export function isOlderThanDays(date: Date, days: number): boolean {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const daysDiff = diff / (1000 * 60 * 60 * 24)
  return daysDiff > days
}

/**
 * Check if a date is in the current week (Sunday to Saturday)
 */
export function isThisWeek(date: Date): boolean {
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())
  weekStart.setHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

  return date >= weekStart && date < weekEnd
}

/**
 * Check if a date is in the current month
 */
export function isThisMonth(date: Date): boolean {
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

/**
 * Parse a value to a Date object
 * Returns null if invalid
 */
export function parseDate(value: any): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}
