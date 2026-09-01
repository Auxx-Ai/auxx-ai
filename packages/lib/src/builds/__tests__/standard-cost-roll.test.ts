// packages/lib/src/builds/__tests__/standard-cost-roll.test.ts
//
// Cover for plans/products/build/01-build-plan.md section 2.2a and README B11 —
// the two rules that keep account 5090 meaningful. Every case here is pure
// arithmetic over an in-memory graph, so it needs no `vi.mock` at all.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import type { PartKindValue } from '../client'
import {
  computeStandardCosts,
  type StandardCostRollInputs,
  type SubpartEdge,
  widenToAncestors,
  widenToUnvaluedDescendants,
} from '../standard-cost-roll'
import type { AbsorptionRates } from '../types'

const MOTOR = 'part_motor'
const TUBE = 'part_tube'
const ASSEMBLY = 'part_assembly'
const LIFT = 'part_lift'

/** $5.00 direct labour and $2.00 overhead per assembled unit, in minor units. */
const RATES: AbsorptionRates = { laborCostPerUnit: 500, overheadCostPerUnit: 200 }

function inputs(overrides: Partial<StandardCostRollInputs> = {}): StandardCostRollInputs {
  return {
    scope: new Set<string>(),
    partKinds: new Map<string, PartKindValue>(),
    liveCosts: new Map<string, number>(),
    subpartGraph: new Map<string, SubpartEdge[]>(),
    storedStandardCosts: new Map<string, number>(),
    rates: RATES,
    laborOverrides: new Map<string, number>(),
    overheadOverrides: new Map<string, number>(),
    ...overrides,
  }
}

