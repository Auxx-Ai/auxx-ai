// packages/lib/src/resources/aggregate/trend.ts
//
// Trend window derivation for KPI widgets: given the widget's CURRENT bounded
// date window, derive the PREVIOUS window per compare mode. All math happens in
// the viewer's timezone so "same period last year" lands on the same local
// dates across DST shifts. Unbounded windows have no trend — callers must skip
// the previous-window query rather than invent a fallback window.

import { subYears } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import type { TrendCompare } from '../../dashboards/client'

export type TrendWindows = {
  current: { from: Date; to: Date }
  previous: { from: Date; to: Date }
}

/**
 * Derive the previous window for a trend comparison. Returns `undefined` when
 * the current window is unbounded (no from/to) — the caller then omits
 * `previousValue` and the UI hides the trend.
 */
export function deriveTrendWindows(
  window: { from?: Date; to?: Date },
  compare: TrendCompare,
  timezone: string
): TrendWindows | undefined {
  const { from, to } = window
  if (!from || !to || from >= to) return undefined

  if (compare === 'samePeriodLastYear') {
    // Shift both bounds back one LOCAL year (zone-aware so DST offsets don't drift).
    const prevFrom = fromZonedTime(subYears(toZonedTime(from, timezone), 1), timezone)
    const prevTo = fromZonedTime(subYears(toZonedTime(to, timezone), 1), timezone)
    return { current: { from, to }, previous: { from: prevFrom, to: prevTo } }
  }

  // previousPeriod: the same-length window immediately before the current one.
  const lengthMs = to.getTime() - from.getTime()
  return {
    current: { from, to },
    previous: { from: new Date(from.getTime() - lengthMs), to: from },
  }
}
