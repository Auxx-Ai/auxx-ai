/**
 * Returns a relative time string (e.g., "3 hours ago", "in 2 days").
 * Past dates read "<n> <unit> ago", future dates "in <n> <unit>". In `short`
 * mode the direction is dropped ("3h", "2d"). Nullish/invalid input returns "-".
 *
 * @param date - The date to format (Date, ISO/parsable string, epoch number)
 * @param short - Compact, direction-less form for tight UI
 */
export function formatRelativeTime(
  date: Date | string | number | null | undefined,
  short: boolean = false
): string {
  if (date === null || date === undefined) return '-'
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return '-'

  const diffInSeconds = Math.floor((Date.now() - d.getTime()) / 1000)
  const isPast = diffInSeconds >= 0
  const abs = Math.abs(diffInSeconds)

  const phrase = (value: number, unit: string, shortUnit: string): string => {
    if (short) return `${value}${shortUnit}`
    const label = `${unit}${value === 1 ? '' : 's'}`
    return isPast ? `${value} ${label} ago` : `in ${value} ${label}`
  }

  if (abs < 60) return phrase(abs, 'second', 's')
  const minutes = Math.floor(abs / 60)
  if (minutes < 60) return phrase(minutes, 'minute', 'm')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return phrase(hours, 'hour', 'h')
  const days = Math.floor(hours / 24)
  if (days < 30) return phrase(days, 'day', 'd')
  const months = Math.floor(days / 30)
  if (months < 12) return phrase(months, 'month', 'mo')
  const years = Math.floor(months / 12)
  return phrase(years, 'year', 'y')
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
export {
  formatInTimezone,
  formatRelativeTimeWithTimezone,
  getCurrentTimeInTimezone,
} from './timezone'
