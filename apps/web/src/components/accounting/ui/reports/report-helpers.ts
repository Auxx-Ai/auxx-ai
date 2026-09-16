// apps/web/src/components/accounting/ui/reports/report-helpers.ts
//
// Pure date/period arithmetic behind the reports toolbar (`plans/accounting/
// ui-plan.md` §2.4, §4.5) - as-of derivation for the period control, and the
// compare derivation for the "none / prior period / prior year" dropdown. No
// React, no tRPC: every function here is a plain string-in, string-out
// transform, which is what makes it worth a vitest file rather than exercising
// it only through the pages.
//
// 🛑 A period key ('2027-03') and a period-END date ('2027-03-31') always
// share the same 'YYYY-MM' prefix, so `periodKeyFromDate` is a plain string
// slice - never a timezone conversion. Every date that crosses this file is
// already the calendar day the ledger assigned it (`trial-balance.ts`'s own
// file header makes the same point about `txnDate`); the org's
// `bookTimeZone` only matters for DISPLAY, via `formatAccountingDate`.
//
// The calendar arithmetic itself is `@auxx/utils/calendar-day` - a compare
// range computed here and a range bound applied in SQL must not be two
// implementations of "one month earlier".

import type { StatementRow as LibStatementRow, StatementColumn } from '@auxx/lib/postings/client'
import { isRecordId } from '@auxx/types/resource'
import {
  addDaysToDayKey,
  addMonthsToDayKey,
  daysBetween,
  endOfMonthDay,
  monthKeyOfDay,
  monthsBetween,
  shiftMonthKey,
  startOfMonthDay,
} from '@auxx/utils/calendar-day'
import { formatAccountingDate } from '../ledger/format'
import type { StatementRow } from './statement-table'

/** `'none'` renders no compare snapshot; the other two shift the primary range back. */
export type CompareOption = 'none' | 'prior_period' | 'prior_year'

/** `'2027-03'` -> `'2027-03-01'`. Returns `periodKey` unchanged if it is not `YYYY-MM`. */
export const periodStartDate = startOfMonthDay

/** `'2027-03'` -> `'2027-03-31'`. Returns `periodKey` unchanged if it is not `YYYY-MM`. */
export const periodEndDate = endOfMonthDay

/** `'2027-03-31'` -> `'2027-03'`. The inverse of the two above - see the file header. */
export const periodKeyFromDate = monthKeyOfDay

/** Shift a `'YYYY-MM'` period key by `deltaMonths` (negative moves back). */
export const shiftPeriodKey = shiftMonthKey

export const priorPeriodKey = (periodKey: string): string => shiftPeriodKey(periodKey, -1)
export const priorYearPeriodKey = (periodKey: string): string => shiftPeriodKey(periodKey, -12)

/**
 * The `compareAsOf` date the balance sheet toolbar sends, or `undefined` for
 * `'none'` - what `ledgerReports.balanceSheet`'s `compareAsOf` and
 * `renderStatementPdf`'s `balance-sheet` branch both take.
 *
 * A MONTH-END `asOf` compares to the prior month's own end, which is the
 * convention every balance sheet is read under. Any other `asOf` keeps its day
 * of the month (Sep 16 compares to Aug 16), because somebody who deliberately
 * picked mid-month is not asking to be moved to a month boundary in silence.
 */
export function compareAsOfFor(asOf: string, compare: CompareOption): string | undefined {
  if (compare === 'none') return undefined
  const months = compare === 'prior_period' ? -1 : -12
  if (asOf === endOfMonthDay(asOf)) {
    return endOfMonthDay(shiftPeriodKey(periodKeyFromDate(asOf), months))
  }
  return addMonthsToDayKey(asOf, months)
}

/**
 * The compare `{ from, to }` range the P&L toolbar sends, or `undefined` for
 * `'none'`.
 *
 * 🛑 The compare range has to be COMPARABLE to the primary one, and which
 * arithmetic achieves that depends on where the range is anchored:
 *
 * - `from` is the first of a month - every whole-month range, and every
 *   month/quarter/year-to-date one - so shift both ends back by the span in
 *   whole MONTHS, keeping the day of the month. Sep 1-16 compares to Aug 1-16,
 *   and Feb 1-28 compares to the whole of January rather than to 28 days of it.
 * - anything else is a free-floating window, so take the window of equal length
 *   in DAYS immediately before `from`.
 *
 * Day arithmetic alone is wrong for the first case (months are not the same
 * length); month arithmetic alone is wrong for the second. `'prior_year'` is
 * always twelve months back on both ends, which is unambiguous either way.
 */
