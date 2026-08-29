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

/**
 * An ACCOUNTING date: the date that decides which period a row belongs to.
 * Rendered in the org's book time zone, because that is the zone the period
 * boundary was drawn in.
 */
export function formatAccountingDate(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(date)
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
