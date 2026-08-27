// packages/lib/src/purchasing/match.ts

import { BadRequestError } from '../errors'
import { roundCents } from '../money/totals'
import type { MatchLine, MatchReason, MatchResult, MatchTolerance } from './types'

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
 */

/**
 * 2% or $5, whichever is larger, and quantities must be exact.
 *
 * The absolute floor matters more than the percent on a small line: 2% of a
 * $3 part is 6 cents, which every vendor's rounding breaks. The percent matters
 * more on a large one. Taking the maximum means neither term has to be wrong to
 * keep the other useful. If the exception queue is usually empty these numbers
 * are right; if it is never empty they are wrong, and that is a settings row,
 * not a code change (build plan section 6.3).
 */
export const DEFAULT_MATCH_TOLERANCE: MatchTolerance = {
  pricePercent: 2,
  priceAbsolute: 500,
  quantityExact: true,
}

function assertQuantity(value: number, label: string, index: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestError(`Line ${index} ${label} must be a non-negative number`)
  }
}

function assertPrice(value: number, label: string, index: number): void {
  // Negative unit prices are allowed: a credit line on a vendor bill is a real
  // thing. Non-integers are not — money is minor units everywhere in this module.
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new BadRequestError(`Line ${index} ${label} must be an integer amount in minor units`)
  }
}

function assertTolerance(tolerance: MatchTolerance): void {
  if (!Number.isFinite(tolerance.pricePercent) || tolerance.pricePercent < 0) {
    throw new BadRequestError('Tolerance pricePercent must be a non-negative number')
  }
  if (!Number.isFinite(tolerance.priceAbsolute) || tolerance.priceAbsolute < 0) {
    throw new BadRequestError('Tolerance priceAbsolute must be a non-negative number')
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
 * Every reason one bill line fails, in check order. An empty array is a clean
 * line.
 *
 * Quantity: `quantityBilled > quantityReceived` is ALWAYS an exception
 * regardless of `quantityExact` — that is the "paying for what never arrived"
 * case and it is the reason the match exists. `quantityBilled <
 * quantityReceived` is an exception only under `quantityExact`, because a
 * vendor billing in instalments against one receipt is normal in the loose mode
 * and is caught by the completeness check instead.
 *
 * Price is checked on every line, including zero-quantity ones: a unit price
 * nobody agreed is worth naming even when this particular line moves no money,
 * because it is usually the first line of a repricing the vendor did not
 * announce.
 *
 * @throws BadRequestError on a negative quantity or a non-integer price.
 */
export function matchBillLine(
  line: MatchLine,
  tolerance: MatchTolerance,
  lineIndex: number
): MatchReason[] {
  assertQuantity(line.quantityBilled, 'quantityBilled', lineIndex)
  assertQuantity(line.quantityReceived, 'quantityReceived', lineIndex)
  assertPrice(line.unitPriceBilled, 'unitPriceBilled', lineIndex)
  assertPrice(line.unitPriceExpected, 'unitPriceExpected', lineIndex)

  const reasons: MatchReason[] = []

  if (line.quantityBilled > line.quantityReceived) {
    reasons.push({
      code: 'quantity_over_billed',
      lineIndex,
      quantityBilled: line.quantityBilled,
      quantityReceived: line.quantityReceived,
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
 * Expected is deliberately `quantityReceived x unitPriceExpected`, not
 * `quantityBilled x unitPriceExpected` — otherwise an over-billed quantity nets
 * out of the variance entirely and the one number the exception queue shows
 * would hide the exact failure the match exists to catch. Positive means the
 * bill is asking for more than the receipt justifies.
 */
export function matchVariance(lines: MatchLine[]): number {
  return lines.reduce((total, line) => {
    const billed = roundCents(line.quantityBilled * line.unitPriceBilled)
    const expected = roundCents(line.quantityReceived * line.unitPriceExpected)
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
 * @throws BadRequestError on a negative quantity, a non-integer price, or a
 *   negative tolerance term.
 */
export function matchBill(
  lines: MatchLine[],
  tolerance: MatchTolerance = DEFAULT_MATCH_TOLERANCE
): MatchResult {
  assertTolerance(tolerance)
  const reasons = lines.flatMap((line, index) => matchBillLine(line, tolerance, index))
  if (reasons.length === 0) return { outcome: 'matched' }
  return { outcome: 'exception', reasons, variance: matchVariance(lines) }
}

/**
 * One reason, as a human reads it in the exception queue. Line numbers are
 * 1-based here and 0-based in `MatchReason.lineIndex` — the queue is read by
 * someone holding the paper invoice, where the first line is line 1.
 *
 * Money is rendered in whole minor units rather than formatted, because this
 * string is stored on the record and a currency symbol baked in at write time
 * would be wrong the moment the org's currency changes.
 */
export function describeMatchReason(reason: MatchReason): string {
  const line = reason.lineIndex + 1
  switch (reason.code) {
    case 'quantity_over_billed':
      return `Line ${line}: billed ${reason.quantityBilled} but only ${reason.quantityReceived} received`
    case 'quantity_under_billed':
      return `Line ${line}: billed ${reason.quantityBilled} against ${reason.quantityReceived} received`
    case 'price_variance':
      return `Line ${line}: billed ${reason.unitPriceBilled} against an agreed ${reason.unitPriceExpected} (off by ${reason.difference})`
  }
}

/**
 * Every reason on one line of prose, for `vendor_bill_match_notes`. Empty string
 * for a clean bill — the field is what the queue renders, and "no reasons" must
 * read as blank rather than as a sentence claiming success.
 */
export function describeMatchReasons(reasons: MatchReason[]): string {
  return reasons.map(describeMatchReason).join('; ')
}
