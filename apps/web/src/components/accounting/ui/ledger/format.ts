// apps/web/src/components/accounting/ui/ledger/format.ts

import type { RailFeeStatus } from '@auxx/lib/postings/client'
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

/**
 * Why Lock is refused for a month, or `null` when it is offered.
 *
 * 🛑 A month stays `open` until a MONTH-END entry is posted into it, and
 * `listClosePeriods` counts ONLY `month_end_inventory` rows
 * (`postings/close-periods.ts`). Every other posting in the month - the
 * fulfillment days, credit memos, manual entries - leaves it open however much
 * money they moved. So a month showing $1.3m of posted fulfillment can still
 * refuse to lock, and with no reason on screen that reads as a broken button
 * rather than an unmet precondition.
 *
 * ⚠️ The two refusals need DIFFERENT sentences, and giving the second one the
 * first one's remedy is worse than saying nothing. A `nothing_to_close` month
 * has no month-end entry to post and never will - the Post control above it
 * reads "There is nothing to post" and is itself disabled - so "post it, then
 * lock" points at a dead button. That was the first draft of this copy, and
 * only opening the screen caught it.
 */
export function lockRefusalReason(params: {
  periodLabel: string
  /** `ClosePeriod.state !== 'open'`. */
  isPostedPeriod: boolean
  /** A post that landed in this session, before the period query has caught up. */
  justPosted: boolean
  /** The preview refused with `nothing_to_close`. */
  isNothingToClose: boolean
}): string | null {
  const { periodLabel, isPostedPeriod, justPosted, isNothingToClose } = params
  if (isPostedPeriod || justPosted) return null
  if (isNothingToClose) {
    return `Nothing moved in ${periodLabel}, so there is no month-end entry to post and locking is gated on one. Move to the next month.`
  }
  return `${periodLabel} has no month-end entry yet. Post it under Entries above, then lock the month. The other entries this month do not close it.`
}

/**
 * How long before the month on screen a date falls, in whole months.
 * `'2026-07-14'` seen from `'2026-09'` reads `'2 months ago'`.
 *
 * ⚠️ Relative to the MONTH BEING CLOSED, never to the wall clock. A close
 * console is read weeks after the month it is about, so "two months ago" has to
 * mean two months before that month or the sentence changes meaning depending
 * on when somebody opens it. It also keeps this function pure, which is what
 * lets it be server-rendered without a hydration mismatch.
 *
 * Returns `null` when the date is inside the month on screen or after it -
 * there is no "ago" to state, and inventing one ("0 months ago") would be
 * noise the reader has to decode.
 */
export function formatMonthsAgo(dateKey: string, monthKey: string): string | null {
  const date = /^(\d{4})-(\d{2})/.exec(dateKey)
  const month = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!date || !month) return null

  const months = (Number(month[1]) - Number(date[1])) * 12 + (Number(month[2]) - Number(date[2]))
  if (!Number.isFinite(months) || months <= 0) return null
  return months === 1 ? 'last month' : `${months} months ago`
}

/**
 * What the close console says about one rail's processor fees
 * (plans/accounting/tasks/26-a-clearing-account-per-rail.md §6).
 *
 * 🛑 **A fact, never an alarm.** No verdict, no severity and no remedy: the
 * date is the whole message and the person draws the conclusion. §14's R4 is
 * the reason - a rail that bills quarterly would otherwise nag through two
 * closes in three and teach everybody to ignore the block.
 *
 * 🔑 The `shared` case says so rather than quoting a date. A billed rail whose
 * fees land in the default fee account alongside every netted rail's fallback
 * makes "has this rail billed us" unanswerable (§5), and a date read off that
 * account would be a confident wrong answer.
 *
 * Both switches fail CLOSED: an unrecognised treatment or account shape claims
 * nothing about the rail rather than falling through to the reassuring copy.
 */
export function railFeeSentence(
  rail: RailFeeStatus,
  monthKey: string,
  bookTimeZone: string
): string {
  switch (rail.feeTreatment) {
    case 'netted':
      return 'Netted, booked with each payout.'
    case 'billed':
      break
    default:
      return 'Its fee treatment is not set, so nothing here can be said about its fees.'
  }

  const monthLabel = formatPeriodLabel(monthKey)

  switch (rail.fees.kind) {
    case 'shared':
      return (
        'Billed separately. Its fees go to the default fee account, shared with every other ' +
        "rail, so auxx cannot tell this rail's fees from theirs."
      )
    case 'own': {
      const { bookedInMonth, lastBookedAt } = rail.fees
      if (!lastBookedAt) {
        return 'Billed separately. No fee has ever been booked to its own account.'
      }
      const booked = formatAccountingDate(lastBookedAt, bookTimeZone)
      if (bookedInMonth) return `Billed separately. Last fee booked ${booked}, in ${monthLabel}.`
      const ago = formatMonthsAgo(lastBookedAt, monthKey)
      const suffix = ago ? ` (${ago})` : ''
      return `Billed separately. Last fee booked ${booked}${suffix}. Nothing in ${monthLabel}.`
    }
    default:
      return 'Billed separately. Where its fees are booked could not be read.'
  }
}

/**
 * The one softening remark the fee line may carry: this rail did not trade in
 * the month, so nothing being billed for it is what you would expect.
 *
 * `null` for every other case, including every netted rail - a netted rail's
 * fee rides inside its payout entry and needs no explanation either way.
 */
export function railTradeNote(rail: RailFeeStatus, monthKey: string): string | null {
  if (rail.feeTreatment !== 'billed' || rail.tradedInMonth) return null
  return `Nothing posted to its clearing account in ${formatPeriodLabel(monthKey)}.`
}
