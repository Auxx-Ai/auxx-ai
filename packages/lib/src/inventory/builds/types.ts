// packages/lib/src/inventory/builds/types.ts

import type { BuildSourceValue } from '@auxx/database/enums'
import type { BuildStatusValue } from './client'

export type { BuildSourceValue }

// ─── The build event (phase 2) ─────────────────────────────────────────
//
// plans/products/build/01-build-plan.md section 3. Every money value below is
// in minor units (cents); see plans/mrp/23-build-table.md for the `Build` table.

/** One `Build` row as the read path returns it: the table's columns, with `id` as `buildId`. */
export interface BuildRecord {
  buildId: string
  /** `B-0001`. */
  number: string
  /** `EntityInstance.id` of the `part` this run produces. */
  partId: string
  status: BuildStatusValue
  source: BuildSourceValue
  /** `null` on a reversing build, which plans nothing. */
  quantityPlanned: number | null
  /** Good units that entered stock. Negative on a reversing build. */
  quantityProduced: number | null
  /** Units started and lost (B7). Negative on a reversing build. */
  quantityScrapped: number | null
  startedAt: Date | null
  /** THE accounting date. Every movement this build wrote carries it. */
  completedAt: Date | null
  /** `null` until priced. */
  materialCost: number | null
  laborCost: number | null
  overheadCost: number | null
  producedValue: number | null
  varianceAmount: number | null
  /** Denormalized convenience only; the GL posting is the authority. */
  postedAt: Date | null
  notes: string | null
  orderId: string | null
  /** Set on a REVERSING build: the build it undoes (B6). At most one per original (unique index). */
  reversalOfBuildId: string | null
  /** The order's demand fingerprint when an order-raised build was raised; `null` means unknown. */
  orderRevision: string | null
  /** The demand period a `batch` build claims, half-open. */
  periodStart: Date | null
  periodEnd: Date | null
  /** The batch or backflush run that raised this build (plans/money/tasks/45 §3), else `null`. */
  batchRun: number | null
  createdAt: Date
  updatedAt: Date
  createdById: string | null
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
   * `manual` (a person raised it), `order` (the auto-build trigger did),
   * `batch` (the backfill raised it for a whole demand period) or `backflush`
   * (the replay built what a day's sales drove negative, 111 D23).
   * Defaults to `manual` — an auto-build must be distinguishable from one a
   * person raised against the same order deliberately (products/12 AB7).
   *
   * 🛑 `batch` is not a label, it is the mechanism: `reconcile-policy.ts` skips
   * any build whose source is not `order`, so a batch build is invisible to
   * Model B convergence — and, by the mirror rule at its line 227, is not
   * coverage to the reconciler either. That is why a batch build is only safe
   * below the auto-build cutoff (plans/money/tasks/44 §6.1).
   */
  source?: BuildSourceValue
  /**
   * The order's demand fingerprint to stamp on the new build, when the caller
   * already has it.
   *
   * Purely an optimisation, and the ONLY thing it changes is a read: omitted,
   * `createBuild` derives the same value by re-running `loadAutoBuildOrders` for
   * this one order. The convergence pass computed it before deciding to raise
   * anything at all (`reconcile-order-builds.ts`), so handing it over spares a
   * four-query round trip per build.
   *
   * Ignored unless `source` is `order` — a hand-raised build never carries a
   * stamp, because it is not tracking anything (products/12 AB7).
   */
  orderRevision?: string
  /**
   * The DEMAND period a `batch` build claims. Half-open: `start` inclusive,
   * `end` exclusive. Written at create or never: moving a claimed period restates
   * what the next netting run believes is covered (plans/money/tasks/44 §6.2).
   * Not when the build happened; `completedAt` is the accounting date.
   * Ignored unless `source` is `batch`.
   */
  period?: { start: Date; end: Date }
  /**
   * The batch run raising this build (plans/money/tasks/45 §3). Allocated ONCE per
   * run from the `build_batch` sequence and passed down. Written at create or never,
   * and ignored unless `source` is `batch` or `backflush`.
   */
  batchRun?: number
}

/**
 * One build's outcome inside {@link UndoBatchRunSummary}.
 *
 * `cancelled` and `reversed` are the two ways a build is undone; `skipped` is a
 * build that was ALREADY undone and needs nothing, which is deliberately not a
 * failure (45 §10.8).
 */
export interface UndoBatchRunEntry {
  buildId: string
  partId: string
  outcome: 'cancelled' | 'reversed' | 'skipped' | 'failed'
  /** Why it was skipped or how it failed. `null` on a build that was undone. */
  reason: string | null
  /** The reversing build, on `reversed` only. */
  reversalBuildId?: string
}

/**
 * What {@link undoBatchRun} did, per build.
 *
 * ⚠️ **Never an error channel.** Per-build isolation, the same discipline
 * `executeBackfill` keeps: one refused reversal must not lose the rest of the
 * run, and a caller that ignores a `failed` entry is behaving correctly.
 */
export interface UndoBatchRunSummary {
  runNumber: number
  /** Every build carrying this run number, before anything was done to it. */
  total: number
  cancelled: UndoBatchRunEntry[]
  reversed: UndoBatchRunEntry[]
  skipped: UndoBatchRunEntry[]
  failed: UndoBatchRunEntry[]
}

/**
 * What one batch run looks like from outside, for the drawer card and the undo
 * preview (45 §11.3).
 *
 * 🛑 `willReverse` is the count that WRITES TO THE LEDGER and it is not the
 * same as `willCancel`. The confirmation has to lead with both (45 §11.4).
 */
export interface BatchRunSummary {
  runNumber: number
  /** Builds carrying this run number. */
  total: number
  /** Counts by `build_status`, over that same set. */
  planned: number
  inProgress: number
  completed: number
  canceled: number
  /** `planned` + `inProgress`: what an undo would cancel. */
  willCancel: number
  /** `completed` and not already reversed: what an undo would REVERSE. */
  willReverse: number
  /** Earliest and latest `build_period_start` / `build_period_end` in the run. */
  periodStart: Date | null
  periodEnd: Date | null
  /** When the run's first build was written. */
  ranAt: Date | null
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
 * the marker `StockMovement.qtyPerUnit` exists to make visible instead of
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
   * Omitted, it is `round(part_labor_cost_per_unit x unitsStarted)` for the produced part
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
  /** The inventory role, from the component's `part_kind`, exactly as a receipt resolves it. */
  glRole: string
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
   * none. A completion with any entry here writes those legs `pending`, stamps
   * no costs and posts nothing until the pricer fills them (111 Q18) — never a zero.
   */
  missingStandardPartIds: string[]
}

/** What a completion DID. Enough to render the result without a second read. */
export interface CompleteBuildResult {
  buildId: string
  quantityProduced: number
  quantityScrapped: number
  /** Sum of the consumed lines' extended standard cost, positive. `null` on a pending build. */
  materialCost: number | null
  laborCost: number | null
  overheadCost: number | null
  /** `round(quantityProduced x the produced part's standard cost)`. `null` on a pending build. */
  producedValue: number | null
  /** `(material + labour + overhead) - producedValue` -> account 5090. `null` on a pending build. */
  varianceAmount: number | null
  /** Parts with no standard whose legs were written `pending`; empty on a priced build (111 Q18). */
  pendingPartIds: string[]
  /** Every movement written, consumes first then the single produce. */
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
  source?: BuildSourceValue
  /** Only builds raised by this batch or backflush run. */
  batchRun?: number
  /** Defaults to 50. */
  limit?: number
  offset?: number
}

/** One movement a build wrote, as the reversal reads it back. */
export interface BuildMovementRow {
  movementId: string
  partId: string
  /** `build_consume` or `build_produce`. Carried verbatim onto the negation. */
  type: string
  quantity: number
  /** The ORIGINAL's frozen unit cost, or `null` on a `pending` leg. Never re-priced (B6). */
  unitCost: number | null
  extendedCost: number | null
  glRole: string | null
  /** The as-built snapshot; `null` on an off-BOM row and on the produce row. */
  qtyPerUnit: number | null
  /** `standard` on every row a build writes. Copied, never re-decided. */
  costBasis: string | null
}
