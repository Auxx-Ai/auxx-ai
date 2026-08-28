// packages/lib/src/builds/types.ts

/**
 * Shapes the standard-cost roll reads and returns.
 *
 * plans/products/build/01-build-plan.md sections 2.2 and 2.2a.
 */

import type { BuildStatusValue, PartKindValue } from './client'

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

// ─── The build event (phase 2) ─────────────────────────────────────────
//
// plans/products/build/01-build-plan.md section 3. Every money value below is
// an INTEGER in whole minor units (cents), the platform `FieldType.CURRENCY`
// convention.

/**
 * One `build` row as the read path returns it.
 *
 * Deliberately flat and fully resolved: a caller rendering a list must never
 * have to issue a second read per row to learn what a build cost.
 */
export interface BuildRecord {
  /** `EntityInstance.id` of the `build`. */
  buildId: string
  /** `<entityDefinitionId>:<instanceId>`, ready for a drawer or a picker. */
  recordId: string
  /** `B-0001`. `null` until a numbering hook exists — see the module README note. */
  number: string | null
  /** `EntityInstance.id` of the `part` this run produces. */
  partId: string | null
  /** `null` on a row whose status value is missing — see {@link resolveBuildStatus}. */
  status: BuildStatusValue | null
  quantityPlanned: number | null
  /** Good units that entered stock. Negative on a reversing build. */
  quantityProduced: number | null
  /** Units started and lost (B7). Negative on a reversing build. */
  quantityScrapped: number | null
  startedAt: Date | null
  /** THE accounting date. Every movement this build wrote carries it. */
  completedAt: Date | null
  materialCost: number | null
  laborCost: number | null
  overheadCost: number | null
  producedValue: number | null
  varianceAmount: number | null
  /**
   * Denormalized convenience only (section 1.1) — the GL posting ledger is the
   * authority once it exists, and nothing gates a write on this.
   */
  postedAt: Date | null
  notes: string | null
  orderId: string | null
  /** `manual` or `order`. `null` on a row written before the field existed. */
  source: string | null
  /** Set on a REVERSING build: the build it undoes (B6). */
  reversalOfBuildId: string | null
  createdAt: Date
}

/** Raise a run. Always lands `planned`, and writes no movements (B2). */
export interface CreateBuildInput {
  /** `EntityInstance.id` of the `part` to produce. */
  partId: string
  /** Units this run intends to produce. Must be greater than zero. */
  quantityPlanned: number
  notes?: string
  /** `EntityInstance.id` of the `order` that caused this run, if any. */
  orderId?: string
  /**
   * `manual` (a person raised it) or `order` (the auto-build trigger did).
   * Defaults to `manual` — an auto-build must be distinguishable from one a
   * person raised against the same order deliberately (products/12 AB7).
   */
  source?: 'manual' | 'order'
}

/** Move a `planned` run to `in_progress`. */
export interface StartBuildInput {
  buildId: string
  /** Defaults to now. */
  startedAt?: Date
}

/** Abandon a run that has not been completed. Writes no movements. */
export interface CancelBuildInput {
  buildId: string
  /** Free text, appended to the build's notes. */
  reason?: string
}

/**
 * A per-component quantity the floor actually used, overriding the BOM.
 *
 * A part that IS on the bill of materials keeps its `qtyPerUnit` snapshot — the
 * BOM was followed, just not to the letter. A part that is NOT on it is an
 * off-BOM substitution and its movement carries `qtyPerUnit: null`, which is
 * the marker `stock_movement_qty_per_unit` exists to make visible instead of
 * silent.
 */
export interface BuildComponentOverride {
  /** `EntityInstance.id` of the `part` consumed. */
  partId: string
  /** Units consumed by the WHOLE run, not per produced unit. Zero drops the line. */
  quantityConsumed: number
}

/** Finish a run and write the ledger. The only input that produces movements. */
export interface CompleteBuildInput {
  buildId: string
  /** Good units that entered stock. Must be greater than zero. */
  quantityProduced: number
  /** Units started and lost (B7). Defaults to zero; never negative. */
  quantityScrapped?: number
  /**
   * Absorbed direct labour for the WHOLE run, minor units.
   *
   * Omitted, it is `round(manufacturing.assemblyLaborCostPerUnit x unitsStarted)`
   * — the units STARTED, because labour was spent on the scrapped ones too, and
   * because that is what makes the variance come out at exactly the scrapped
   * units' standard cost. An undeclared rate absorbs zero.
   */
  laborCost?: number
  /** Applied overhead for the whole run, minor units. Same defaulting rule. */
  overheadCost?: number
  /** What the floor actually consumed, where it differs from the BOM. */
  componentOverrides?: BuildComponentOverride[]
  /** THE accounting date stamped on the build and every movement. Defaults to now. */
  completedAt?: Date
  /** Free text, appended to the build's notes. */
  notes?: string
}

