// packages/lib/src/builds/standard-cost-roll.ts

/**
 * The standard-cost roll itself — pure arithmetic over an already-loaded graph.
 *
 * Split from `standard-cost.ts` so the two rules that make this subsystem
 * correct (plans/products/build/01-build-plan.md section 2.2a, README B11) can
 * be tested without a database:
 *
 *  1. **Roll children's `standardCost`, not children's `part_cost`.**
 *     `part_cost` is a PURE MATERIAL CHAIN — `bom/cost-calculator.ts:466` reads
 *     `rollupCost = SUM(child.cost x qty)` where a child's `cost` is its vendor
 *     price or its own rollup, and labour and overhead appear nowhere at any
 *     level. Rolling it drops every subassembly's own conversion cost on the way
 *     up: $14.00 per unit on the real lift. And it does not vanish quietly —
 *     `completeBuild` values consumed rows at the child's standard and
 *     `producedValue` at the parent's, so the gap lands in `varianceAmount` ->
 *     account 5090 on EVERY build, destroying that account's meaning.
 *
 *  2. **Conversion cost is gated on `partKind`.** A purchased `component` gets
 *     zero labour and zero overhead; capitalising assembly labour onto a motor
 *     we never assembled overstates 1310 Raw Materials.
 *
 *  3. **The rate is per PART, falling back to the org.** One org-wide rate
 *     applied at every level of a bill of materials multiplies with the depth of
 *     the tree: a finished good over 8 subassemblies carries 9 x the flat rate,
 *     which on the real lift was $270.00 of a $441.07 standard against $171.07
 *     of actual material. A stored `0` is how a subassembly is made
 *     cost-transparent, and it must survive as a `0` rather than reading as
 *     unset (plans/money/tasks/22-per-part-absorption.md).
 *
 * The walk is a memoized DFS with `inProgress` cycle detection, copying the
 * ordering discipline of `calculateAllCosts` in `bom/cost-calculator.ts`. That
 * ordering is not a performance detail: a parent read before its children have
 * their new standard picks up the old one.
 */

import { UnprocessableEntityError } from '../errors'
import {
  absorbedRate,
  absorbsConversionCost,
  type PartKindValue,
  resolveAbsorptionRates,
  roundMinorUnits,
} from './client'
import type { AbsorptionRates, SkippedPart, StandardCostComponents } from './types'

/** One edge of the bill of materials. Matches `bom/cost-calculator.ts`'s shape. */
export interface SubpartEdge {
  childId: string
  qty: number
}

/** Everything {@link computeStandardCosts} needs, already loaded. */
export interface StandardCostRollInputs {
  /**
   * Every part the roll will write, after ancestor widening.
   *
   * A part OUTSIDE this set contributes its **stored** standard to its parent,
   * never a freshly computed one. That is deliberate and it is what keeps
   * `completeBuild` balanced: the consume rows are valued at the child's stored
   * standard, so the parent's `producedValue` has to be built from the same
   * number. Computing a child in memory and writing only the parent would
   * recreate the exact 5090 gap this module exists to close.
   */
  scope: ReadonlySet<string>
  /** `part_kind`, already resolved (a NULL appears as `component`). */
  partKinds: ReadonlyMap<string, PartKindValue>
  /** Live `part_cost`, exact and unrounded, for the parts that have one. */
  liveCosts: ReadonlyMap<string, number>
  /** Bill of materials: parent -> children. */
  subpartGraph: ReadonlyMap<string, SubpartEdge[]>
  /** `part_standard_cost` as currently stored, for parts outside {@link scope}. */
  storedStandardCosts: ReadonlyMap<string, number>
  /** The org's absorption rates. A `null` is "not declared", never zero. */
  rates: AbsorptionRates
  /**
   * `part_labor_cost_per_unit` / `part_overhead_cost_per_unit`, for the parts
   * that carry one.
   *
   * 🛑 A part is present **only when it has a non-NULL stored value**, so an
   * absence means "use the org rate" and a present `0` means "absorb nothing".
   * {@link resolveAbsorptionRates} reads that distinction with `??`.
   */
  laborOverrides: ReadonlyMap<string, number>
  overheadOverrides: ReadonlyMap<string, number>
  /** `EntityInstance.displayName` per part, for error messages only. */
  partNames?: ReadonlyMap<string, string>
}

/** What {@link computeStandardCosts} produced. */
export interface StandardCostRollComputation {
  /** Keyed by part id. Only parts in scope that could be valued appear. */
  costs: Map<string, StandardCostComponents>
  /** In-scope parts that could not be valued at all. Never written. */
  skipped: SkippedPart[]
  /** Bottom-up: every part appears after every in-scope part it depends on. */
  order: string[]
}

