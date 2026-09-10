// packages/lib/src/postings/split-tax-by-jurisdiction.ts

/**
 * Split a `sales_tax_payable` credit across jurisdictions, pro rata to an
 * order's own `tax_line` rows (brief 13 §5.3 - jurisdiction becomes a
 * `dimensions` entry on the line, sourced from `tax_line` rather than a
 * second role).
 *
 * PURE. No database, no clock, no chart - the same property every builder in
 * `postings/` has, which is what lets the largest-remainder rounding below be
 * tested exhaustively.
 *
 * 🛑 **Does NOT import from `build-fulfillment-entry.ts` or
 * `build-fulfillment-batch-entry.ts`.** Both of those import THIS file, and a
 * cycle back would be silent until a bundler or a test runner tripped over it.
 * The whole-cents assertion below is therefore a small, deliberate duplicate of
 * `toAmountMinor` rather than a shared import.
 */

import { UnprocessableEntityError } from '../errors'

/** One order's tax line, as `tax-line-fields.ts` stores it. */
export interface JurisdictionTaxLine {
  /** `tax_line_title` - the jurisdiction name, e.g. "CA State Tax". */
  title: string
  /** `tax_line_price`, integer minor units - this jurisdiction's share of the order's tax. */
  priceMinor: number
}

/** One jurisdiction's share of a `sales_tax_payable` credit. */
export interface TaxJurisdictionShare {
  jurisdiction: string
  amountMinor: number
}

/**
 * A stored money amount, asserted to be whole minor units.
 *
 * Deliberately a small local copy of `toAmountMinor` (`build-fulfillment-entry.ts`)
 * rather than an import from it - that file imports THIS one for the split, and
 * an import back would be a cycle.
 */
function wholeMinor(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new UnprocessableEntityError(`${label} is ${String(value)}, which is not a number`, {
      label,
      value: String(value),
    })
  }
  const rounded = Math.round(value)
  if (Math.abs(value - rounded) > 1e-6) {
    throw new UnprocessableEntityError(
      `${label} is ${value}, which is not a whole number of cents. A ledger line is whole cents.`,
      { label, value: String(value) }
    )
  }
  return rounded
}

/**
 * Split `taxMinor` across the jurisdictions named on `taxLines`, using
 * largest-remainder rounding so the shares sum EXACTLY to `taxMinor`.
 *
 * The weights are the order's tax lines, whatever `taxMinor` itself is - a
 * partial shipment's own tax is still split in the ratio the whole order's
 * jurisdictions established, because a `tax_line` carries no per-shipment
 * granularity of its own. Multiple lines sharing one jurisdiction (unusual, but
 * not forbidden by the registry) are summed before the split.
 *
 * Returns `null`, never throws, when the breakdown cannot be trusted:
 *
 * - `taxMinor` is zero (nothing to split),
 * - there are no tax lines, or every title is blank,
 * - the tax lines do NOT sum to the order's own `orderTaxTotalMinor`.
 *
 * 🛑 **The tie check is the load-bearing rule (brief 13 §5).** An order whose
 * tax lines do not sum to its own total gets today's single undimensioned
 * line, on purpose: a partial jurisdiction breakdown reads as a complete one,
 * and a bookkeeper reading the P&L by jurisdiction has no way to tell the
 * difference from a line that is simply short.
 *
 * @throws {UnprocessableEntityError} on a non-finite or fractional tax line
 *   price or order tax total - the same refusal `toAmountMinor` gives every
 *   other stored amount that turns out not to be whole cents.
 */
export function splitTaxByJurisdiction(input: {
  /** This shipment's (or this batch's) `sales_tax_payable` credit to split. */
  taxMinor: number
  /** The order's own tax lines - one row per jurisdiction. */
  taxLines: readonly JurisdictionTaxLine[]
  /** `order_tax_total`, integer minor units - what the tax lines must tie to. */
  orderTaxTotalMinor: number
}): TaxJurisdictionShare[] | null {
  const { taxMinor, taxLines } = input
  if (taxMinor === 0 || taxLines.length === 0) return null

  const orderTaxTotalMinor = wholeMinor(input.orderTaxTotalMinor, 'Order tax total')

  const byTitle = new Map<string, number>()
  for (const [index, line] of taxLines.entries()) {
    const title = line.title?.trim()
    if (!title) continue
    const priceMinor = wholeMinor(line.priceMinor, `Tax line ${index + 1} (${title})`)
    byTitle.set(title, (byTitle.get(title) ?? 0) + priceMinor)
  }
  if (byTitle.size === 0) return null

  const totalWeight = [...byTitle.values()].reduce((sum, value) => sum + value, 0)
  // A partial or mismatched breakdown reads as a complete one - see the file
  // header - so anything that does not tie falls back to the single line
  // rather than guessing at a split.
  if (totalWeight !== orderTaxTotalMinor || totalWeight <= 0) return null

  interface Share {
    jurisdiction: string
    amountMinor: number
    remainder: number
  }
  const shares: Share[] = [...byTitle.entries()].map(([jurisdiction, weight]) => {
    const exact = (taxMinor * weight) / totalWeight
    const floor = Math.floor(exact)
    return { jurisdiction, amountMinor: floor, remainder: exact - floor }
  })

  // The remainder cents go to the largest fractional remainders first, ties
  // broken by the order the jurisdictions were first seen in - deterministic,
  // and the same idea `computeShipmentTotals` uses for the tax allocation.
  let remaining = taxMinor - shares.reduce((sum, share) => sum + share.amountMinor, 0)
  const byRemainderDesc = [...shares].sort((a, b) => b.remainder - a.remainder)
  for (const share of byRemainderDesc) {
    if (remaining <= 0) break
    share.amountMinor += 1
    remaining -= 1
  }

  return shares
    .filter((share) => share.amountMinor !== 0)
    .map((share) => ({ jurisdiction: share.jurisdiction, amountMinor: share.amountMinor }))
}