/** One component line, as {@link explodeBuildComponents} previews it. */
export interface BuildComponentLine {
  partId: string
  /** `EntityInstance.displayName`, so a form can name the part to go fix. */
  partName: string | null
  /**
   * The per-unit quantity in force at build time — the as-built BOM snapshot.
   * `null` means the component is OFF-BOM: a floor substitution.
   */
  qtyPerUnit: number | null
  /** Units consumed by the whole run. */
  quantityConsumed: number
  /** The component's frozen `part_standard_cost`. `null` = never rolled. */
  unitCost: number | null
  /** `round(unitCost x quantityConsumed)`, POSITIVE. The movement stores its negation. */
  extendedCost: number | null
  /** Resolved from the component's `part_kind`, exactly as a receipt resolves it. */
  glAccount: string
  /** True when this line came from an override for a part with no BOM edge. */
  offBom: boolean
}

/** What a completion WOULD consume, and what it cannot value. */
export interface BuildComponentPlan {
  /** The part being produced. */
  partId: string
  quantityProduced: number
  quantityScrapped: number
  /** `quantityProduced + quantityScrapped` — what consumes material (B7). */
  unitsStarted: number
  /**
   * The produced part's frozen `part_standard_cost`, the value the
   * `build_produce` row stamps. `null` when the part has never been rolled — in
   * which case its id is also in {@link missingStandardPartIds}.
   */
  producedUnitCost: number | null
  components: BuildComponentLine[]
  /**
   * Components with no `part_standard_cost`, and the produced part when IT has
   * none. **A completion with any entry here is refused** — never posted at
   * zero.
   */
  missingStandardPartIds: string[]
}

/** What a completion DID. Enough to render the result without a second read. */
export interface CompleteBuildResult {
  buildId: string
  recordId: string
  quantityProduced: number
  quantityScrapped: number
  /** Sum of the consumed lines' extended standard cost, positive. */
  materialCost: number
  laborCost: number
  overheadCost: number
  /** `round(quantityProduced x the produced part's standard cost)`. */
  producedValue: number
  /** `(material + labour + overhead) - producedValue` -> account 5090. */
  varianceAmount: number
  /** Every `stock_movement` written, consumes first then the single produce. */
  movementIds: string[]
  /** The parts whose quantity on hand was recalculated AFTER the commit. */
  recalculatedPartIds: string[]
}

/** Undo a completed build by writing its negation (B6). */
export interface ReverseBuildInput {
  buildId: string
  /** Free text stamped on the reversing build only. The original is never touched. */
  reason?: string
  /** The reversal's accounting date. Defaults to now. */
  occurredAt?: Date
}

/** What a reversal DID. */
export interface ReverseBuildResult {
  /** The NEW build. */
  buildId: string
  recordId: string
  /** The build it undoes. */
  reversalOfBuildId: string
  movementIds: string[]
  recalculatedPartIds: string[]
}

/** Narrowing options for the build read path. */
export interface ListBuildsFilters {
  status?: BuildStatusValue
  /** Only runs producing this `part` instance. */
  partId?: string
  /** Only runs raised against this `order` instance. */
  orderId?: string
  source?: 'manual' | 'order'
  /** Defaults to 50. */
  limit?: number
  offset?: number
}

/** One `stock_movement` a build wrote, as the reversal reads it back. */
export interface BuildMovementRow {
  movementId: string
  partId: string
  /** `build_consume` or `build_produce`. Carried verbatim onto the negation. */
  type: string
  quantity: number
  /** The ORIGINAL's frozen unit cost. Never re-priced (B6). */
  unitCost: number
  extendedCost: number | null
  glAccount: string | null
  /** The as-built snapshot; `null` on an off-BOM row and on the produce row. */
  qtyPerUnit: number | null
  /** `standard` on every row a build writes. Copied, never re-decided. */
  costBasis: string | null
}