/**
 * Roll every in-scope part, bottom-up.
 *
 * 🛑 **A part that cannot be valued is SKIPPED, never valued short.** Treating a
 * missing child as zero understates the finished good and dumps the difference
 * into 5090, which is the precise failure section 2.2a exists to prevent. A
 * skipped part keeps whatever standard it already had: stale is a state a person
 * can see and fix, an understated number is not.
 *
 * ⚠️ Skipping CASCADES upward - a parent of a skipped part cannot be valued
 * either - and every level carries the same `blockedByPartName`, so a finished
 * good three levels up still names the one component to go price.
 *
 * @throws UnprocessableEntityError only when the bill of materials contains a
 * cycle. That is a data-integrity fault rather than a pricing gap: there is no
 * node on the cycle that could be costed even in principle, and no part to go
 * price, so there is nothing to report and continue with.
 */
export function computeStandardCosts(inputs: StandardCostRollInputs): StandardCostRollComputation {
  const costs = new Map<string, StandardCostComponents>()
  const skipped: SkippedPart[] = []
  const order: string[] = []

  /** Parts already settled — a `null` entry means "in scope but unvaluable". */
  const memo = new Map<string, StandardCostComponents | null>()
  /** The current DFS stack, which is what makes a back edge detectable. */
  const inProgress = new Set<string>()

  /** The name for an error message: an id is a poor thing to hand a person. */
  const name = (partId: string) => inputs.partNames?.get(partId) ?? partId
  /** The name for a REPORT, where a missing one should read as absent, not as an id. */
  const partName = (partId: string) => inputs.partNames?.get(partId) ?? null

  /**
   * partId -> the name of the part whose missing price is the ROOT cause.
   *
   * A part that cannot be valued on its own blames itself. A parent that gave up
   * because a child could not be valued inherits that child's blame rather than
   * naming the child, so a three-level cascade still points at the one screw
   * somebody has to go price. Only populated for parts that were skipped.
   */
  const blameFor = new Map<string, string | null>()

  /**
   * The standard a PARENT should multiply by its quantity.
   *
   * In scope -> the freshly rolled number. Out of scope -> the stored one, which
   * is the value already agreed for that subassembly.
   */
  function contributionOf(partId: string): number | null {
    if (!inputs.scope.has(partId)) {
      return inputs.storedStandardCosts.get(partId) ?? null
    }
    return roll(partId)?.standardCost ?? null
  }

  function roll(partId: string): StandardCostComponents | null {
    const memoized = memo.get(partId)
    if (memoized !== undefined) return memoized

    if (inProgress.has(partId)) {
      // A cycle cannot be costed at any node on it, and a cycle that reaches a
      // BUILT part is a parent whose inputs include itself. `calculateAllCosts`
      // contains a cycle by contributing 0; a standard cost must not, because
      // that 0 would be frozen onto every movement.
      throw new UnprocessableEntityError(
        `Cannot roll standard cost: the bill of materials for "${name(partId)}" contains a circular reference.`
      )
    }
    inProgress.add(partId)
    try {
      const result = computeOne(partId)
      memo.set(partId, result)
      order.push(partId)
      if (result) costs.set(partId, result)
      return result
    } finally {
      inProgress.delete(partId)
    }
  }

  function computeOne(partId: string): StandardCostComponents | null {
    const partKind = inputs.partKinds.get(partId) ?? 'component'

    // ── A purchased part: its landed cost, and nothing else ──
    if (!absorbsConversionCost(partKind)) {
      const live = inputs.liveCosts.get(partId)
      // 🛑 `<= 0` belongs here with the nulls. `part_cost` is written as a real
      // `0` for a part with no supplier price and no priced bill of materials,
      // not left NULL, so a null-only test read "unpriced" as "worth nothing"
      // and froze a $0.00 standard onto it. That standard then passes every
      // downstream guard, because those test `== null` too, and ends up as
      // `unitCost: 0` on an append-only movement. `ensureStandardCost` already
      // refuses an explicit `unitCost <= 0` for the same reason; this is the
      // same rule at the other door.
      if (live == null || !Number.isFinite(live) || live <= 0) {
        skipped.push({ partId, reason: 'no-live-cost', partName: partName(partId) })
        // Its own root cause: this is the part somebody has to go price.
        blameFor.set(partId, partName(partId))
        return null
      }
      const material = roundMinorUnits(live)
      // Zero, not null: we know we did not assemble it, so its conversion cost
      // is a fact rather than an absence.
      return {
        standardMaterialCost: material,
        standardLaborCost: 0,
        standardOverheadCost: 0,
        standardCost: material,
      }
    }

    // ── A built part: the sum of what goes into it, plus conversion ──
    const children = inputs.subpartGraph.get(partId) ?? []
    if (children.length === 0) {
      // Nothing to roll. Not an abort: a part classified as buildable before its
      // bill of materials was entered has no inputs at all, so no number is
      // being understated. It is reported so it is visible, not written.
      skipped.push({ partId, reason: 'no-bill-of-materials', partName: partName(partId) })
      // Its own root cause: this is the part whose bill of materials is missing.
      blameFor.set(partId, partName(partId))
      return null
    }

    let material = 0
    for (const child of children) {
      const childStandard = contributionOf(child.childId)
      if (childStandard == null) {
        // 🛑 SKIP, do not abort. This used to throw, which killed the entire
        // run: one unpriced screw stopped every other part in the org from
        // rolling, so the org-wide button was unusable until somebody found and
        // priced it. Skipping writes nothing for this part - it keeps whatever
        // standard it already had, stale but visible - and lets every part that
        // CAN be valued be valued.
        //
        // ⚠️ The parent is not the remedy and naming it would be bad advice.
        // The scope widens to descendants with no stored standard
        // (`widenToUnvaluedDescendants`), so a child reaching here was either
        // rolled and found unvaluable, or is not a live part at all. Either way
        // the part to go price is the ROOT of the chain, which is what
        // `blameFor` carries up: a finished good blames the screw, not the
        // sub-assembly that also gave up on it.
        const blockedByPartName = blameFor.get(child.childId) ?? partName(child.childId)
        skipped.push({
          partId,
          reason: 'component-not-valuable',
          partName: partName(partId),
          blockedByPartName,
        })
        blameFor.set(partId, blockedByPartName)
        return null
      }
      material += childStandard * child.qty
    }

    // Quantities are `doublePrecision`, so the sum can carry a fractional cent
    // even though every child standard is a whole one.
    const standardMaterialCost = roundMinorUnits(material)

    // 🛑 Resolved HERE and not above the `absorbsConversionCost` branch, however
    // tempting the hoist looks. A `component`'s zero labour is a fact about a
    // part we did not assemble (README B11), and an override must never be a
    // way around that gate: capitalising assembly labour onto a purchased motor
    // overstates 1310 Raw Materials whether the number came from the org
    // setting or from the part's own cell.
    const rates = resolveAbsorptionRates(inputs.rates, {
      laborCostPerUnit: inputs.laborOverrides.get(partId),
      overheadCostPerUnit: inputs.overheadOverrides.get(partId),
    })
    const standardLaborCost = absorbedRate(rates.laborCostPerUnit)
    const standardOverheadCost = absorbedRate(rates.overheadCostPerUnit)

    return {
      standardMaterialCost,
      standardLaborCost,
      standardOverheadCost,
      standardCost: standardMaterialCost + (standardLaborCost ?? 0) + (standardOverheadCost ?? 0),
    }
  }

  for (const partId of inputs.scope) roll(partId)

  return { costs, skipped, order }
}

