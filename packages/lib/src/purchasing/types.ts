// packages/lib/src/purchasing/types.ts

/**
 * Pure input/output shapes for the purchase-to-pay math
 * (plans/purchasing/01-build-plan.md sections 4.3 and 6, and
 * plans/products/11-costing-and-stock-improvements.md section 4).
 *
 * Every monetary amount in this module is an INTEGER in minor units (cents) —
 * the platform FieldType.CURRENCY storage convention that money/totals.ts also
 * uses. Nothing here touches the database, tRPC, or any server-only dependency:
 * these two calculations are the parts of purchasing that can be tested to
 * exhaustion, so they are deliberately kept free of anything that cannot.
 */

/**
 * What freight/tax/discount is spread in proportion to.
 *
 * The basis is a parameter, not a constant, and that is the one deliberate
 * improvement over the implementation this was modelled from (costing plan
 * section 4.2). Value-weighting alone means a $1 decal absorbs $9.99 of a
 * $10,000 freight bill while a $1,000 motor absorbs $9,990 — defensible
 * bookkeeping, but freight actually tracks mass, and a business shipping both
 * knows it. `value` stays the default at the call site; `quantity` and `weight`
 * exist for the businesses whose freight does not track invoice value.
 */
export type AllocationBasis = 'value' | 'quantity' | 'weight'

/** One purchase line participating in a landed-cost allocation. */
export interface AllocationLine {
  /** Extended buy price for the line (quantity x unit price), integer minor units. */
  lineTotal: number
  /** Units received on this line. Must be greater than zero — see `allocateLandedCost`. */
  quantity: number
  /**
   * Shipping weight for the whole line, in whatever unit the org uses
   * consistently (the allocation only ever uses ratios, never the absolute).
   * Absent is treated as zero, which is why an all-absent set falls back to an
   * equal split rather than dividing by zero.
   */
  weight?: number
}

/** The three header totals that get capitalised into the lines, plus the tax switch. */
export interface AllocationHeader {
  /** Freight charged on the purchase as a whole, integer minor units. */
  shipping: number
  /** Tax charged on the purchase as a whole, integer minor units. */
  tax: number
  /** Header-level discount, integer minor units. Subtracted from the capitalised amount. */
  discount: number
  /**
   * True when the buyer reclaims input tax, in which case tax is NOT capitalised
   * into inventory — it is a receivable from the tax authority, not part of what
   * the goods cost. The implementation this was modelled from capitalises tax
   * unconditionally with no switch anywhere in its settings, which is wrong for
   * anyone reclaiming input tax (costing plan section 4.2).
   */
  taxRecoverable: boolean
}

/** One bill line to check against what was received and what was agreed. */
export interface MatchLine {
  /** Units the vendor is billing for. */
  quantityBilled: number
  /** Units actually received against the purchase order. */
  quantityReceived: number
  /** Unit price on the bill, integer minor units. */
  unitPriceBilled: number
  /** Unit price agreed on the purchase order, integer minor units. */
  unitPriceExpected: number
}

/** How much drift the three-way match forgives before it raises an exception. */
export interface MatchTolerance {
  /** Percent of the expected unit price, e.g. `2` for 2%. */
  pricePercent: number
  /** Flat floor on the price allowance, integer minor units. */
  priceAbsolute: number
  /**
   * When true (the default), `quantityBilled` must equal `quantityReceived`.
   * When false, only over-billing raises an exception — a short bill against a
   * partial receipt is expected in that mode and left to the completeness check.
   */
  quantityExact: boolean
}

/**
 * Why a line failed, named the way a human would name it in the exception queue
 * (build plan section 6.3 — vendor, bill number, variance, and the reasons).
 * Discriminated on `code` so the UI renders one row shape per failure without a
 * string parse, and every reason carries the numbers it compared so the queue
 * can show billed / received / expected side by side.
 */
export type MatchReason =
  | {
      code: 'quantity_over_billed'
      lineIndex: number
      quantityBilled: number
      quantityReceived: number
    }
  | {
      code: 'quantity_under_billed'
      lineIndex: number
      quantityBilled: number
      quantityReceived: number
    }
  | {
      code: 'price_variance'
      lineIndex: number
      unitPriceBilled: number
      unitPriceExpected: number
      /** Signed billed minus expected, integer minor units. */
      difference: number
      /** The allowance this difference broke, integer minor units (may be fractional cents). */
      allowed: number
    }

/**
 * The bill-level verdict. `matched` carries nothing because there is nothing to
 * show; an exception carries every reason and the signed money at stake, which
 * are the two things the queue and the eventual GL entry both need.
 */
export type MatchResult =
  | { outcome: 'matched' }
  | { outcome: 'exception'; reasons: MatchReason[]; variance: number }
