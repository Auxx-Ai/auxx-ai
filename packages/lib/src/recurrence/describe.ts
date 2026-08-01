// packages/lib/src/recurrence/describe.ts
//
// Human-readable summary of a `RecurrencePattern` (plans/dispatch/06-recurring-engine.md §2.2),
// e.g. "Every 2 weeks on Tue, Thu · until Dec 12" or "Monthly on the 2nd Tuesday · 12 visits".
// Pure — callers pass the org's `weekStart` setting for weekday-list ordering; this function
// never reads settings itself (05-availability.md §A.1b).

import { format } from 'date-fns'
import type { RecurrencePattern } from './types'

const WEEKDAY_ABBREVIATIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Weekday display order for each `weekStart` setting, starting from that setting's first day. */
const WEEKDAY_ORDER: Record<'monday' | 'sunday' | 'saturday', number[]> = {
  sunday: [0, 1, 2, 3, 4, 5, 6],
  monday: [1, 2, 3, 4, 5, 6, 0],
  saturday: [6, 0, 1, 2, 3, 4, 5],
}

export interface DescribeRecurrenceOptions {
  /** Org `weekStart` setting — controls weekday ordering in the weekly variant's list. */
  weekStart: 'monday' | 'sunday' | 'saturday'
}

/** `1` → "1st", `2` → "2nd", `3` → "3rd", `4`/`11`-`13`/`21` → "4th"/"11th"-"13th"/"21st". */
function ordinal(n: number): string {
  const mod100 = Math.abs(n) % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (Math.abs(n) % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function nthLabel(nth: 1 | 2 | 3 | 4 | -1): string {
  return nth === -1 ? 'last' : ordinal(nth)
}

function formatUntil(until: string): string {
  const [year = 0, month = 1, day = 1] = until.split('-').map(Number)
  return format(new Date(year, month - 1, day), 'MMM d')
}

function describeFrequency(
  pattern: RecurrencePattern,
  weekStart: DescribeRecurrenceOptions['weekStart']
): string {
  switch (pattern.frequency) {
    case 'daily':
      return pattern.interval === 1 ? 'Every day' : `Every ${pattern.interval} days`

    case 'weekly': {
      const order = WEEKDAY_ORDER[weekStart]
      const days = (pattern.weekdays ?? [])
        .slice()
        .sort((a, b) => order.indexOf(a) - order.indexOf(b))
        .map((day) => WEEKDAY_ABBREVIATIONS[day])
        .join(', ')
      return pattern.interval === 1
        ? `Weekly on ${days}`
        : `Every ${pattern.interval} weeks on ${days}`
    }

    case 'monthly': {
      const suffix = pattern.nthWeekday
        ? `the ${nthLabel(pattern.nthWeekday.nth)} ${WEEKDAY_NAMES[pattern.nthWeekday.weekday]}`
        : `the ${ordinal(pattern.monthDay ?? 1)}`
      return pattern.interval === 1
        ? `Monthly on ${suffix}`
        : `Every ${pattern.interval} months on ${suffix}`
    }
  }
}

export interface RecurrenceDescriptionParts {
  /** e.g. "Every 2 weeks on Tue, Thu" or "Monthly on the 2nd Tuesday". */
  frequency: string
  /** e.g. "until Dec 12" or "12 visits" — absent for a never-ending pattern. */
  ends?: string
}

/**
 * Structured variant of `describeRecurrence` for UIs that place the frequency and the
 * end condition in separate slots (e.g. the Job view Schedule section's recurrence row).
 */
export function describeRecurrenceParts(
  pattern: RecurrencePattern,
  options: DescribeRecurrenceOptions
): RecurrenceDescriptionParts {
  const frequency = describeFrequency(pattern, options.weekStart)

  if (pattern.until) return { frequency, ends: `until ${formatUntil(pattern.until)}` }
  if (pattern.count) {
    return { frequency, ends: `${pattern.count} visit${pattern.count === 1 ? '' : 's'}` }
  }
  return { frequency }
}

/**
 * Human-readable summary of a `RecurrencePattern`, e.g. "Every 2 weeks on Tue, Thu · until
 * Dec 12" or "Monthly on the 2nd Tuesday · 12 visits" — used by the Job view Schedule section
 * and the #7 popover's Repeats summary.
 */
export function describeRecurrence(
  pattern: RecurrencePattern,
  options: DescribeRecurrenceOptions
): string {
  const { frequency, ends } = describeRecurrenceParts(pattern, options)
  return ends ? `${frequency} · ${ends}` : frequency
}