describe('computeStandardCosts', () => {
  // The real lift, from section 2.2a's table. A purchased motor at $20.098 and a
  // purchased tube at $9.510 make a $29.608 assembly; two of those plus $7.00 of
  // conversion at each of the two levels make the lift.
  const liftGraph = () =>
    inputs({
      scope: new Set([MOTOR, TUBE, ASSEMBLY, LIFT]),
      partKinds: new Map<string, PartKindValue>([
        [MOTOR, 'component'],
        [TUBE, 'component'],
        [ASSEMBLY, 'subassembly'],
        [LIFT, 'finished_good'],
      ]),
      liveCosts: new Map([
        [MOTOR, 2009.8],
        [TUBE, 951],
        // `part_cost` on a built part is the pure MATERIAL chain, and the roll
        // must ignore it entirely. Present here so the test would catch a
        // regression that read it.
        [ASSEMBLY, 2960.8],
        [LIFT, 5921.6],
      ]),
      subpartGraph: new Map<string, SubpartEdge[]>([
        [
          ASSEMBLY,
          [
            { childId: MOTOR, qty: 1 },
            { childId: TUBE, qty: 1 },
          ],
        ],
        [LIFT, [{ childId: ASSEMBLY, qty: 2 }]],
      ]),
    })

  it("rolls children's standardCost, so a subassembly's conversion cost survives to the parent", () => {
    const { costs } = computeStandardCosts(liftGraph())

    expect(costs.get(ASSEMBLY)).toEqual({
      standardMaterialCost: 2961, // round(2009.8) + round(951)
      standardLaborCost: 500,
      standardOverheadCost: 200,
      standardCost: 3661,
    })

    // 2 x 3661 = 7322, NOT 2 x 2961 = 5922. The $14.00 difference is exactly the
    // two assemblies' conversion cost, and rolling `part_cost` would drop it.
    expect(costs.get(LIFT)).toEqual({
      standardMaterialCost: 7322,
      standardLaborCost: 500,
      standardOverheadCost: 200,
      standardCost: 8022,
    })

    const naiveMaterial = Math.round(2960.8) * 2
    expect(costs.get(LIFT)!.standardMaterialCost - naiveMaterial).toBe(1400)
  })

  it('gives a purchased component zero labour and zero overhead', () => {
    const { costs } = computeStandardCosts(liftGraph())

    // Zero, not null: we know we did not assemble it. Adding $7.00 of assembly
    // labour to a motor capitalises cost never spent and overstates 1310.
    expect(costs.get(MOTOR)).toEqual({
      standardMaterialCost: 2010,
      standardLaborCost: 0,
      standardOverheadCost: 0,
      standardCost: 2010,
    })
  })

  it('treats a NULL partKind as a component, so an unclassified part absorbs nothing', () => {
    const { costs } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR]),
        // No entry at all for MOTOR — `part_kind` is set on 5 of 218 parts.
        partKinds: new Map(),
        liveCosts: new Map([[MOTOR, 2009.8]]),
        subpartGraph: new Map([[MOTOR, [{ childId: TUBE, qty: 1 }]]]),
      })
    )

    expect(costs.get(MOTOR)).toEqual({
      standardMaterialCost: 2010,
      standardLaborCost: 0,
      standardOverheadCost: 0,
      standardCost: 2010,
    })
  })

  it('gates conversion cost on partKind, not on which number part_cost took', () => {
    // A part with BOTH a vendor price and a bill of materials: `part_cost_source`
    // would flip to 'vendor' here, and gating on it would silently strip the
    // subassembly's conversion cost.
    const { costs } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR, ASSEMBLY]),
        partKinds: new Map<string, PartKindValue>([
          [MOTOR, 'component'],
          [ASSEMBLY, 'subassembly'],
        ]),
        liveCosts: new Map([
          [MOTOR, 1000],
          [ASSEMBLY, 900],
        ]),
        subpartGraph: new Map([[ASSEMBLY, [{ childId: MOTOR, qty: 1 }]]]),
      })
    )

    expect(costs.get(ASSEMBLY)).toEqual({
      standardMaterialCost: 1000,
      standardLaborCost: 500,
      standardOverheadCost: 200,
      standardCost: 1700,
    })
  })

  // 🛑 This used to THROW, which killed the whole run: one unpriced screw
  // stopped every other part in the org from rolling. It skips now. What must
  // NOT change is that the assembly is never valued at $0 for the motor -
  // that understates it and dumps the difference into 5090.
  it('skips the parent when a child has no standard cost, and writes nothing for it', () => {
    const { costs, skipped } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR, ASSEMBLY]),
        partKinds: new Map<string, PartKindValue>([
          [MOTOR, 'component'],
          [ASSEMBLY, 'subassembly'],
        ]),
        // MOTOR has no `part_cost`, so it has no standard to contribute.
        liveCosts: new Map(),
        subpartGraph: new Map([[ASSEMBLY, [{ childId: MOTOR, qty: 1 }]]]),
        partNames: new Map([
          [MOTOR, '400Lbs Motor'],
          [ASSEMBLY, '400Lbs motor Assembly'],
        ]),
      })
    )

    expect(costs.has(ASSEMBLY)).toBe(false)
    expect(skipped).toEqual([
      { partId: MOTOR, reason: 'no-live-cost', partName: '400Lbs Motor' },
      {
        partId: ASSEMBLY,
        reason: 'component-not-valuable',
        partName: '400Lbs motor Assembly',
        // The remedy is the MOTOR's price, never the assembly's.
        blockedByPartName: '400Lbs Motor',
      },
    ])
  })

  // The whole point of skipping rather than aborting: everything that CAN be
  // valued still is, in the same run.
  it('rolls every other part in the same run', () => {
    const { costs, skipped } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR, TUBE, ASSEMBLY]),
        partKinds: new Map<string, PartKindValue>([
          [MOTOR, 'component'],
          [TUBE, 'component'],
          [ASSEMBLY, 'subassembly'],
        ]),
        // TUBE is priced and unrelated; MOTOR is not and blocks ASSEMBLY.
        liveCosts: new Map([[TUBE, 951]]),
        subpartGraph: new Map([[ASSEMBLY, [{ childId: MOTOR, qty: 1 }]]]),
      })
    )

    expect(costs.get(TUBE)!.standardCost).toBe(951)
    expect(costs.has(ASSEMBLY)).toBe(false)
    expect(skipped.map((s) => s.partId).sort()).toEqual([ASSEMBLY, MOTOR].sort())
  })

  // A three-level cascade must still name the ONE part to go price, not the
  // sub-assembly that also gave up on it.
  it('carries the root blame up through every level of the cascade', () => {
    const { costs, skipped } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR, ASSEMBLY, LIFT]),
        partKinds: new Map<string, PartKindValue>([
          [MOTOR, 'component'],
          [ASSEMBLY, 'subassembly'],
          [LIFT, 'finished_good'],
        ]),
        liveCosts: new Map(),
        subpartGraph: new Map<string, SubpartEdge[]>([
          [ASSEMBLY, [{ childId: MOTOR, qty: 1 }]],
          [LIFT, [{ childId: ASSEMBLY, qty: 2 }]],
        ]),
        partNames: new Map([
          [MOTOR, '400Lbs Motor'],
          [ASSEMBLY, 'Motor Assembly'],
          [LIFT, 'Auxx Lift 400'],
        ]),
      })
    )

    expect(costs.size).toBe(0)
    const lift = skipped.find((s) => s.partId === LIFT)
    expect(lift?.reason).toBe('component-not-valuable')
    // NOT 'Motor Assembly' — that is not the part anybody can price.
    expect(lift?.blockedByPartName).toBe('400Lbs Motor')
  })

  it('aborts on a circular bill of materials rather than contributing zero', () => {
    const cyclic = inputs({
      scope: new Set([ASSEMBLY, LIFT]),
      partKinds: new Map<string, PartKindValue>([
        [ASSEMBLY, 'subassembly'],
        [LIFT, 'finished_good'],
      ]),
      subpartGraph: new Map<string, SubpartEdge[]>([
        [LIFT, [{ childId: ASSEMBLY, qty: 1 }]],
        [ASSEMBLY, [{ childId: LIFT, qty: 1 }]],
      ]),
      partNames: new Map([[LIFT, 'Auxx Lift 400lbs 4x8']]),
    })

    // `calculateAllCosts` contains a cycle by contributing 0 to the parent. A
    // standard must not: that 0 would be frozen onto every movement.
    expect(() => computeStandardCosts(cyclic)).toThrow(UnprocessableEntityError)
    expect(() => computeStandardCosts(cyclic)).toThrow(/circular/i)
  })

  it('reads an out-of-scope child at its STORED standard, never a recomputed one', () => {
    // Scoped roll of the lift only. The assembly keeps the standard already
    // agreed for it — which is the number `completeBuild` will value the consume
    // rows at, so the parent has to be built from the same one.
    const { costs } = computeStandardCosts(
      inputs({
        scope: new Set([LIFT]),
        partKinds: new Map<string, PartKindValue>([
          [ASSEMBLY, 'subassembly'],
          [LIFT, 'finished_good'],
        ]),
        liveCosts: new Map([[ASSEMBLY, 9999]]),
        subpartGraph: new Map<string, SubpartEdge[]>([
          [LIFT, [{ childId: ASSEMBLY, qty: 2 }]],
          [ASSEMBLY, [{ childId: MOTOR, qty: 1 }]],
        ]),
        storedStandardCosts: new Map([[ASSEMBLY, 3661]]),
      })
    )

    expect(costs.get(LIFT)!.standardMaterialCost).toBe(7322)
    expect(costs.has(ASSEMBLY)).toBe(false)
  })

  it('skips when an out-of-scope child has never been rolled, blaming that child', () => {
    const { costs, skipped } = computeStandardCosts(
      inputs({
        scope: new Set([LIFT]),
        partKinds: new Map<string, PartKindValue>([[LIFT, 'finished_good']]),
        subpartGraph: new Map([[LIFT, [{ childId: ASSEMBLY, qty: 2 }]]]),
        storedStandardCosts: new Map(),
        partNames: new Map([
          [LIFT, 'Auxx Lift 400'],
          [ASSEMBLY, 'Motor Assembly'],
        ]),
      })
    )

    expect(costs.has(LIFT)).toBe(false)
    // The child is out of scope, so it was never itself skipped and has no
    // blame entry — it IS the root, and gets named directly.
    expect(skipped).toEqual([
      {
        partId: LIFT,
        reason: 'component-not-valuable',
        partName: 'Auxx Lift 400',
        blockedByPartName: 'Motor Assembly',
      },
    ])
  })

  it('stores NULL, not zero, for an absorption rate that has not been declared', () => {
    const { costs } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR, ASSEMBLY]),
        partKinds: new Map<string, PartKindValue>([
          [MOTOR, 'component'],
          [ASSEMBLY, 'subassembly'],
        ]),
        liveCosts: new Map([[MOTOR, 1000]]),
        subpartGraph: new Map([[ASSEMBLY, [{ childId: MOTOR, qty: 1 }]]]),
        rates: { laborCostPerUnit: null, overheadCostPerUnit: null },
      })
    )

    // "No absorption declared" and "a declared rate of zero" are numerically
    // identical once summed, so the distinction survives in storage.
    expect(costs.get(ASSEMBLY)).toEqual({
      standardMaterialCost: 1000,
      standardLaborCost: null,
      standardOverheadCost: null,
      standardCost: 1000,
    })
    // A component still stores 0 — its conversion cost is a fact, not an absence.
    expect(costs.get(MOTOR)!.standardLaborCost).toBe(0)
  })

  it('distinguishes a declared zero rate from an undeclared one', () => {
    const { costs } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR, ASSEMBLY]),
        partKinds: new Map<string, PartKindValue>([
          [MOTOR, 'component'],
          [ASSEMBLY, 'subassembly'],
        ]),
        liveCosts: new Map([[MOTOR, 1000]]),
        subpartGraph: new Map([[ASSEMBLY, [{ childId: MOTOR, qty: 1 }]]]),
        rates: { laborCostPerUnit: 0, overheadCostPerUnit: null },
      })
    )

    expect(costs.get(ASSEMBLY)!.standardLaborCost).toBe(0)
    expect(costs.get(ASSEMBLY)!.standardOverheadCost).toBeNull()
  })

  // ── Per-part absorption overrides (plans/money/tasks/22) ────────────

  describe('per-part absorption overrides', () => {
    /** A motor at $10.00 under a subassembly, with the org at $5.00 / $2.00. */
    const twoLevel = (over: Partial<StandardCostRollInputs> = {}) =>
      inputs({
        scope: new Set([MOTOR, ASSEMBLY]),
        partKinds: new Map<string, PartKindValue>([
          [MOTOR, 'component'],
          [ASSEMBLY, 'subassembly'],
        ]),
        liveCosts: new Map([[MOTOR, 1000]]),
        subpartGraph: new Map([[ASSEMBLY, [{ childId: MOTOR, qty: 1 }]]]),
        ...over,
      })

    it('prefers a per-part override over the org rate, in both directions', () => {
      const { costs } = computeStandardCosts(
        twoLevel({
          laborOverrides: new Map([[ASSEMBLY, 4500]]),
          overheadOverrides: new Map([[ASSEMBLY, 50]]),
        })
      )

      expect(costs.get(ASSEMBLY)).toEqual({
        standardMaterialCost: 1000,
        standardLaborCost: 4500, // not the org's 500
        standardOverheadCost: 50, // not the org's 200
        standardCost: 5550,
      })
    })

    // 🛑 The `??`-not-`||` pin. A stored 0 is "this part absorbs nothing" — the
    // phantom case — and `0 || 500` is `500`, which would silently reinstate the
    // org rate on exactly the parts somebody took the trouble to zero out.
    it('lets a stored ZERO override beat a non-zero org rate', () => {
      const { costs } = computeStandardCosts(
        twoLevel({
          laborOverrides: new Map([[ASSEMBLY, 0]]),
          overheadOverrides: new Map([[ASSEMBLY, 0]]),
        })
      )

      expect(costs.get(ASSEMBLY)).toEqual({
        standardMaterialCost: 1000,
        standardLaborCost: 0,
        standardOverheadCost: 0,
        standardCost: 1000, // material and nothing else
      })
    })

    it('falls through to the org rate when a part has no override', () => {
      const { costs } = computeStandardCosts(twoLevel({ laborOverrides: new Map([[MOTOR, 9999]]) }))

      // The override sits on a DIFFERENT part; the assembly reads the org rate.
      expect(costs.get(ASSEMBLY)!.standardLaborCost).toBe(500)
      expect(costs.get(ASSEMBLY)!.standardOverheadCost).toBe(200)
    })

    it('stores NULL when neither an override nor an org rate is declared', () => {
      const { costs } = computeStandardCosts(
        twoLevel({ rates: { laborCostPerUnit: null, overheadCostPerUnit: null } })
      )

      // Still an ABSENCE, never a confident zero — `absorbedRate`'s rule.
      expect(costs.get(ASSEMBLY)!.standardLaborCost).toBeNull()
      expect(costs.get(ASSEMBLY)!.standardOverheadCost).toBeNull()
    })

    it('stores a declared zero override even when the org rate is undeclared', () => {
      const { costs } = computeStandardCosts(
        twoLevel({
          rates: { laborCostPerUnit: null, overheadCostPerUnit: null },
          laborOverrides: new Map([[ASSEMBLY, 0]]),
        })
      )

      // 0 is a claim, null is the absence of one, and they must not collapse.
      expect(costs.get(ASSEMBLY)!.standardLaborCost).toBe(0)
      expect(costs.get(ASSEMBLY)!.standardOverheadCost).toBeNull()
    })

    // README B11: an override must not be a way around the partKind gate.
    // Capitalising assembly labour onto a purchased motor overstates 1310
    // whether the number came from the org setting or the part's own cell.
    it('ignores an override on a component', () => {
      const { costs } = computeStandardCosts(
        twoLevel({
          laborOverrides: new Map([[MOTOR, 7500]]),
          overheadOverrides: new Map([[MOTOR, 7500]]),
        })
      )

      expect(costs.get(MOTOR)).toEqual({
        standardMaterialCost: 1000,
        standardLaborCost: 0,
        standardOverheadCost: 0,
        standardCost: 1000,
      })
    })

    it("carries a child's override up into its parent's material cost", () => {
      const { costs } = computeStandardCosts(
        inputs({
          scope: new Set([MOTOR, ASSEMBLY, LIFT]),
          partKinds: new Map<string, PartKindValue>([
            [MOTOR, 'component'],
            [ASSEMBLY, 'subassembly'],
            [LIFT, 'finished_good'],
          ]),
          liveCosts: new Map([[MOTOR, 1000]]),
          subpartGraph: new Map([
            [ASSEMBLY, [{ childId: MOTOR, qty: 1 }]],
            [LIFT, [{ childId: ASSEMBLY, qty: 2 }]],
          ]),
          laborOverrides: new Map([[ASSEMBLY, 100]]),
        })
      )

      // assembly = 1000 material + 100 labour + 200 overhead = 1300
      expect(costs.get(ASSEMBLY)!.standardCost).toBe(1300)
      // lift material = 2 x 1300, and it still absorbs the ORG rate itself
      expect(costs.get(LIFT)).toEqual({
        standardMaterialCost: 2600,
        standardLaborCost: 500,
        standardOverheadCost: 200,
        standardCost: 3300,
      })
    })

    // The case the whole task exists for: the real lift carried 9 x the flat
    // rate because it has 8 subassemblies. Zeroing them collapses the standard
    // back to material plus the finished good's own absorption.
    it('reduces a parent to material plus its OWN absorption when children are zeroed', () => {
      const zeroed = computeStandardCosts(
        inputs({
          scope: new Set([MOTOR, ASSEMBLY, LIFT]),
          partKinds: new Map<string, PartKindValue>([
            [MOTOR, 'component'],
            [ASSEMBLY, 'subassembly'],
            [LIFT, 'finished_good'],
          ]),
          liveCosts: new Map([[MOTOR, 1000]]),
          subpartGraph: new Map([
            [ASSEMBLY, [{ childId: MOTOR, qty: 1 }]],
            [LIFT, [{ childId: ASSEMBLY, qty: 2 }]],
          ]),
          laborOverrides: new Map([[ASSEMBLY, 0]]),
          overheadOverrides: new Map([[ASSEMBLY, 0]]),
        })
      )

      expect(zeroed.costs.get(ASSEMBLY)!.standardCost).toBe(1000)
      expect(zeroed.costs.get(LIFT)).toEqual({
        standardMaterialCost: 2000, // 2 x bare material, no embedded conversion
        standardLaborCost: 500,
        standardOverheadCost: 200,
        standardCost: 2700,
      })
    })
  })

  it('rounds before freezing, because CURRENCY is integer minor units', () => {
    const { costs } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR, ASSEMBLY]),
        partKinds: new Map<string, PartKindValue>([
          [MOTOR, 'component'],
          [ASSEMBLY, 'subassembly'],
        ]),
        // A landed cost carrying a fractional-cent tariff term.
        liveCosts: new Map([[MOTOR, 4442.975]]),
        // Fractional quantities are legal — `subpart_quantity` is doublePrecision.
        subpartGraph: new Map([[ASSEMBLY, [{ childId: MOTOR, qty: 2.5 }]]]),
        rates: { laborCostPerUnit: 500.4, overheadCostPerUnit: null },
      })
    )

    expect(costs.get(MOTOR)!.standardCost).toBe(4443)
    expect(costs.get(ASSEMBLY)!.standardMaterialCost).toBe(11108) // round(4443 x 2.5)
    expect(costs.get(ASSEMBLY)!.standardLaborCost).toBe(500)
    expect(Number.isInteger(costs.get(ASSEMBLY)!.standardCost)).toBe(true)
  })

  it('skips an unpriced component instead of writing it as zero', () => {
    const { costs, skipped } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR, TUBE]),
        partKinds: new Map<string, PartKindValue>([[TUBE, 'component']]),
        liveCosts: new Map([[TUBE, 951]]),
      })
    )

    expect(costs.has(MOTOR)).toBe(false)
    expect(skipped).toEqual([{ partId: MOTOR, reason: 'no-live-cost', partName: null }])
    expect(costs.get(TUBE)!.standardCost).toBe(951)
  })

  // 🛑 `part_cost` is written as a real `0` for a part with no supplier price and
  // no priced bill of materials, not left NULL. Reading that as a cost rolled 83
  // parts in the dev org to a $0.00 standard, which then passes every downstream
  // `== null` guard and freezes onto an append-only movement.
  it('skips a component whose live cost is a stored ZERO, not just a missing one', () => {
    const { costs, skipped } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR, TUBE]),
        partKinds: new Map<string, PartKindValue>([
          [MOTOR, 'component'],
          [TUBE, 'component'],
        ]),
        liveCosts: new Map([
          [MOTOR, 0],
          [TUBE, 951],
        ]),
      })
    )

    expect(costs.has(MOTOR)).toBe(false)
    expect(skipped).toEqual([{ partId: MOTOR, reason: 'no-live-cost', partName: null }])
    expect(costs.get(TUBE)!.standardCost).toBe(951)
  })

  it('still rolls a component priced at one minor unit, so the guard is > 0 and not a threshold', () => {
    const { costs, skipped } = computeStandardCosts(
      inputs({
        scope: new Set([MOTOR]),
        partKinds: new Map<string, PartKindValue>([[MOTOR, 'component']]),
        liveCosts: new Map([[MOTOR, 1]]),
      })
    )

    expect(skipped).toEqual([])
    expect(costs.get(MOTOR)!.standardCost).toBe(1)
  })

  // A zero live cost on a CHILD must skip the parent by name rather than quietly
  // contributing nothing to it — the same treatment a missing cost already gets.
  // 🛑 The assembly must NOT come back at 951 + 0: that is the understatement.
  it('skips a parent whose child has a zero live cost, rather than costing the parent short', () => {
    const { costs, skipped } = computeStandardCosts(
      inputs({
        scope: new Set([ASSEMBLY, MOTOR, TUBE]),
        partKinds: new Map<string, PartKindValue>([
          [ASSEMBLY, 'subassembly'],
          [MOTOR, 'component'],
          [TUBE, 'component'],
        ]),
        liveCosts: new Map([
          [MOTOR, 0],
          [TUBE, 951],
        ]),
        subpartGraph: new Map<string, SubpartEdge[]>([
          [
            ASSEMBLY,
            [
              { childId: MOTOR, qty: 1 },
              { childId: TUBE, qty: 1 },
            ],
          ],
        ]),
        partNames: new Map([[MOTOR, 'Crown for 59 Motor']]),
      })
    )

    expect(costs.has(ASSEMBLY)).toBe(false)
    // The priced sibling still rolls — that is the point of skipping.
    expect(costs.get(TUBE)!.standardCost).toBe(951)
    expect(skipped.find((s) => s.partId === ASSEMBLY)).toEqual({
      partId: ASSEMBLY,
      reason: 'component-not-valuable',
      partName: null,
      blockedByPartName: 'Crown for 59 Motor',
    })
  })

  it('skips a buildable part that has no bill of materials yet', () => {
    const { costs, skipped } = computeStandardCosts(
      inputs({
        scope: new Set([ASSEMBLY]),
        partKinds: new Map<string, PartKindValue>([[ASSEMBLY, 'subassembly']]),
      })
    )

    // Not an abort: nothing is being understated, because there are no inputs at
    // all. It is reported so it stays visible.
    expect(costs.has(ASSEMBLY)).toBe(false)
    expect(skipped).toEqual([{ partId: ASSEMBLY, reason: 'no-bill-of-materials', partName: null }])
  })

  it('walks bottom-up, so every child settles before the parent that reads it', () => {
    const { order } = computeStandardCosts(liftGraph())

    expect(order.indexOf(MOTOR)).toBeLessThan(order.indexOf(ASSEMBLY))
    expect(order.indexOf(TUBE)).toBeLessThan(order.indexOf(ASSEMBLY))
    expect(order.indexOf(ASSEMBLY)).toBeLessThan(order.indexOf(LIFT))
  })

  it('memoizes a shared child rather than re-rolling it per parent', () => {
    const shared = inputs({
      scope: new Set([MOTOR, ASSEMBLY, LIFT]),
      partKinds: new Map<string, PartKindValue>([
        [MOTOR, 'component'],
        [ASSEMBLY, 'subassembly'],
        [LIFT, 'finished_good'],
      ]),
      liveCosts: new Map([[MOTOR, 1000]]),
      subpartGraph: new Map<string, SubpartEdge[]>([
        [ASSEMBLY, [{ childId: MOTOR, qty: 1 }]],
        [
          LIFT,
          [
            { childId: MOTOR, qty: 1 },
            { childId: ASSEMBLY, qty: 1 },
          ],
        ],
      ]),
    })

    const { order } = computeStandardCosts(shared)
    expect(order.filter((id) => id === MOTOR)).toHaveLength(1)
  })
})

