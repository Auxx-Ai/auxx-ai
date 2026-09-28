// packages/lib/src/accounting/ledger/builders/split-tax-by-jurisdiction.ts

/**
 * Split a shipment's tax credit across jurisdictions and remitters, pro rata to
 * an order's own `tax_line` rows (brief 13 §5.3 - jurisdiction becomes a
 * `dimensions` entry on the line; plan 116 - a marketplace-remitted share credits
 * `marketplace_tax_collected`, never `sales_tax_payable`).
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

import { UnprocessableEntityError } from '../../../errors'

/** Who remits a tax line: the merchant, or a marketplace facilitator (`tax_line_channel_liable`). */
export type TaxRemitter = 'merchant' | 'marketplace'

/** One order's tax line, as `tax-line-fields.ts` stores it. */
export interface JurisdictionTaxLine {
  /** `tax_line_title` - the jurisdiction name, e.g. "CA State Tax". */
  title: string
  /** `tax_line_price`, integer minor units - this jurisdiction's share of the order's tax. */
  priceMinor: number
  /** Absent reads as `merchant`: only a `true` channel-liable flag is stored. */
  remitter?: TaxRemitter
}

/** One share of a shipment's tax, and the account family it credits. */
export interface TaxJurisdictionShare {
  /** Null when the lines did not tie and only the remitter split could be trusted. */
  jurisdiction: string | null
  amountMinor: number
  remitter: TaxRemitter
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
 * largest-remainder rounding so the shares sum EXACTLY to `taxMinor`, and keep
 * each share's remitter so marketplace tax never reaches `sales_tax_payable` (116 §0).
 *
 * The weights are the order's tax lines, whatever `taxMinor` itself is - a
 * partial shipment's own tax is still split in the ratio the whole order's
 * jurisdictions established, because a `tax_line` carries no per-shipment
 * granularity of its own. Lines sharing one jurisdiction and remitter are summed.
 *
 * Returns `null` (the caller's single undimensioned merchant line) when:
 *
 * - `taxMinor` is zero, or there are no titled tax lines;
 * - the lines do NOT sum to `orderTaxTotalMinor` and none is marketplace-remitted.
 *
 * 🛑 **The tie check is the load-bearing rule (brief 13 §5)**: a partial
 * jurisdiction breakdown reads as a complete one, so an untied order gets no
 * jurisdiction dimension. An untied order WITH marketplace lines still splits by
 * remitter alone (`jurisdiction: null`) - who owes the tax is not optional.
 *
 * @throws {UnprocessableEntityError} on a non-finite or fractional tax line
 *   price or order tax total.
 */
export function splitTaxByJurisdiction(input: {
  /** This shipment's (or this batch's) tax credit to split. */
  taxMinor: number
  /** The order's own tax lines - one row per jurisdiction. */
  taxLines: readonly JurisdictionTaxLine[]
  /** `order_tax_total`, integer minor units - what the tax lines must tie to. */
  orderTaxTotalMinor: number
}): TaxJurisdictionShare[] | null {
  const { taxMinor, taxLines } = input
  if (taxMinor === 0 || taxLines.length === 0) return null

  const orderTaxTotalMinor = wholeMinor(input.orderTaxTotalMinor, 'Order tax total')

  const byKey = new Map<string, { jurisdiction: string; remitter: TaxRemitter; weight: number }>()
  for (const [index, line] of taxLines.entries()) {
    const title = line.title?.trim()
    if (!title) continue
    const priceMinor = wholeMinor(line.priceMinor, `Tax line ${index + 1} (${title})`)
    const remitter = line.remitter ?? 'merchant'
    const key = `${remitter}\u0000${title}`
    const group = byKey.get(key)
    if (group) group.weight += priceMinor
    else byKey.set(key, { jurisdiction: title, remitter, weight: priceMinor })
  }
  if (byKey.size === 0) return null

  const groups = [...byKey.values()]
  const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0)
  if (totalWeight === orderTaxTotalMinor && totalWeight > 0) {
    const amounts = largestRemainder(
      taxMinor,
      groups.map((group) => group.weight)
    )
    return groups
      .map((group, index) => ({
        jurisdiction: group.jurisdiction,
        remitter: group.remitter,
        amountMinor: amounts[index] ?? 0,
      }))
      .filter((share) => share.amountMinor !== 0)
  }

  const marketplaceWeight = groups
    .filter((group) => group.remitter === 'marketplace')
    .reduce((sum, group) => sum + group.weight, 0)
  if (marketplaceWeight <= 0 || totalWeight <= 0) return null
  const [marketplaceMinor = 0, merchantMinor = 0] = largestRemainder(taxMinor, [
    marketplaceWeight,
    totalWeight - marketplaceWeight,
  ])
  return (
    [
      { jurisdiction: null, remitter: 'marketplace', amountMinor: marketplaceMinor },
      { jurisdiction: null, remitter: 'merchant', amountMinor: merchantMinor },
    ] satisfies TaxJurisdictionShare[]
  ).filter((share) => share.amountMinor !== 0)
}

/**
 * `total` split by `weights`, summing exactly. Remainder cents go to the largest fractional
 * remainders first, ties broken by position - the idea `computeShipmentTotals` uses.
 */
function largestRemainder(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  const exact = weights.map((weight) => (total * weight) / weightSum)
  const amounts = exact.map((value) => Math.floor(value))
  let remaining = total - amounts.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)
  for (const { index } of order) {
    if (remaining <= 0) break
    amounts[index] = (amounts[index] ?? 0) + 1
    remaining -= 1
  }
  return amounts
}
