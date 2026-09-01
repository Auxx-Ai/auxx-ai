// packages/lib/src/purchasing/match.ts

import { isAtPrecision, minorToMajorString, RATE_DECIMALS } from '@auxx/utils/currency'
import { BadRequestError } from '../errors'
import { roundCents } from '../money/totals'
import type { AwaitingLine, MatchLine, MatchReason, MatchResult, MatchTolerance } from './types'

/**
 * The three-way match: bill against receipt against purchase order
 * (build plan section 6.1).
 *
 * Two of the three checks live here, because they are the two that are pure:
 * quantity (billed vs received — paying for what never arrived) and price
 * (billed vs agreed — a price nobody agreed). The third, completeness
 * (received-not-billed and aged, the GRNI residual), is a query across bills
 * and receipts rather than a property of one bill, so it is not this function's
 * job. Nothing here reads the database, which is what makes the match
 * previewable in the UI before commit and testable to exhaustion.
 *
 * 🛑 **Nothing in this module reads a clock.** `asOf` is a parameter on every
 * function that needs one, threaded down from the caller, for the same reason
 * nothing here reads the database: the aging rule that turns `awaiting_receipt`
 * into `receipt_overdue` (P24) is only testable to exhaustion if "now" is an
 * input. Do not import a clock here, and do not default `asOf` to `new Date()` —
 * a default would make the omission silent at every call site.
 */

/**
 * 2% or $5, whichever is larger, quantities must be exact, and a still-unreceived
 * line gets 7 days past the order's expected date before it is called late.
 *
 * The absolute floor matters more than the percent on a small line: 2% of a
 * $3 part is 6 cents, which every vendor's rounding breaks. The percent matters
 * more on a large one. Taking the maximum means neither term has to be wrong to
 * keep the other useful.
 *
 * `receiptGraceDays` is the patience half of P24: the purchase order's
 * `expectedAt` supplies the deadline, this supplies how long past it a shipment
 * is still just late rather than a problem. Seven days is a week of slack on a
 * date the vendor gave us, which is roughly the interval at which somebody would
 * chase it by hand.
 *
 * ⚠️ All four terms are HARDCODED — they are constants in this file and nothing
 * reads them from anywhere else. Making them per-org configuration was
 * considered and deliberately not done (P24): a settings row is a screen, a
 * migration and a cache key for four numbers that nobody has yet asked to
 * change. If the exception queue is usually empty these numbers are right; if it
 * is never empty they are wrong, and *then* they become a settings row.
 */
export const DEFAULT_MATCH_TOLERANCE: MatchTolerance = {
  pricePercent: 2,
  priceAbsolute: 500,
  quantityExact: true,
  receiptGraceDays: 7,
}

const MS_PER_DAY = 86_400_000

function assertQuantity(value: number, label: string, index: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestError(`Line ${index} ${label} must be a non-negative number`)
  }
}

function assertPrice(value: number, label: string, index: number): void {
  // Negative unit prices are allowed: a credit line on a vendor bill is a real
  // thing. `unitPriceBilled` / `unitPriceExpected` are RATES, so the guard
  // accepts up to RATE_DECIMALS (five major-unit places), never a whole
  // minor unit only - a fastener vendor's per-thousand price is exact at
  // `1.594` and must not be refused here.
  if (!Number.isFinite(value) || !isAtPrecision(value, RATE_DECIMALS)) {
    throw new BadRequestError(`Line ${index} ${label} must have at most five decimal places`)
  }
}

function assertTolerance(tolerance: MatchTolerance): void {
  if (!Number.isFinite(tolerance.pricePercent) || tolerance.pricePercent < 0) {
    throw new BadRequestError('Tolerance pricePercent must be a non-negative number')
  }
  if (!Number.isFinite(tolerance.priceAbsolute) || tolerance.priceAbsolute < 0) {
    throw new BadRequestError('Tolerance priceAbsolute must be a non-negative number')
  }
  if (!Number.isFinite(tolerance.receiptGraceDays) || tolerance.receiptGraceDays < 0) {
    throw new BadRequestError('Tolerance receiptGraceDays must be a non-negative number')
  }
}

/**
 * The price allowance for one expected unit price, in minor units.
 *
 * `max(pricePercent% of |expected|, priceAbsolute)`. Written as a
 * multiplication, never a division, so an `unitPriceExpected` of 0 degenerates
 * cleanly: the percent term collapses to 0 and the absolute term carries the
 * whole allowance, with no divide-by-zero and no NaN escaping into a comparison
 * that would then silently pass. `Math.abs` so a credit line gets the same
 * allowance a charge line would.
 *
 * Deliberately NOT rounded to a whole minor unit: the comparison is
 * `|difference| <= allowance`, so leaving 2% of 12345 as 246.9 makes an integer
 * difference of 246 pass and 247 fail, which is the conservative reading of
 * "within 2%".
 */