describe('widenToAncestors', () => {
  // parent graph: child -> [parents]
  const parentGraph = new Map<string, string[]>([
    [MOTOR, [ASSEMBLY]],
    [TUBE, [ASSEMBLY]],
    [ASSEMBLY, [LIFT]],
  ])

  it('pulls in every ancestor of a named part', () => {
    // The same widening `recalculateAffectedParts` performs: a finished good
    // whose subassembly just moved is carrying a standard built from the old
    // number.
    expect([...widenToAncestors([MOTOR], parentGraph)].sort()).toEqual(
      [MOTOR, ASSEMBLY, LIFT].sort()
    )
  })

  it('pulls in no descendants', () => {
    // Rolling a finished good values it at its subassemblies' already-agreed
    // standards. Widening downward would re-value what the caller did not ask to.
    expect([...widenToAncestors([LIFT], parentGraph)]).toEqual([LIFT])
  })

  it('terminates on a cycle in the parent graph', () => {
    const cyclic = new Map<string, string[]>([
      [ASSEMBLY, [LIFT]],
      [LIFT, [ASSEMBLY]],
    ])
    expect([...widenToAncestors([ASSEMBLY], cyclic)].sort()).toEqual([ASSEMBLY, LIFT].sort())
  })
})

describe('widenToUnvaluedDescendants', () => {
  // subpart graph: parent -> children. lift -> assembly -> [motor, tube]
  const subpartGraph = new Map<string, SubpartEdge[]>([
    [LIFT, [{ childId: ASSEMBLY, qty: 2 }]],
    [
      ASSEMBLY,
      [
        { childId: MOTOR, qty: 1 },
        { childId: TUBE, qty: 4 },
      ],
    ],
  ])

  it('pulls in a descendant that has no stored standard', () => {
    // The task 15 section 3 bug: without this the child is never in scope, so
    // `contributionOf` reads its null stored standard and the walk aborts.
    expect([...widenToUnvaluedDescendants([LIFT], subpartGraph, new Map())].sort()).toEqual(
      [ASSEMBLY, MOTOR, TUBE].sort()
    )
  })

  it('leaves a descendant that already has a standard alone', () => {
    // It has an agreed value to re-value, which is exactly what a scoped roll
    // must not do behind the caller's back.
    const stored = new Map([[ASSEMBLY, 5000]])
    expect([...widenToUnvaluedDescendants([LIFT], subpartGraph, stored)].sort()).toEqual(
      [MOTOR, TUBE].sort()
    )
  })

  it('walks THROUGH a valued descendant to reach an unvalued one beneath it', () => {
    const stored = new Map([
      [ASSEMBLY, 5000],
      [TUBE, 400],
    ])
    expect([...widenToUnvaluedDescendants([LIFT], subpartGraph, stored)]).toEqual([MOTOR])
  })

  it('never includes the named parts themselves', () => {
    // They arrive through the ancestor widening, which owns the upward half.
    expect([...widenToUnvaluedDescendants([MOTOR], subpartGraph, new Map())]).toEqual([])
  })

  it('terminates on a cycle in the bill of materials', () => {
    const cyclic = new Map<string, SubpartEdge[]>([
      [ASSEMBLY, [{ childId: LIFT, qty: 1 }]],
      [LIFT, [{ childId: ASSEMBLY, qty: 1 }]],
    ])
    expect([...widenToUnvaluedDescendants([LIFT], cyclic, new Map())].sort()).toEqual(
      [ASSEMBLY, LIFT].sort()
    )
  })
})
