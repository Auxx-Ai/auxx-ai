// packages/lib/src/builds/types.ts

/**
 * Shapes the standard-cost roll reads and returns.
 *
 * plans/products/build/01-build-plan.md sections 2.2 and 2.2a.
 */

import type { PartKindValue } from './client'

/**
 * The two `manufacturing.*` org settings, per assembled unit, in minor units.
 *
 * Both are `number | null` and the `null` is load-bearing — see
 * {@link absorbedRate}. They ship unset, and a roll run before they are filled
 * in stores NULL components rather than a confident zero.
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
  /** A `component` (or an unclassified part) with no `part_cost` at all. */
  | 'no-live-cost'
  /** A `subassembly` / `finished_good` with no bill of materials to roll. */
  | 'no-bill-of-materials'

/** One part the roll declined to value, with the reason a person can act on. */
export interface SkippedPart {
  partId: string
  reason: SkipReason
  /** `EntityInstance.displayName`, so a preview can name the part to go fix. */
  partName: string | null
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
  /** The rates in force. A `null` here is visible as "no absorption declared". */
  rates: AbsorptionRates
  /** Every part in the write scope after ancestor widening, in bottom-up order. */
  lines: StandardCostRollLine[]
  /** Sum of {@link StandardCostRollLine.revaluationDelta} over the non-initial lines. */
  revaluationDelta: number
  /** Sum of {@link StandardCostRollLine.initialValue} over the initial lines. */
  initialValue: number
  /** Parts in scope that cannot be valued at all. */
  skipped: SkippedPart[]
}

/** What a roll DID. */
export interface StandardCostRollResult extends StandardCostRollPlan {
  /** The parts whose field values were actually written. */
  writtenPartIds: string[]
}

/** Input to {@link rollStandardCost} and {@link previewStandardCostRoll}. */
export interface RollStandardCostInput {
  /**
   * Restrict the roll to these parts **and every ancestor of them**.
   *
   * Omitted (or empty) rolls every non-archived part in the org. Descendants are
   * deliberately NOT pulled in: rolling a finished good values it at its
   * subassemblies' already-agreed standards, which is what a standard cost roll
   * is for.
   */
  partIds?: string[]
  /** When the new standards take effect. */
  effectiveAt: Date
}
