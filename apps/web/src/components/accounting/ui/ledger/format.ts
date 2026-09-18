// apps/web/src/components/accounting/ui/ledger/format.ts

import { formatCurrency } from '@auxx/utils/currency'

/**
 * Display helpers for the ledger screens.
 *
 * ⚠️ Every money value that reaches this file is an INTEGER COUNT OF MINOR
 * UNITS, exactly as the postings module stores it. Nothing here accepts a
 * major-unit decimal, and nothing here converts one: `formatCurrency` already
 * owns the scale via the ISO code's minor-unit exponent, so a zero-exponent
 * currency renders correctly without a second opinion about where the point
 * goes. `~/components/money/ui/settings/format-money.ts` is the same idea for
 * catalog CURRENCY fields.
 */

/** Placeholder for a cell that has no value, as opposed to a zero. */
export const EMPTY_CELL = '—'

/** Format minor units for a ledger column. Never signed: see {@link formatSignedMinor}. */
export function formatMinor(minorUnits: number | null | undefined, currencyCode: string): string {
  if (minorUnits === null || minorUnits === undefined) return EMPTY_CELL
  return formatCurrency(minorUnits, { currencyCode })
}

/**
 * Format minor units with an explicit sign, for a DELTA column only.
 *
 * 🛑 A journal entry must never use this. A bookkeeper reading a two-column
 * table of signed numbers is being asked to convert in their head; debits and
 * credits carry the sign there, and the amount stays positive. The
 * roll-forward's Activity column is a genuine delta, so a sign is the correct
 * reading there.
 */
export function formatSignedMinor(
  minorUnits: number | null | undefined,
  currencyCode: string
): string {
  if (minorUnits === null || minorUnits === undefined) return EMPTY_CELL
  if (minorUnits === 0) return formatCurrency(0, { currencyCode })
  const sign = minorUnits > 0 ? '+' : '-'
  return `${sign}${formatCurrency(Math.abs(minorUnits), { currencyCode })}`
}

/** A signed integer quantity, for a count delta. */
export function formatSignedQuantity(quantity: number): string {
  if (quantity === 0) return '0'
  return quantity > 0 ? `+${quantity}` : String(quantity)
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** `'2027-03'` becomes `'March 2027'`. Returns the key unchanged if it is not a month. */
export function formatPeriodLabel(periodKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey)
  if (!match) return periodKey
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isFinite(year) || month < 1 || month > 12) return periodKey
  return MONTH_LABEL.format(new Date(Date.UTC(year, month - 1, 1)))
}

/** `'2027-03'` becomes `'Mar 2027'`, for a dense strip. */
export function formatShortPeriodLabel(periodKey: string): string {
  return formatPeriodLabel(periodKey).replace(/^(\w{3})\w*/, '$1')
}

const CALENDAR_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * An ACCOUNTING date: the date that decides which period a row belongs to.
 *
 * Two shapes reach here and they are formatted differently on purpose:
 *
 * - A bare `YYYY-MM-DD` key (`txnDate`, a report range end, a rail's
 *   `lastBookedAt`) is ALREADY a calendar day in the book zone. It is formatted
 *   as that day and the zone is not consulted. `new Date('2026-09-01')` is UTC
 *   midnight, and reading that instant in `America/Los_Angeles` is Aug 31, so
 *   the old single path printed the previous day for every org west of
 *   Greenwich (brief 28 §6, found in the build).
 * - A real timestamp (`occurredAt`) is an instant, and the day it falls on
 *   depends on the zone the period boundary was drawn in, so it is rendered in
 *   the org's book time zone.
 */
export function formatAccountingDate(iso: string, timeZone: string): string {
  const dayKey = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (dayKey) {
    return CALENDAR_DAY.format(
      new Date(Date.UTC(Number(dayKey[1]), Number(dayKey[2]) - 1, Number(dayKey[3])))
    )
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(date)
}

/** `'manual_journal'` reads `'Manual journal'`. No hardcoded map: the posting-type union grows. */
export function humanizePostingType(type: string): string {
  const words = type.split('_')
  return words
    .map((word, index) => (index === 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ')
}

/**
 * An AUDIT timestamp: when auxx learned about a row.
 *
 * ⚠️ Never a substitute for the accounting date. The late-arrivals section
 * shows both side by side precisely because they can disagree by weeks.
 */
export function formatAuditTimestamp(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date)
}

/**
 * Why Lock is refused, or `null` when it is offered.
 *
 * 🛑 The close POSTS nothing (MIGRATION step 5), so the refusal is no longer
 * "there is no entry yet" - it is the outstanding work `readCloseBlockers`
 * found. A month with nothing outstanding may be locked.
 */
export function lockRefusalReason(params: {
  periodLabel: string
  /** True while the checklist is still being read: neither offer nor refuse yet. */
  isChecking: boolean
  /** How many pieces of work `readCloseBlockers` found. */
  blockerCount: number
}): string | null {
  const { periodLabel, isChecking, blockerCount } = params
  if (isChecking) return `Checking ${periodLabel} against the movement ledger.`
  if (blockerCount === 0) return null
  return (
    `${periodLabel} has ${blockerCount === 1 ? 'one thing' : `${blockerCount} things`} still ` +
    'outstanding. Clear the list above, then lock the month.'
  )
}
