// packages/lib/src/purchasing/landed-cost/types.ts

/**
 * What a shipment accrued for freight and duty, and what has been billed against
 * it since (73 §7.2 "what the link gives before item 11").
 *
 * PURE types. The UI reads them off the router; nothing here touches a database.
 */

/** One accrual account's three numbers. */
export interface LandedCostLeg {
  /** What the receipts credited this accrual, from the movements' own stamps. */
  accruedMinor: number
  /** What landed-cost lines coded to this accrual have billed against it. */
  billedMinor: number
  /** `accrued − billed`. Positive: still owed. Negative: billed over the estimate. */
  differenceMinor: number
}

/** The freight and duty picture for one goods bill, or for one vendor part. */
export interface LandedCostSummary {
  freight: LandedCostLeg
  duties: LandedCostLeg
  /**
   * Landed-cost lines coded to neither accrual account.
   *
   * Never netted into a leg: a line coded to a third account is a coding
   * question, and folding it into freight would answer it silently.
   */
  otherBilledMinor: number
  /** Receipt movements behind {@link LandedCostLeg.accruedMinor}. */
  receiptCount: number
  /** Landed-cost lines behind {@link LandedCostLeg.billedMinor}. */
  landedLineCount: number
}

/** {@link LandedCostSummary} for a vendor part, which spans several shipments. */
export interface VendorPartLandedCostSummary extends LandedCostSummary {
  /** Goods bills whose landed lines were apportioned to this part. */
  billCount: number
}

export const EMPTY_LANDED_COST_SUMMARY: LandedCostSummary = {
  freight: { accruedMinor: 0, billedMinor: 0, differenceMinor: 0 },
  duties: { accruedMinor: 0, billedMinor: 0, differenceMinor: 0 },
  otherBilledMinor: 0,
  receiptCount: 0,
  landedLineCount: 0,
}
