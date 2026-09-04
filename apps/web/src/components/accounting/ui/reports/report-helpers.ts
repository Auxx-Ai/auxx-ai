// apps/web/src/components/accounting/ui/reports/report-helpers.ts
//
// Pure date/period arithmetic behind the reports toolbar (`plans/accounting/
// ui-plan.md` §2.4, §4.5) - as-of derivation for the period dropdown, and the
// compare-range derivation for the "none / prior period / prior year"
// dropdown. No React, no tRPC: every function here is a plain string-in,
// string-out transform, which is what makes it worth a vitest file rather
// than exercising it only through the pages.
//
// 🛑 A period key ('2027-03') and a period-END date ('2027-03-31') always
// share the same 'YYYY-MM' prefix, so `periodKeyFromDate` is a plain string
// slice - never a timezone conversion. Every date that crosses this file is
// already the calendar day the ledger assigned it (`trial-balance.ts`'s own
// file header makes the same point about `txnDate`); the org's
// `bookTimeZone` only matters for DISPLAY, via `formatAccountingDate`.

import type { StatementRow as LibStatementRow, StatementColumn } from '@auxx/lib/postings/client'
import { isRecordId } from '@auxx/types/resource'
import { formatAccountingDate } from '../ledger/format'
import type { StatementRow } from './statement-table'

const PERIOD_KEY_PATTERN = /^(\d{4})-(\d{2})$/

/** `'none'` renders no compare snapshot; the other two shift the primary range back. */
export type CompareOption = 'none' | 'prior_period' | 'prior_year'

/** Days in `month` (1-12) of `year`, leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function monthIndex(periodKey: string): number | null {
  const match = PERIOD_KEY_PATTERN.exec(periodKey)
  if (!match?.[1] || !match[2]) return null
  return Number(match[1]) * 12 + (Number(match[2]) - 1)
}

/** `'2027-03'` -> `'2027-03-01'`. Returns `periodKey` unchanged if it is not `YYYY-MM`. */
export function periodStartDate(periodKey: string): string {
  return PERIOD_KEY_PATTERN.test(periodKey) ? `${periodKey}-01` : periodKey
}

/** `'2027-03'` -> `'2027-03-31'`. Returns `periodKey` unchanged if it is not `YYYY-MM`. */
export function periodEndDate(periodKey: string): string {
  const match = PERIOD_KEY_PATTERN.exec(periodKey)
  if (!match?.[1] || !match[2]) return periodKey
  const day = daysInMonth(Number(match[1]), Number(match[2]))
  return `${periodKey}-${String(day).padStart(2, '0')}`
}

/** `'2027-03-31'` -> `'2027-03'`. The inverse of the two functions above - see the file header. */
export function periodKeyFromDate(date: string): string {
  return date.slice(0, 7)
}

/** Shift a `'YYYY-MM'` period key by `deltaMonths` (negative moves back). Unchanged if malformed. */
export function shiftPeriodKey(periodKey: string, deltaMonths: number): string {
  const index = monthIndex(periodKey)
  if (index === null) return periodKey
  const shifted = index + deltaMonths
  const year = Math.floor(shifted / 12)
  const month = ((shifted % 12) + 12) % 12
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

export const priorPeriodKey = (periodKey: string): string => shiftPeriodKey(periodKey, -1)
export const priorYearPeriodKey = (periodKey: string): string => shiftPeriodKey(periodKey, -12)

/**
 * The `compareAsOf` date the balance sheet toolbar sends for `compare`, or
 * `undefined` for `'none'` - what `ledgerReports.balanceSheet`'s
 * `compareAsOf` and `renderStatementPdf`'s `balance-sheet` branch both take.
 */
export function compareAsOfFor(asOf: string, compare: CompareOption): string | undefined {
  if (compare === 'none') return undefined
  const key = periodKeyFromDate(asOf)
  const compareKey = compare === 'prior_period' ? priorPeriodKey(key) : priorYearPeriodKey(key)
  return periodEndDate(compareKey)
}

/**
 * The compare `{ from, to }` range the P&L toolbar sends, or `undefined` for
 * `'none'`. `'prior_period'` shifts back by the SPAN of the primary range (a
 * quarter compares to the prior quarter, not to one month before it);
 * `'prior_year'` always shifts back exactly twelve months.
 */
export function compareRangeFor(
  from: string,
  to: string,
  compare: CompareOption
): { from: string; to: string } | undefined {
  if (compare === 'none') return undefined
  const fromKey = periodKeyFromDate(from)
  const toKey = periodKeyFromDate(to)
  const fromIndex = monthIndex(fromKey)
  const toIndex = monthIndex(toKey)
  const spanMonths = fromIndex !== null && toIndex !== null ? toIndex - fromIndex + 1 : 1
  const shift = compare === 'prior_period' ? -spanMonths : -12
  return {
    from: periodStartDate(shiftPeriodKey(fromKey, shift)),
    to: periodEndDate(shiftPeriodKey(toKey, shift)),
  }
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
          accountCode: row.meta.accountCode,
          recordId:
            row.meta.recordId && isRecordId(row.meta.recordId) ? row.meta.recordId : undefined,
          badge: row.meta.badge,
          note: row.meta.note,
        }
      : undefined,
    children: row.children ? toStatementTableRows(row.children) : undefined,
  }))
}