/**
 * Widen a set of part ids to include every ancestor.
 *
 * The same widening `recalculateAffectedParts` performs, and for the same
 * reason: a finished good whose subassembly's standard just moved is carrying a
 * standard built from the old number. Ancestors only — pulling descendants in
 * would re-value the subassemblies the caller did not ask to re-value.
 */
export function widenToAncestors(
  partIds: Iterable<string>,
  parentGraph: ReadonlyMap<string, string[]>
): Set<string> {
  const widened = new Set<string>()
  const walk = (partId: string) => {
    if (widened.has(partId)) return
    widened.add(partId)
    for (const parent of parentGraph.get(partId) ?? []) walk(parent)
  }
  for (const partId of partIds) walk(partId)
  return widened
}

/**
 * Widen a set of part ids DOWNWARD, to the descendants that carry no stored
 * standard cost.
 *
 * 🛑 The complement of {@link widenToAncestors}, and the two objections do not
 * overlap. Refusing descendants outright (which this module used to do) is what
 * made the part drawer's Roll button throw on every built part: the child was
 * never in scope, so `contributionOf` read its STORED standard, which is `null`
 * in an org that has never rolled, and the walk aborted.
 *
 * A descendant that already HAS a standard is still excluded, and that is the
 * whole distinction: it has an agreed value to re-value, and re-valuing a
 * subassembly the caller did not name is exactly what `widenToAncestors`'
 * comment refuses. A descendant with NO standard has nothing to re-value, so
 * the objection does not apply to it. It appears in the plan as `isInitial`,
 * which is how the preview tells a person this is a first valuation.
 *
 * The walk continues THROUGH a valued descendant, because a valued
 * subassembly's own children may still be unvalued and are equally free to
 * value.
 *
 * @param partIds the parts already in scope, normally the ancestor-widened set
 * @param subpartGraph parent -> children, the same graph the roll walks
 * @param storedStandardCosts `part_standard_cost` as currently stored
 */
export function widenToUnvaluedDescendants(
  partIds: Iterable<string>,
  subpartGraph: ReadonlyMap<string, SubpartEdge[]>,
  storedStandardCosts: ReadonlyMap<string, number>
): Set<string> {
  const unvalued = new Set<string>()
  // Separate from `unvalued` so a cycle terminates even though a valued node is
  // walked through without being collected.
  const visited = new Set<string>()

  const walk = (partId: string) => {
    if (visited.has(partId)) return
    visited.add(partId)
    for (const edge of subpartGraph.get(partId) ?? []) {
      if (storedStandardCosts.get(edge.childId) == null) unvalued.add(edge.childId)
      walk(edge.childId)
    }
  }

  for (const partId of partIds) walk(partId)
  return unvalued
}