export function compareRangeFor(
  from: string,
  to: string,
  compare: CompareOption
): { from: string; to: string } | undefined {
  if (compare === 'none') return undefined

  if (compare === 'prior_year') {
    return { from: addMonthsToDayKey(from, -12), to: addMonthsToDayKey(to, -12) }
  }

  if (from === startOfMonthDay(from)) {
    const span = (monthsBetween(from, to) ?? 0) + 1
    return { from: addMonthsToDayKey(from, -span), to: addMonthsToDayKey(to, -span) }
  }

  const span = daysBetween(from, to)
  if (span === null) return { from, to }
  return { from: addDaysToDayKey(from, -(span + 1)), to: addDaysToDayKey(to, -(span + 1)) }
}

/**
 * `'2026-08-01'`, `'2026-08-31'` -> `'Aug 1, 2026 to Aug 31, 2026'`, in the
 * org's book time zone.
 *
 * "to" rather than an en dash, so the range reads identically on the screen and
 * in the PDF `renderStatementPdf` produces for the same report. A statement a
 * person exports and a statement they are looking at must not differ, even
 * typographically.
 */
export function formatDateRangeLabel(from: string, to: string, bookTimeZone: string): string {
  return `${formatAccountingDate(from, bookTimeZone)} to ${formatAccountingDate(to, bookTimeZone)}`
}

/**
 * The P&L's own columns - one value column, or two when a compare range is
 * present. `toTrialBalanceRows`/`toBalanceSheetRows` have lib-side column
 * helpers (`TRIAL_BALANCE_COLUMNS`, `balanceSheetColumns`); the P&L has none
 * because its column LABEL is a date-range string that needs `bookTimeZone`
 * for display, which is a web-layer concern the lib adapters don't carry.
 */
export function profitAndLossColumns(
  pl: { from: string; to: string; compare?: { from: string; to: string } | null },
  bookTimeZone: string
): StatementColumn[] {
  const columns: StatementColumn[] = [
    {
      key: 'primary',
      label: formatDateRangeLabel(pl.from, pl.to, bookTimeZone),
      align: 'right',
      signed: true,
    },
  ]
  if (pl.compare) {
    columns.push({
      key: 'compare',
      label: formatDateRangeLabel(pl.compare.from, pl.compare.to, bookTimeZone),
      align: 'right',
      signed: true,
    })
  }
  return columns
}

/**
 * The balance sheet's own columns - one as-of snapshot, or two with a compare.
 *
 * Lib has a `balanceSheetColumns` too, but its label is the bare `asOf` string
 * because an adapter has no `bookTimeZone` to format with, so the header on
 * screen read `2026-08-31` while the P&L beside it read `Aug 31, 2026`. Same
 * reason `profitAndLossColumns` lives here rather than in the adapter.
 */
export function balanceSheetColumns(
  bs: { asOf: string; compare?: { asOf: string } | null },
  bookTimeZone: string
): StatementColumn[] {
  const columns: StatementColumn[] = [
    {
      key: 'primary',
      label: formatAccountingDate(bs.asOf, bookTimeZone),
      align: 'right',
      signed: true,
    },
  ]
  if (bs.compare) {
    columns.push({
      key: 'compare',
      label: formatAccountingDate(bs.compare.asOf, bookTimeZone),
      align: 'right',
      signed: true,
    })
  }
  return columns
}

/**
 * Lib's `StatementRow` (`postings/reports/rows.ts`) and the screen's
 * `StatementRow` (`statement-table.tsx`) differ in exactly the two fields
 * `rows.ts`'s own file header calls out: `meta.badge` is a plain `string`
 * there instead of a `ReactNode`, and `meta.recordId` is a plain `string`
 * instead of the app's branded `RecordId`. `badge` widens without help
 * (`string` is a valid `ReactNode`); `recordId` needs `isRecordId` to
 * validate the `defId:instanceId` shape before the cast - aging (2H) is the
 * first adapter to set it (`toAgingRows`, for the document drill-down's
 * `RecordDrawer` link), and no financial-statement adapter sets it, so this
 * is a no-op for those and a real value for aging's document rows.
 */
export function toStatementTableRows(rows: readonly LibStatementRow[]): StatementRow[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    depth: row.depth,
    kind: row.kind,
    values: row.values,
    meta: row.meta
      ? {
          glAccountId: row.meta.glAccountId,
          accountCode: row.meta.accountCode,
          accountName: row.meta.accountName,
          accountType: row.meta.accountType,
          recordId:
            row.meta.recordId && isRecordId(row.meta.recordId) ? row.meta.recordId : undefined,
          glPostingId: row.meta.glPostingId,
          badge: row.meta.badge,
          note: row.meta.note,
        }
      : undefined,
    children: row.children ? toStatementTableRows(row.children) : undefined,
  }))
}
