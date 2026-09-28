// packages/lib/src/inventory/builds/backflush-range.ts

import {
  addDaysToDayKey,
  dayKeyInZone,
  previousDayKey,
  todayInZone,
} from '@auxx/utils/calendar-day'
import { readEarliestMovementAt } from '../costing/dated-reads'

/** Inclusive `YYYY-MM-DD` days in the book time zone. */
export interface BackflushRange {
  from: string
  to: string
}

/** Days the nightly backflush looks back over, ending yesterday (plans/mrp/17 Q3). */
export const NIGHTLY_BACKFLUSH_LOOKBACK_DAYS = 30

/** The local day before `now` in `timeZone`. */
export function yesterdayInZone(now: Date, timeZone: string): string {
  return previousDayKey(todayInZone(timeZone, now))
}

/** The last `days` local days ending yesterday. */
export function lookbackRange(now: Date, timeZone: string, days: number): BackflushRange {
  const to = yesterdayInZone(now, timeZone)
  return { from: addDaysToDayKey(to, -(Math.max(1, days) - 1)), to }
}

/**
 * Fill an absent end (plans/mrp/17 D1): `from` is the earliest movement of any made part, `to`
 * is yesterday. `null` when no made part has moved, or it first moved after `to`.
 */
export async function resolveBackflushRange(
  organizationId: string,
  input: { from?: string; to?: string },
  context: { timeZone: string; now: Date; madePartIds: readonly string[] }
): Promise<BackflushRange | null> {
  const to = input.to ?? yesterdayInZone(context.now, context.timeZone)
  if (input.from) return { from: input.from, to }

  const earliest = await readEarliestMovementAt(organizationId, context.madePartIds)
  let first: Date | null = null
  for (const at of earliest.values()) {
    if (at && (!first || at < first)) first = at
  }
  if (!first) return null
  const from = dayKeyInZone(first, context.timeZone)
  return from <= to ? { from, to } : null
}
