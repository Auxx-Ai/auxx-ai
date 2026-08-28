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

  it('aborts the parent with UnprocessableEntityError when a child has no standard cost', () => {
    const naming = inputs({
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

    expect(() => computeStandardCosts(naming)).toThrow(UnprocessableEntityError)
    // Naming both parts is the point: silently valuing the assembly at $0 for
    // the motor understates it and dumps the difference into 5090.
    expect(() => computeStandardCosts(naming)).toThrow(/400Lbs motor Assembly/)
    expect(() => computeStandardCosts(naming)).toThrow(/400Lbs Motor/)
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

  it('aborts when an out-of-scope child has never been rolled', () => {
    expect(() =>
      computeStandardCosts(
        inputs({
          scope: new Set([LIFT]),
          partKinds: new Map<string, PartKindValue>([[LIFT, 'finished_good']]),
          subpartGraph: new Map([[LIFT, [{ childId: ASSEMBLY, qty: 2 }]]]),
          storedStandardCosts: new Map(),
        })
      )
    ).toThrow(UnprocessableEntityError)
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