export function priceAllowance(unitPriceExpected: number, tolerance: MatchTolerance): number {
  const percentTerm = (Math.abs(unitPriceExpected) * tolerance.pricePercent) / 100
  return Math.max(percentTerm, tolerance.priceAbsolute)
}

/**
 * The instant a still-unreceived line stops being merely early and becomes late:
 * the order's `expectedAt` plus the grace period, as epoch milliseconds.
 *
 * `null` when there is no deadline to compute — the order carries no expected
 * date, or carries an unparseable one. Both mean the same thing to every caller
 * above: this line cannot be judged late.
 */
function receiptDeadline(line: MatchLine, tolerance: MatchTolerance): number | null {
  if (!line.expectedAt) return null
  const expected = line.expectedAt.getTime()
  // `new Date('nonsense')` is a Date whose time is NaN. Every comparison against
  // it is false, so an unchecked one would read as "not overdue" by accident
  // rather than by decision — which is the right answer for the wrong reason.
  if (!Number.isFinite(expected)) return null
  return expected + tolerance.receiptGraceDays * MS_PER_DAY
}

/**
 * Has this line outlived its grace period?
 *
 * ⚠️ **`expectedAt` absent means NO.** A line the vendor billed against an order
 * that never carried an expected date cannot be judged late — nobody agreed a
 * date to be late against. It therefore stays {@link isAwaitingReceipt}
 * indefinitely rather than falling back to an exception.
 *
 * That direction is deliberate and it is the *unsafe-looking* one: a vendor who
 * takes the money and never ships against a dateless order never surfaces here.
 * The alternative is worse. Falling back to `exception` would put every bill on
 * a dateless order into the queue permanently, which is exactly the flood of
 * false positives P24 exists to stop, and `purchase_order_expected_at` is
 * nullable with nothing prefilling it — so the fallback would be the common case,
 * not the edge one. The completeness check (the GRNI residual, a query across
 * bills and receipts rather than a property of one bill) is where a dateless
 * never-arriving order is meant to surface.
 *
 * Strictly past, not on: a line exactly at `expectedAt + graceDays` is still
 * inside its grace, the same forgiving direction `|difference| <= allowance`
 * takes on the price leg.
 */
export function isReceiptOverdue(line: MatchLine, tolerance: MatchTolerance, asOf: Date): boolean {
  if (line.quantityBilled <= line.quantityReceived) return false
  const deadline = receiptDeadline(line, tolerance)
  if (deadline === null) return false
  return asOf.getTime() > deadline
}

/**
 * Is this line billed ahead of its receipt and not yet late — the prepaid case?
 *
 * 🛑 This is **not** a failure (P24). Vendors here often will not ship until the
 * invoice is paid, so `quantityBilled > quantityReceived` is the normal state of
 * a *correct* bill for weeks. It becomes one — `receipt_overdue` — only once
 * {@link isReceiptOverdue} says the shipment outlived its grace.
 */
export function isAwaitingReceipt(line: MatchLine, tolerance: MatchTolerance, asOf: Date): boolean {
  if (line.quantityBilled <= line.quantityReceived) return false
  return !isReceiptOverdue(line, tolerance, asOf)
}

/**
 * Every reason one bill line fails, in check order. An empty array is a clean
 * line — but see the caveat: an empty array is NOT the same as "matched", because
 * an awaiting line also has no reasons. {@link matchBill} asks
 * {@link isAwaitingReceipt} separately.
 *
 * Quantity: `quantityBilled > quantityReceived` used to be an unconditional
 * `quantity_over_billed`. Under P24 it is not a reason at all until it is late.
 * The line is `awaiting_receipt` until `expectedAt + receiptGraceDays` passes,
 * and then it is `receipt_overdue`. `quantity_over_billed` was consequently
 * unreachable and has been deleted rather than left as a code nothing emits.
 * `quantityBilled < quantityReceived` is unchanged: an exception only under
 * `quantityExact`, because a vendor billing in instalments against one receipt
 * is normal in the loose mode and is caught by the completeness check instead.
 *
 * Price is checked on every line, including zero-quantity ones and awaiting
 * ones: a unit price nobody agreed is worth naming even when this particular
 * line moves no money, because it is usually the first line of a repricing the
 * vendor did not announce. An awaiting line with a price variance is therefore
 * an exception — price is judgeable the moment the invoice arrives.
 *
 * @param asOf The instant to age against. Required and never defaulted — see the
 *   module header.
 * @throws BadRequestError on a negative quantity or a non-integer price.
 */
