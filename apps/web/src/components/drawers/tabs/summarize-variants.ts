// apps/web/src/components/drawers/tabs/summarize-variants.ts

/**
 * Aggregates for the product Variants tab's summary line
 * (plans/products/09-variant-ui.md §4.3).
 *
 * Pure on purpose: every clause here is a way to print a wrong number, and
 * each one is cheaper to pin down in a test than in a browser. The module owns
 * no reads — the tab resolves each row first (including which catalog item, if
 * any, supplies a price) and hands the result in.
 */

import { pluralize } from '@auxx/utils'

/** One variant row, already resolved by the tab. */
export interface VariantRow {
  /** EntityInstance id of the part. */
  id: string
  /** `part_quantity_on_hand`. `null` means no value, NOT zero. */
  quantityOnHand: number | null
  /**
   * Sell price in minor units, or `null` when this variant has none.
   *
   * `null` covers three different situations deliberately — no catalog item,
   * an inactive one, or more than one (price tiers, where picking one
   * arbitrarily would be a lie; §4.2 renders "n items" for that row instead).
   * None of them belong in a price range.
   */
  priceCents: number | null
  /** How many catalog items back this part — drives the row's "n items" case. */
  catalogItemCount: number
}

/** What {@link summarizeVariants} answers. */
export interface VariantSummary {
  /** The FAMILY size (`useRecordList().total`), not the loaded page length. */
  variantCount: number
  /** How many rows the aggregates below were actually computed from. */
  measuredCount: number
  /** Sum over rows that HAVE a value. `null` when none did — never `0`. */
  totalOnHand: number | null
  /** Spans only variants with a single active catalog item. `null` when none. */
  priceRange: { min: number; max: number } | null
  /** Variants carrying a usable price — the "3 of 4 priced" numerator. */
  pricedCount: number
  /** The aggregates describe a page, not the whole family. */
  isPartial: boolean
}

interface SummarizeVariantsOptions {
  /** `useRecordList().total` — the family size, which may exceed `rows.length`. */
  total?: number
  /** `useRecordList().hasNextPage` — rows exist beyond those loaded. */
  hasNextPage?: boolean
}

/**
 * Fold the loaded variant rows into the summary line's numbers.
 *
 * `total` defaults to the row count so a caller with no pagination in scope
 * (the product summary card) gets the obvious answer.
 */
export function summarizeVariants(
  rows: VariantRow[],
  options: SummarizeVariantsOptions = {}
): VariantSummary {
  const { total, hasNextPage = false } = options

  // An absent quantity is not a zero. Summing `?? 0` would report a family
  // whose stock has never been counted as holding none of itself.
  const onHandValues = rows
    .map((row) => row.quantityOnHand)
    .filter((value): value is number => value != null)
  const totalOnHand = onHandValues.length
    ? onHandValues.reduce((sum, value) => sum + value, 0)
    : null

  const prices = rows.map((row) => row.priceCents).filter((value): value is number => value != null)
  const priceRange = prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null

  return {
    variantCount: total ?? rows.length,
    measuredCount: rows.length,
    totalOnHand,
    priceRange,
    pricedCount: prices.length,
    isPartial: hasNextPage,
  }
}

/**
 * Render the summary as one line: `4 variants · 37 on hand · $199–$349`.
 *
 * `formatMoney` is injected rather than imported so this stays pure and the
 * currency layer stays the caller's concern — values are minor units, which is
 * what `formatCurrency` already expects everywhere else in this tab.
 *
 * A clause with nothing behind it is omitted rather than rendered as a zero or
 * a dash, and a partial page says so instead of implying a total it does not
 * have.
 */
export function buildVariantSummaryLabel(
  summary: VariantSummary,
  formatMoney: (minorUnits: number) => string
): string {
  const clauses: string[] = [
    `${summary.variantCount} ${pluralize(summary.variantCount, 'variant')}`,
  ]

  if (summary.totalOnHand != null) clauses.push(`${summary.totalOnHand} on hand`)

  if (summary.priceRange) {
    const { min, max } = summary.priceRange
    // One distinct price is one figure. `$199–$199` reads as a bug.
    clauses.push(min === max ? formatMoney(min) : `${formatMoney(min)}–${formatMoney(max)}`)
  }

  const line = clauses.join(' · ')
  // The aggregates came from the loaded page. Saying so is the difference
  // between a summary and a wrong number.
  return summary.isPartial ? `${line} (first ${summary.measuredCount})` : line
}
