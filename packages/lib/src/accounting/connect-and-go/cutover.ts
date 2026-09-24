// packages/lib/src/accounting/connect-and-go/cutover.ts

// Pure: the cutover month setup proposes and the drain estimate it shows. Client-safe.

/** Where a proposed cutover came from. */
export type CutoverSource = 'current' | 'lock_date' | 'last_full_month'

export interface ProposedCutover {
  cutoffPeriod: string
  source: CutoverSource
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

/** A `YYYY-MM` month key. */
export function isMonthKey(value: string): boolean {
  return MONTH_KEY.test(value)
}

/**
 * The cutover to ask about: the one already set, else the month of the provider's lock date,
 * else the last full month in the book zone (UTC when none is known yet).
 */
export function proposeCutover(input: {
  currentCutoffPeriod: string | null
  lockDate: string | null
  bookTimeZone: string | null
  today: Date
}): ProposedCutover {
  const current = input.currentCutoffPeriod?.trim()
  if (current && isMonthKey(current)) return { cutoffPeriod: current, source: 'current' }

  const lockMonth = input.lockDate?.slice(0, 7)
  if (lockMonth && isMonthKey(lockMonth)) return { cutoffPeriod: lockMonth, source: 'lock_date' }

  const [year, month] = monthIn(input.today, input.bookTimeZone ?? 'UTC')
  const previous = month === 1 ? [year - 1, 12] : [year, month - 1]
  return {
    cutoffPeriod: `${previous[0]}-${String(previous[1]).padStart(2, '0')}`,
    source: 'last_full_month',
  }
}

function monthIn(date: Date, timeZone: string): [number, number] {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(date)
  }
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  return [year, month]
}

/** The recovery job runs every minute and takes up to this many sources per lane per org. */
export const RECOVERY_PER_LANE = 100
export const RECOVERY_INTERVAL_MINUTES = 1

/** Minutes until the slowest lane drains: lanes run side by side, each 100 a minute. */
export function estimateDrainMinutes(laneCounts: readonly number[]): number {
  const runs = Math.max(0, ...laneCounts.map((count) => Math.ceil(count / RECOVERY_PER_LANE)))
  return runs * RECOVERY_INTERVAL_MINUTES
}
