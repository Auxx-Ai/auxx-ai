// packages/lib/src/relief/types.ts

/**
 * The part's ledger-derived average unit cost
 * (plans/money/tasks/50-batch-inventory-relief.md §3.3-§3.4) - the cost a
 * relief movement freezes onto itself instead of `part_standard_cost`, which
 * §3.1 shows drifts permanently whenever a standard-cost roll's revaluation
 * delta goes unposted (and it is never posted, by design).
 *
 * `valueMinor` and `quantity` are the signed sums a relief movement's cost is
 * derived from - `unitCostMinor` is just `valueMinor / quantity`, carried
 * alongside because a caller pricing a positive relief delta wants the ratio,
 * while a caller checking §4.2's "would this go negative" warning wants the
 * quantity on its own.
 */
export interface PartLedgerAverage {
  partInstanceId: string
  /** Signed sum of stock_movement_extended_cost, minor units. */
  valueMinor: number
  /** Signed sum of stock_movement_quantity. */
  quantity: number
  /**
   * `valueMinor / quantity`, rounded, or NULL when `quantity <= 0`.
   *
   * §3.6: a non-positive quantity has no average at all. The caller falls
   * back to `part_standard_cost` and warns naming the part - that fallback is
   * the CALLER's job, not this read's; it never guesses on this module's
   * behalf.
   */
  unitCostMinor: number | null
}

/**
 * What one fulfillment line has already been relieved at (§3.5) - the price a
 * negative relief delta (an un-relieving row, written when a fulfillment is
 * down-revised) must use instead of today's ledger average, so a quantity
 * correction can never make inventory value appear or disappear out of
 * nothing (§3.5's worked example: relieve 5 at $4,000, un-relieve 2 at
 * $4,200, and $400 appears from nowhere).
 */
export interface FulfillmentLineRelievedAverage {
  fulfillmentLineId: string
  /** POSITIVE count of units already relieved. */
  relievedQuantity: number
  /** POSITIVE value already relieved, minor units. */
  relievedValueMinor: number
  /** `relievedValueMinor / relievedQuantity`, rounded, or NULL when nothing relieved. */
  unitCostMinor: number | null
}
