// apps/web/src/components/accounting/ui/reports/report-range-presets.ts

/**
 * The preset list the reports' range picker shows, as `{ from, to }` calendar
 * days.
 *
 * 🛑 Not `DateRangePicker`'s default list. That one is calendar-generic —
 * "Today", "Last 7 days" — which answers no question a profit and loss is
 * asked, and its "All time" is a hardcoded `2020-01-01` rather than the org's
 * own `accounting.cutoffPeriod`. A preset that silently starts before the books
 * do produces a statement whose opening figures came from nowhere.
 *
 * ⚠️ The general ledger takes a DIFFERENT list on purpose ({@link
 * generalLedgerRangePresets}). Every other statement is bounded by the chart,
 * so a wide range is merely slow; the ledger is bounded by transaction volume
 * and comes back truncated past `GENERAL_LEDGER_MAX_LINES`. Offering "Last 12
 * months" there is a one-click way to get an INCOMPLETE ledger.
 */

import {
  addDaysToDayKey,
  dayKeyOfLocalDate,
  endOfMonthDay,
  localDateOfDayKey,
  monthKeyOfDay,
  shiftMonthKey,
  startOfMonthDay,
} from '@auxx/utils/calendar-day'
import { endOfQuarter, startOfQuarter, subQuarters } from 'date-fns'

export interface ReportRangePreset {
  label: string
  from: string
  to: string
}

/** The quarter `dayKey` falls in, `quartersBack` before it, as calendar days. */
function quarterOf(dayKey: string, quartersBack = 0): { from: string; to: string } {
  const anchor = subQuarters(localDateOfDayKey(dayKey), quartersBack)
  return {
    from: dayKeyOfLocalDate(startOfQuarter(anchor)),
    to: dayKeyOfLocalDate(endOfQuarter(anchor)),
  }
}

/**
 * The statement presets, resolved against `today` in the BOOK time zone and
 * floored at `cutoff` (the first day the books cover), or unfloored when the
 * org has no usable cutoff.
 *
 * "To date" ranges end on `today`, not on the period end: a P&L for a month
 * that has not finished must not imply it has.
 */
export function reportRangePresets(today: string, cutoff: string | null): ReportRangePreset[] {
  const thisMonth = monthKeyOfDay(today)
  const lastMonth = shiftMonthKey(thisMonth, -1)
  const thisQuarter = quarterOf(today)
  const lastQuarter = quarterOf(today, 1)
  const year = today.slice(0, 4)
  const lastYear = String(Number(year) - 1)

  const presets: ReportRangePreset[] = [
    { label: 'Month to date', from: startOfMonthDay(thisMonth), to: today },
    { label: 'Last month', from: startOfMonthDay(lastMonth), to: endOfMonthDay(lastMonth) },
    { label: 'Quarter to date', from: thisQuarter.from, to: today },
    { label: 'Last quarter', from: lastQuarter.from, to: lastQuarter.to },
    { label: 'Year to date', from: `${year}-01-01`, to: today },
    { label: 'Last year', from: `${lastYear}-01-01`, to: `${lastYear}-12-31` },
  ]

  // Only when there is a floor to name. "All time" with no cutoff would be the
  // same invented start date this file exists to avoid.
  if (cutoff) presets.push({ label: 'All time', from: cutoff, to: today })

  return presets.map((preset) =>
    cutoff && preset.from < cutoff ? { ...preset, from: cutoff } : preset
  )
}

/**
 * The general ledger's shorter list — see the file header for why it is not the
 * same one.
 */
export function generalLedgerRangePresets(today: string): ReportRangePreset[] {
  const thisMonth = monthKeyOfDay(today)
  const lastMonth = shiftMonthKey(thisMonth, -1)
  return [
    { label: 'Month to date', from: startOfMonthDay(thisMonth), to: today },
    { label: 'Last month', from: startOfMonthDay(lastMonth), to: endOfMonthDay(lastMonth) },
    { label: 'Last 7 days', from: addDaysToDayKey(today, -6), to: today },
    { label: 'Last 30 days', from: addDaysToDayKey(today, -29), to: today },
  ]
}

/** One entry in the as-of picker's rail, as a single calendar day. */
export interface ReportAsOfPreset {
  label: string
  date: string
}

/**
 * The as-of picker's presets — the same vocabulary {@link reportRangePresets}
 * uses, reduced to the one date an as-of statement takes.
 *
 * ⚠️ A preset that lands before `cutoff` is DROPPED rather than floored to it.
 * Flooring a range's `from` keeps the label honest ("Year to date", clipped to
 * where the books start); flooring a single date would make "Last year end"
 * name a day that is not the end of last year.
 */
export function reportAsOfPresets(today: string, cutoff: string | null): ReportAsOfPreset[] {
  const lastMonth = shiftMonthKey(monthKeyOfDay(today), -1)
  const lastYear = String(Number(today.slice(0, 4)) - 1)

  const presets: ReportAsOfPreset[] = [
    { label: 'Today', date: today },
    { label: 'Last month end', date: endOfMonthDay(lastMonth) },
    { label: 'Last quarter end', date: quarterOf(today, 1).to },
    { label: 'Last year end', date: `${lastYear}-12-31` },
  ]

  return presets.filter((preset) => !cutoff || preset.date >= cutoff)
}
