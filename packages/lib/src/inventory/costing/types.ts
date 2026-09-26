// packages/lib/src/inventory/costing/types.ts

import type { PartKindValue, StandardCostSourceValue } from './client'

/**
 * One part's `part_labor_cost_per_unit` / `part_overhead_cost_per_unit`, per assembled unit.
 *
 * `null` is "none declared" and must never collapse to `0` — see {@link absorbedRate}.
 */
export interface AbsorptionRates {
  laborCostPerUnit: number | null
  overheadCostPerUnit: number | null
}

/**
 * The four numbers a roll freezes onto a part, all in whole minor units.
 *
 * The three components are split because it is load-bearing, not tidiness: the
 * fulfillment COGS entry has to land across 5000 Materials / 5010 Direct Labor /
 * 5020 Applied Overhead, and it can only do that if the finished good's standard
 * remembers its composition (Gap C section 6.1).
 */
export interface StandardCostComponents {
  /**
   * For a `component`: `round(part_cost)`, its landed purchase cost.
   * For a built part: the sum of its children's `standardCost` x quantity —
   * **not** `round(part_cost)`, which is a pure material chain and drops every
   * subassembly's own conversion cost on the way up (README B11).
   */
  standardMaterialCost: number
  /** `0` for a component; the declared rate for a built part; `null` when no rate is declared. */
  standardLaborCost: number | null
  /** Gated on `partKind` exactly as {@link standardLaborCost} is. */
  standardOverheadCost: number | null
  /** Material + labour + overhead. THE value every stock movement stamps. */
  standardCost: number
}

/** One part's frozen standard, as {@link readStandardCost} returns it. */
export interface PartStandardCost extends StandardCostComponents {
  partId: string
  /** When this standard took effect. `null` on a part whose roll predates the stamp. */
  effectiveAt: Date | null
}

/** Why a part could not be rolled. Never written, and never written as zero. */
export type SkipReason =
  /** A purchased part, or a buildable with no bill of materials, with no `part_cost` at all. */
  | 'no-live-cost'
  /**
   * A built part with at least one component that could not be valued.
   *
   * 🛑 This USED to abort the whole run with an `UnprocessableEntityError`, so
   * one unpriced screw blocked every other part in the org. It skips now, and
   * the skip CASCADES: a parent of a skipped part is itself unvaluable, so it
   * skips too, naming the same root cause rather than its own child. Whatever
   * standard the skipped part already carries is left exactly as it was - stale
   * is a state a person can see and fix, an understated number is not.
   */
  | 'component-not-valuable'
  /** A `service`: never stocked, so it carries no standard (107-D10). */
  | 'service'

/** One part the roll declined to value, with the reason a person can act on. */
export interface SkippedPart {
  partId: string
  reason: SkipReason
  /** `EntityInstance.displayName`, so a preview can name the part to go fix. */
  partName: string | null
  /**
   * For `component-not-valuable`: the descendant that actually has no price.
   *
   * The part named by {@link partName} is only the one the roll gave up on -
   * pricing it is not the remedy and never was. This is the part to go price,
   * carried up unchanged through every level of the cascade so a finished good
   * blames the screw and not the sub-assembly.
   */
  blockedByPartName?: string | null
}

/** One part the roll will write, with the balance-sheet effect of writing it. */
export interface StandardCostRollLine extends StandardCostComponents {
  partId: string
  /** `EntityInstance.displayName`. The preview lists parts, not ids. */
  partName: string | null
  /** Resolved, never raw: a NULL `part_kind` appears here as `component`. */
  partKind: PartKindValue
  /** The standard this part carried before the roll. `null` = never rolled. */
  previousStandardCost: number | null
  /** `part_standard_cost_source` as stored. `null` = rolled before the field existed. */
  previousStandardCostSource: StandardCostSourceValue | null
  /** What the roll will stamp: `confirmed` only when every child already is (73 §6.4). */
  standardCostSource: StandardCostSourceValue | null
  /** `part_quantity_on_hand`, or 0 when the part has never been counted. */
  quantityOnHand: number
  /**
   * `(newStandard - previousStandardCost) x quantityOnHand`, in minor units.
   *
   * **Zero when there is no previous standard** — see {@link isInitial}. A first
   * roll is not a revaluation of anything.
   */
  revaluationDelta: number
  /**
   * This part had no standard before, so the roll VALUES its on-hand stock for
   * the first time rather than revaluing it.
   *
   * Kept separate because folding it into {@link revaluationDelta} would report
   * the entire on-hand inventory value as a variance on the very first roll,
   * which is both alarming and wrong.
   */
  isInitial: boolean
  /** `newStandard x quantityOnHand`. Only meaningful when {@link isInitial}. */
  initialValue: number
  /** `false` when every component and the effective date already match — nothing is written. */
  changed: boolean
}

