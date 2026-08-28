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
 * The walk is a memoized DFS with `inProgress` cycle detection, copying the
 * ordering discipline of `calculateAllCosts` in `bom/cost-calculator.ts`. That
 * ordering is not a performance detail: a parent read before its children have
 * their new standard picks up the old one.
 */

import { UnprocessableEntityError } from '../errors'
import { absorbedRate, absorbsConversionCost, type PartKindValue, roundMinorUnits } from './client'
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
 * @throws UnprocessableEntityError when a built part's component has no standard
 * cost, or when the bill of materials contains a cycle. Both abort the roll
 * rather than valuing the parent short: silently treating a missing child as
 * zero understates the finished good and dumps the difference into 5090, which
 * is the precise failure section 2.2a exists to prevent.
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
      if (live == null || !Number.isFinite(live)) {
        skipped.push({ partId, reason: 'no-live-cost', partName: partName(partId) })
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
      return null
    }

    let material = 0
    for (const child of children) {
      const childStandard = contributionOf(child.childId)
      if (childStandard == null) {
        throw new UnprocessableEntityError(
          `Cannot roll standard cost for "${name(partId)}": its component "${name(child.childId)}" has no standard cost. Give it a price or roll it first.`
        )
      }
      material += childStandard * child.qty
    }

    // Quantities are `doublePrecision`, so the sum can carry a fractional cent
    // even though every child standard is a whole one.
    const standardMaterialCost = roundMinorUnits(material)
    const standardLaborCost = absorbedRate(inputs.rates.laborCostPerUnit)
    const standardOverheadCost = absorbedRate(inputs.rates.overheadCostPerUnit)

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
