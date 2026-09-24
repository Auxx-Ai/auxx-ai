// packages/lib/src/accounting/connect-and-go/cutover.ts

// Pure: the cutover month setup proposes and the drain estimate it shows. Client-safe.

import { monthKeyOfDay, shiftMonthKey, todayInZone } from '@auxx/utils'
import { isMonthKey, isValidTimeZone } from '../ledger/setup/setup-readiness'

/** Where a proposed cutover came from. */
export type CutoverSource = 'current' | 'lock_date' | 'last_full_month'

export interface ProposedCutover {
  cutoffPeriod: string
  source: CutoverSource
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

  const lockMonth = input.lockDate ? monthKeyOfDay(input.lockDate) : null
  if (lockMonth && isMonthKey(lockMonth)) return { cutoffPeriod: lockMonth, source: 'lock_date' }

  const zone =
    input.bookTimeZone && isValidTimeZone(input.bookTimeZone) ? input.bookTimeZone : 'UTC'
  return {
    cutoffPeriod: shiftMonthKey(monthKeyOfDay(todayInZone(zone, input.today)), -1),
    source: 'last_full_month',
  }
}

/** The recovery job runs every minute and takes up to this many sources per lane per org. */
export const RECOVERY_PER_LANE = 100

/** Minutes until the slowest lane drains: lanes run side by side, each 100 a minute. */
export function estimateDrainMinutes(laneCounts: readonly number[]): number {
  return Math.max(0, ...laneCounts.map((count) => Math.ceil(count / RECOVERY_PER_LANE)))
}