/**
 * What a roll WOULD do. Returned by the preview and, extended, by the roll.
 *
 * 🛑 The preview is the point (section 2.4): a roll restates the balance sheet,
 * so it must never be a button that just fires.
 */
export interface StandardCostRollPlan {
  /** The date the new standards take effect. Stamped onto every changed part. */
  effectiveAt: Date
  /** Every part in the write scope after ancestor widening, in bottom-up order. */
  lines: StandardCostRollLine[]
  /** Sum of {@link StandardCostRollLine.revaluationDelta} over the non-initial lines. */
  revaluationDelta: number
  /** Sum of {@link StandardCostRollLine.initialValue} over the initial lines. */
  initialValue: number
  /** Parts in scope that cannot be valued at all. */
  skipped: SkippedPart[]
  /** ORG-WIDE, not scope-wide: parts carrying a usable standard at all. */
  standardCount: number
  /** Of {@link standardCount}, how many came off a receipt (73 §6.4). */
  confirmedStandardCount: number
  /** `manual`-origin parts left out of the roll because nobody named them (D-SC3). */
  keptManual: KeptManualPart[]
  /** On-hand units across the changed, non-initial lines whose standard moves. */
  revaluedQuantity: number
  /** The day range {@link effectiveAt} must fall in (D-SC5). */
  dateRange: RollDateRange
}

/** A `manual` standard the roll left alone; its ancestors roll from {@link standardCost}. */
export interface KeptManualPart {
  partId: string
  partName: string | null
  standardCost: number
}

/** Where a roll may be dated: from the latest movement of a part it revalues, up to now. */
export interface RollDateRange {
  /** Book-zone day of {@link StandardCostRollPlan.effectiveAt}, e.g. for "Posts Sep 30". */
  effectiveDay: string
  /** Start of the earliest allowed book day; `null` when the roll revalues nothing. */
  earliestAt: Date | null
  earliestDay: string | null
  /** The revalued part whose latest movement sets {@link earliestAt}. */
  earliestSetBy: { partId: string; partName: string | null; movedAt: Date } | null
  /** Now: a roll is never dated in the future. */
  latestAt: Date
}

/** What a roll DID. */
export interface StandardCostRollResult extends StandardCostRollPlan {
  /** The parts whose field values were actually written. */
  writtenPartIds: string[]
  /**
   * The `revalue` movements the roll posted for its revaluation delta, and the
   * signed amount that reached `inventory_revaluation` (73 §6.2 rule 2).
   */
  revaluationMovementIds: string[]
  revaluationPostedMinor: number
}

/** Input to {@link rollStandardCost} and {@link previewStandardCostRoll}. */
export interface RollStandardCostInput {
  /**
   * Restrict the roll to these parts, **every ancestor of them, and every
   * descendant that has no stored standard yet**.
   *
   * Omitted (or empty) rolls every non-archived part in the org.
   *
   * 🛑 The descendant half is ASYMMETRIC and the asymmetry is the point
   * (plans/money/tasks/15-costing-usability.md §3):
   *
   * - A descendant that **already has** a standard is left alone and contributes
   *   its stored value. Rolling a finished good values it at its subassemblies'
   *   already-agreed standards, which is what a standard cost roll is for, and
   *   re-valuing them is not something the caller asked for.
   * - A descendant with **no** standard is pulled in, because it has nothing to
   *   re-value and because leaving it out is what used to make this throw on
   *   every built part in a fresh org: it would contribute a NULL stored standard
   *   and abort the parent rather than value it short.
   *
   * A `manual`-origin standard is rolled only when named here (D-SC3).
   */
  partIds?: string[]
  /** When the new standards take effect; the roll refuses one outside the plan's `dateRange`. */
  effectiveAt: Date
}

/**
 * The part's ledger-derived average unit cost
 * (plans/money/tasks/50-batch-inventory-relief.md §3.3-§3.4).
 *
 * ⚠️ **A report since 73 §6.2 rule 3, not a relief basis.** It priced relief
 * only because a roll's revaluation delta went unposted; rule 2 posts it, and
 * relief is back at `part_standard_cost`. `quantity` is still read live by
 * `relieve.ts` for §4.2's "would this go negative" warning.
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
   * §3.6: a non-positive quantity has no average at all - reported as an
   * absence rather than guessed at on a caller's behalf.
   */
  unitCostMinor: number | null
}

/**
 * What one fulfillment line has already been relieved at (§3.5) - the price a
 * negative relief delta (an un-relieving row, written when a fulfillment is
 * down-revised) must use instead of today's standard, so a quantity
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