export function matchBillLine(
  line: MatchLine,
  tolerance: MatchTolerance,
  lineIndex: number,
  asOf: Date
): MatchReason[] {
  assertQuantity(line.quantityBilled, 'quantityBilled', lineIndex)
  assertQuantity(line.quantityReceived, 'quantityReceived', lineIndex)
  assertPrice(line.unitPriceBilled, 'unitPriceBilled', lineIndex)
  assertPrice(line.unitPriceExpected, 'unitPriceExpected', lineIndex)

  const reasons: MatchReason[] = []

  if (isReceiptOverdue(line, tolerance, asOf)) {
    reasons.push({
      code: 'receipt_overdue',
      lineIndex,
      quantityBilled: line.quantityBilled,
      quantityReceived: line.quantityReceived,
      // Non-null by construction: `isReceiptOverdue` is false without a date.
      expectedAt: line.expectedAt as Date,
      graceDays: tolerance.receiptGraceDays,
    })
  } else if (tolerance.quantityExact && line.quantityBilled < line.quantityReceived) {
    reasons.push({
      code: 'quantity_under_billed',
      lineIndex,
      quantityBilled: line.quantityBilled,
      quantityReceived: line.quantityReceived,
    })
  }

  const difference = line.unitPriceBilled - line.unitPriceExpected
  const allowed = priceAllowance(line.unitPriceExpected, tolerance)
  if (Math.abs(difference) > allowed) {
    reasons.push({
      code: 'price_variance',
      lineIndex,
      unitPriceBilled: line.unitPriceBilled,
      unitPriceExpected: line.unitPriceExpected,
      difference,
      allowed,
    })
  }

  return reasons
}

/**
 * Signed money at stake across the bill, in minor units: what the vendor is
 * asking for minus what is owed for what actually arrived at the agreed price.
 *
 * Expected is `quantityReceived x unitPriceExpected`, not
 * `quantityBilled x unitPriceExpected` — otherwise an over-billed quantity nets
 * out of the variance entirely and the one number the exception queue shows
 * would hide the exact failure the match exists to catch. Positive means the
 * bill is asking for more than the receipt justifies.
 *
 * ## The one exception: an awaiting line is PRICE-ONLY
 *
 * That reasoning holds for every line whose quantity can be judged — and an
 * {@link isAwaitingReceipt} line's cannot. A prepaid line with zero received
 * would otherwise carry its **entire value** as variance for the weeks before
 * the goods land, so relabelling the outcome `awaiting_receipt` would leave the
 * queue's money column screaming exactly as loudly as before and fix nothing
 * that matters. For those lines expected is `quantityBilled x
 * unitPriceExpected`: the quantity leg cancels and what is left is the price
 * variance, which IS judgeable today (P24).
 *
 * A `receipt_overdue` line is NOT awaiting and keeps the full formula — once the
 * shipment is late, "billed for what never arrived" is real money at stake again
 * and the original argument above applies unchanged.
 *
 * @param asOf The instant to age against — this function has to know which lines
 *   are awaiting, so it takes the same two inputs `matchBill` does.
 */
export function matchVariance(
  lines: MatchLine[],
  asOf: Date,
  tolerance: MatchTolerance = DEFAULT_MATCH_TOLERANCE
): number {
  return lines.reduce((total, line) => {
    const billed = roundCents(line.quantityBilled * line.unitPriceBilled)
    const quantity = isAwaitingReceipt(line, tolerance, asOf)
      ? line.quantityBilled
      : line.quantityReceived
    const expected = roundCents(quantity * line.unitPriceExpected)
    return total + billed - expected
  }, 0)
}

/**
 * Roll the per-line checks up to one bill-level verdict (build plan section 6.1).
 *
 * `matched` is the only status phase 7 will ever post to the GL, so this
 * function is the gate on an automatic posting — every reason it fails to
 * report is a wrong journal entry later. It reports ALL reasons rather than
 * short-circuiting on the first, because the exception queue is a human triage
 * surface: knowing a bill has both a quantity and a price problem changes who
 * gets called.
 *
 * An empty line list is `matched`: there is nothing that can fail. Whether an
 * empty bill is meaningful at all is the caller's question, not the match's.
 *
 * Precedence between the three outcomes (P24): **any real reason wins**, even
 * when other lines are still awaiting goods — a price nobody agreed is a
 * conversation to have now, and burying it under an amber "awaiting" badge
 * would be the false-negative twin of the false-positive flood this change
 * removes. Only when there is no reason at all does an awaiting line decide the
 * bill.
 *
 * @param asOf The instant to age `awaiting_receipt` against. Required and never
 *   defaulted — see the module header.
 * @throws BadRequestError on a negative quantity, a non-integer price, or a
 *   negative tolerance term.
 */
