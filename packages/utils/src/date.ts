/**
 * Returns a relative time string (e.g., "3 hours ago")
 * @param date - The date to format
 * @returns A relative time string
 */
export function formatRelativeTime(date: Date | string, short: boolean = false): string {
  const d = new Date(date)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return `${diffInSeconds} ${short ? 's' : 'seconds ago'}`
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) {
    if (short) {
      return `${diffInMinutes}m`
    }
    return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'} ago`
  }

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) {
    if (short) {
      return `${diffInHours}h`
    }
    return `${diffInHours} hour${diffInHours === 1 ? '' : 's'} ago`
  }

  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays < 30) {
    if (short) {
      return `${diffInDays}d`
    }
    return `${diffInDays} day${diffInDays === 1 ? '' : 's'} ago`
  }

  const diffInMonths = Math.floor(diffInDays / 30)
  if (diffInMonths < 12) {
    if (short) {
      return `${diffInMonths}mo`
    }
    return `${diffInMonths} month${diffInMonths === 1 ? '' : 's'} ago`
  }

  const diffInYears = Math.floor(diffInMonths / 12)
  if (short) {
    return `${diffInYears}y`
  }
  return `${diffInYears} year${diffInYears === 1 ? '' : 's'} ago`
}

/**
 * Check if two dates are in the same week (week starts on Sunday)
 * @param date1 - First date to compare
 * @param date2 - Second date to compare
 * @returns true if both dates are in the same week
 */
export function isSameWeek(date1: Date, date2: Date): boolean {
  const d1 = new Date(date1)
  const d2 = new Date(date2)

  // Set both dates to start of day
  d1.setHours(0, 0, 0, 0)
  d2.setHours(0, 0, 0, 0)

  // Get the start of the week (Sunday) for both dates
  const startOfWeek1 = new Date(d1)
  startOfWeek1.setDate(d1.getDate() - d1.getDay())

  const startOfWeek2 = new Date(d2)
  startOfWeek2.setDate(d2.getDate() - d2.getDay())

  return startOfWeek1.getTime() === startOfWeek2.getTime()
}

/**
 * Get the start of the week (Sunday) for a given date
 * @param date - The date to get the week start for
 * @returns Date object set to the start of the week
 */
export function getStartOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

/**
 * Get the end of the week (Saturday) for a given date
 * @param date - The date to get the week end for
 * @returns Date object set to the end of the week
 */
export function getEndOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  d.setDate(d.getDate() + (6 - d.getDay()))
  return d
}

// Re-export timezone utilities for convenience
export { formatInTimezone, formatRelativeTimeWithTimezone, getCurrentTimeInTimezone } from './timezone'
