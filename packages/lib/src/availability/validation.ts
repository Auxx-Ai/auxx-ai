// packages/lib/src/availability/validation.ts
//
// Pure validation helpers shared by the server mutations and the editing UI
// (05-availability.md §A.2, §C.3). No `@auxx/database` imports — safe for `./client`.

import type { TimeRange, WeeklyHours } from './types'

/** Minutes-since-midnight bounds — a full day is `[0, 1440]`. */
const MIN_MINUTE = 0
const MAX_MINUTE = 1440

/**
 * Validate a single day's time ranges: complete + whole-minute, in bounds, `end > start`,
 * and no overlaps. Returns human-readable error messages (empty = valid).
 */
export function validateRanges(ranges: TimeRange[]): string[] {
  const errors: string[] = []
  const sorted = [...ranges].sort((a, b) => a.start - b.start)

  for (const [i, range] of sorted.entries()) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      errors.push('Time range must use whole minutes')
      continue
    }
    if (
      range.start < MIN_MINUTE ||
      range.start > MAX_MINUTE ||
      range.end < MIN_MINUTE ||
      range.end > MAX_MINUTE
    ) {
      errors.push('Time range must be between 0:00 and 24:00')
      continue
    }
    if (range.end <= range.start) {
      errors.push('End time must be after start time')
      continue
    }
    const previous = sorted[i - 1]
    if (previous && range.start < previous.end) {
      errors.push('Time ranges cannot overlap')
    }
  }

  return errors
}

/**
 * Validate a full weekly schedule — every day's `dayOfWeek` in range plus its ranges
 * (see {@link validateRanges}). Returns human-readable error messages (empty = valid).
 */
export function validateWeeklyHours(weekly: WeeklyHours): string[] {
  const errors: string[] = []

  for (const day of weekly.days) {
    if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      errors.push(`Invalid day of week: ${day.dayOfWeek}`)
      continue
    }
    for (const message of validateRanges(day.ranges)) {
      errors.push(`Day ${day.dayOfWeek}: ${message}`)
    }
  }

  return errors
}

/** `organization.weekStart` setting value → date-fns `weekStartsOn` int. */
export function weekStartToIndex(weekStart: 'monday' | 'sunday' | 'saturday'): 0 | 1 | 6 {
  switch (weekStart) {
    case 'sunday':
      return 0
    case 'monday':
      return 1
    case 'saturday':
      return 6
  }
}