export function matchBill(
  lines: MatchLine[],
  asOf: Date,
  tolerance: MatchTolerance = DEFAULT_MATCH_TOLERANCE
): MatchResult {
  assertTolerance(tolerance)
  const reasons = lines.flatMap((line, index) => matchBillLine(line, tolerance, index, asOf))
  if (reasons.length > 0) {
    return { outcome: 'exception', reasons, variance: matchVariance(lines, asOf, tolerance) }
  }

  const awaiting: AwaitingLine[] = []
  for (const [lineIndex, line] of lines.entries()) {
    if (!isAwaitingReceipt(line, tolerance, asOf)) continue
    awaiting.push({
      lineIndex,
      quantityBilled: line.quantityBilled,
      quantityReceived: line.quantityReceived,
      expectedAt: line.expectedAt ?? null,
    })
  }
  if (awaiting.length > 0) {
    return {
      outcome: 'awaiting_receipt',
      awaiting,
      variance: matchVariance(lines, asOf, tolerance),
    }
  }

  return { outcome: 'matched' }
}

/**
 * A date as `YYYY-MM-DD`, UTC.
 *
 * These strings are STORED on the record (`vendor_bill_match_notes`), so they get
 * the same treatment the money in them gets: no locale, no timezone, no symbol —
 * a format that cannot become wrong later because the reader's settings changed.
 */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/**
 * One reason, as a human reads it in the exception queue. Line numbers are
 * 1-based here and 0-based in `MatchReason.lineIndex` — the queue is read by
 * someone holding the paper invoice, where the first line is line 1.
 *
 * Money is rendered in MAJOR units and carries no currency symbol. The symbol is
 * still deliberately absent — this string is stored on the record, and a symbol
 * baked in at write time would be wrong the moment the bill's currency changes.
 * The scale is not: `10000` on screen is a number nobody reads as $100.00, so
 * the exponent comes from the bill's own `currencyCode` (2 for USD, 0 for JPY,
 * 3 for KWD) via the same `minorToMajorString` every other read path uses. A
 * bill's currency is a fact about that document and does not drift the way an
 * org default does, so pinning the scale at write time is safe in a way that
 * pinning the symbol is not.
 *
 * `price_variance` names the leg explicitly ("unit price"). It used to share the
 * `billed X against Y` shape with `quantity_under_billed`, which made a price
 * failure read as a quantity one on the very screen that exists to tell them
 * apart.
 */
export function describeMatchReason(reason: MatchReason, currencyCode = 'USD'): string {
  const line = reason.lineIndex + 1
  // `allowed` may be a fractional minor unit (2% of 12345), and `difference` is
  // signed — round once here so the string never shows a fraction of a cent.
  const money = (value: number) => minorToMajorString(Math.round(value), currencyCode)
  switch (reason.code) {
    case 'receipt_overdue':
      return `Line ${line}: billed ${reason.quantityBilled} but only ${reason.quantityReceived} received, more than ${reason.graceDays} days past the expected ${isoDate(reason.expectedAt)}`
    case 'quantity_under_billed':
      return `Line ${line}: billed ${reason.quantityBilled} against ${reason.quantityReceived} received`
    case 'price_variance':
      return `Line ${line}: unit price ${money(reason.unitPriceBilled)} billed against an agreed ${money(reason.unitPriceExpected)} (off by ${money(reason.difference)})`
  }
}

/**
 * Every reason on one line of prose, for `vendor_bill_match_notes`. Empty string
 * for a clean bill — the field is what the queue renders, and "no reasons" must
 * read as blank rather than as a sentence claiming success.
 *
 * `; ` is the separator the drawer's Match card splits on to render one reason
 * per row, so it is a shape contract and not just punctuation.
 */
export function describeMatchReasons(reasons: MatchReason[], currencyCode = 'USD'): string {
  return reasons.map((reason) => describeMatchReason(reason, currencyCode)).join('; ')
}

/**
 * One awaiting line, as a human reads it. Same 1-based line numbers and same
 * `; ` join as the reasons, because they land in the same stored field and the
 * Match card splits it the same way.
 *
 * It carries no money at all — an awaiting line's whole point is that its
 * quantity is not judgeable yet, so a figure here would be a claim the match is
 * explicitly declining to make. "Awaiting" plus the expected date is the whole
 * message; a line whose order carries no expected date says so, because
 * *that* is the fact a reader needs (nothing will ever age it).
 */
export function describeAwaitingLine(awaiting: AwaitingLine): string {
  const line = awaiting.lineIndex + 1
  const outstanding = awaiting.quantityBilled - awaiting.quantityReceived
  const when = awaiting.expectedAt
    ? `expected ${isoDate(awaiting.expectedAt)}`
    : 'no expected date on the order'
  return `Line ${line}: awaiting receipt of ${outstanding} of ${awaiting.quantityBilled} billed (${when})`
}

/** {@link describeAwaitingLine} across the bill. Empty string for none. */
export function describeAwaitingLines(awaiting: AwaitingLine[]): string {
  return awaiting.map(describeAwaitingLine).join('; ')
}
