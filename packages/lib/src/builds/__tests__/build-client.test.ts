// packages/lib/src/builds/__tests__/build-client.test.ts
//
// The pure half of the build event: the status gates and the variance
// arithmetic. No doubles of any kind — everything here is a total function of
// its arguments, which is what lets the B7 identity below be asserted as an
// identity rather than as one worked example.

import { describe, expect, it } from 'vitest'
import {
  absorbedRunCost,
  buildVariance,
  canAmendBuild,
  canCancelBuild,
  canCompleteBuild,
  canReverseBuild,
  canStartBuild,
  componentConsumption,
  resolveAbsorptionRates,
  resolveBuildStatus,
  summarizeBuildCompletion,
  unitsStarted,
} from '../client'

describe('resolveBuildStatus', () => {
  it('reads the four stored values', () => {
    expect(resolveBuildStatus('planned')).toBe('planned')
    expect(resolveBuildStatus('in_progress')).toBe('in_progress')
    expect(resolveBuildStatus('completed')).toBe('completed')
    expect(resolveBuildStatus('canceled')).toBe('canceled')
  })

  it('does NOT default an absent or unknown status', () => {
    // Unlike `part_kind`, which reads NULL as `component`. A build with no
    // status is a row whose lifecycle nobody can state, and defaulting it to
    // `planned` would let a write path post an append-only ledger entry.
    expect(resolveBuildStatus(null)).toBeNull()
    expect(resolveBuildStatus(undefined)).toBeNull()
    expect(resolveBuildStatus('shipped')).toBeNull()
  })
})

describe('the status gates', () => {
  it('refuses every action on a null status', () => {
    expect(canStartBuild(null)).toBe(false)
    expect(canCompleteBuild(null)).toBe(false)
    expect(canCancelBuild(null)).toBe(false)
    expect(canReverseBuild(null)).toBe(false)
    expect(canAmendBuild(null)).toBe(false)
  })

  it('allows exactly one completion (B8)', () => {
    expect(canCompleteBuild('planned')).toBe(true)
    expect(canCompleteBuild('in_progress')).toBe(true)
    // A run finished in tranches is a second build.
    expect(canCompleteBuild('completed')).toBe(false)
    expect(canCompleteBuild('canceled')).toBe(false)
  })

  it('reverses only a completed build, and cancels only an open one (B6)', () => {
    expect(canReverseBuild('completed')).toBe(true)
    expect(canReverseBuild('planned')).toBe(false)
    expect(canCancelBuild('planned')).toBe(true)
    expect(canCancelBuild('in_progress')).toBe(true)
    expect(canCancelBuild('completed')).toBe(false)
  })

  // 🛑 The one gate that is NARROWER than `canCancelBuild`, and the asymmetry is
  // the point: an `in_progress` build has written no movements either, so a
  // ledger argument would let it through. The reason it is refused is
  // operational — material may already be cut against the quantity somebody was
  // told to build (plans/products/13 §1.0(a), §1.5).
  it('amends only a planned build — in_progress is cancellable, never amendable', () => {
    expect(canAmendBuild('planned')).toBe(true)
    expect(canAmendBuild('in_progress')).toBe(false)
    expect(canAmendBuild('completed')).toBe(false)
    expect(canAmendBuild('canceled')).toBe(false)
  })

  it('is strictly narrower than the cancellation gate, on every status', () => {
    // Asserted as an implication rather than four literals, so widening
    // `canAmendBuild` later cannot pass while leaving §1.5 broken.
    for (const status of ['planned', 'in_progress', 'completed', 'canceled', null] as const) {
      if (canAmendBuild(status)) expect(canCancelBuild(status)).toBe(true)
    }
    expect(canCancelBuild('in_progress') && !canAmendBuild('in_progress')).toBe(true)
  })
})

describe('the run arithmetic', () => {
  it('counts scrap as started — scrapped units ate their components (B7)', () => {
    expect(unitsStarted(10, 2)).toBe(12)
    expect(componentConsumption(2, unitsStarted(10, 2))).toBe(24)
  })

  it('nets to zero when nothing is scrapped and the standard agrees with the BOM', () => {
    expect(
      buildVariance({
        materialCost: 73220,
        laborCost: 5000,
        overheadCost: 2000,
        producedValue: 80220,
      })
    ).toBe(0)
  })

  it('comes out at exactly the scrapped units x the standard cost', () => {
    // The identity, over a range rather than one example. With `s` scrapped, all
    // three absorbed terms scale on `produced + s` while `producedValue` values
    // only `produced`, so the difference is always `s x standardCost` — which is
    // what B7 sends to account 5090.
    const standardCost = 8022
    const materialPerUnit = 7322
    const laborPerUnit = 500
    const overheadPerUnit = 200
    const produced = 10

    for (const scrapped of [0, 1, 2, 5, 37]) {
      const started = unitsStarted(produced, scrapped)
      expect(
        buildVariance({
          materialCost: materialPerUnit * started,
          laborCost: laborPerUnit * started,
          overheadCost: overheadPerUnit * started,
          producedValue: standardCost * produced,
        })
      ).toBe(scrapped * standardCost)
    }
  })
})

describe('absorbedRunCost', () => {
  it('prefers what the completion form stated over the org rate', () => {
    expect(absorbedRunCost(4200, 500, 12)).toBe(4200)
  })

  it('absorbs the rate over the units STARTED, not the units produced', () => {
    // The choice that makes the variance identity above close.
    expect(absorbedRunCost(undefined, 500, 12)).toBe(6000)
  })

  it('absorbs nothing when no rate is declared', () => {
    // 🛑 Not the same decision `absorbedRate` makes for the part standard, where
    // NULL must survive into storage. Here the field records what a specific run
    // absorbed, and a run under no declared rate absorbed nothing — a fact.
    expect(absorbedRunCost(undefined, null, 12)).toBe(0)
    expect(absorbedRunCost(null, Number.NaN, 12)).toBe(0)
  })

  it('rounds to whole minor units', () => {
    expect(absorbedRunCost(undefined, 33.4, 3)).toBe(100)
    expect(absorbedRunCost(12.6, null, 3)).toBe(13)
  })
})

describe('summarizeBuildCompletion', () => {
  const rates = { laborCostPerUnit: 500, overheadCostPerUnit: 200 }

  it('sums the component lines and values the output at its own standard', () => {
    const summary = summarizeBuildCompletion({
      components: [{ extendedCost: 40_196 }, { extendedCost: 19_020 }],
      producedUnitCost: 6622,
      quantityProduced: 10,
      quantityScrapped: 0,
      rates,
    })

    expect(summary.materialCost).toBe(59_216)
    expect(summary.laborCost).toBe(5_000)
    expect(summary.overheadCost).toBe(2_000)
    expect(summary.producedValue).toBe(66_220)
    expect(summary.varianceAmount).toBe(59_216 + 5_000 + 2_000 - 66_220)
  })

  // ── The invariant per-part absorption must not break ────────────────
  //
  // 🛑 A build's variance closes to exactly ZERO when the rates the RUN absorbs
  // are the rates the produced part's standard was ROLLED from. That is the
  // only mechanical check that `completeBuild` and `rollStandardCost` resolved
  // the same overrides; if they disagree, the gap lands in account 5090 on
  // every completion, on `updatable: false` rows, and no error is raised.
  //
  // `resolveAbsorptionRates` is applied to both sides here exactly as the two
  // production callers apply it (plans/money/tasks/22 §5a).
  describe('closes to zero under per-part absorption', () => {
    const orgRates = { laborCostPerUnit: 500, overheadCostPerUnit: 200 }
    const materialPerUnit = 7_322

    /**
     * One run of 10, no scrap, whose produced part was rolled from `effective`.
     * The standard is built the way the roll builds it: material + absorption.
     */
    const runVariance = (overrides: {
      laborCostPerUnit?: number | null
      overheadCostPerUnit?: number | null
    }) => {
      const effective = resolveAbsorptionRates(orgRates, overrides)
      const standardCost =
        materialPerUnit + (effective.laborCostPerUnit ?? 0) + (effective.overheadCostPerUnit ?? 0)

      return summarizeBuildCompletion({
        components: [{ extendedCost: materialPerUnit * 10 }],
        producedUnitCost: standardCost,
        quantityProduced: 10,
        quantityScrapped: 0,
        rates: effective,
      }).varianceAmount
    }

    it('with no override — the org rate on both sides', () => {
      expect(runVariance({})).toBe(0)
    })

    it('with an override higher than the org rate', () => {
      expect(runVariance({ laborCostPerUnit: 4_500 })).toBe(0)
    })

    it('with a ZERO override — the phantom case', () => {
      expect(runVariance({ laborCostPerUnit: 0, overheadCostPerUnit: 0 })).toBe(0)
    })

    it('with no org rate declared and no override', () => {
      const effective = resolveAbsorptionRates(
        { laborCostPerUnit: null, overheadCostPerUnit: null },
        {}
      )
      const summary = summarizeBuildCompletion({
        components: [{ extendedCost: materialPerUnit * 10 }],
        producedUnitCost: materialPerUnit,
        quantityProduced: 10,
        quantityScrapped: 0,
        rates: effective,
      })
      expect(summary.varianceAmount).toBe(0)
    })

    // The failure this whole section exists to catch: the standard carries the
    // override, the run absorbs the bare org rate. 10 units x ($45.00 - $5.00).
    it('does NOT close when the run absorbs the org rate but the standard did not', () => {
      const standardCost = materialPerUnit + 4_500 + 200
      const summary = summarizeBuildCompletion({
        components: [{ extendedCost: materialPerUnit * 10 }],
        producedUnitCost: standardCost,
        quantityProduced: 10,
        quantityScrapped: 0,
        rates: orgRates,
      })
      expect(summary.varianceAmount).toBe(-40_000)
    })
  })

  it('books the scrapped units whole standard cost to the variance (B7)', () => {
    // 10 good + 2 scrapped, a bill of materials that agrees with the standard.
    const materialPerUnit = 7_322
    const standardCost = 8_022
    const summary = summarizeBuildCompletion({
      components: [{ extendedCost: materialPerUnit * 12 }],
      producedUnitCost: standardCost,
      quantityProduced: 10,
      quantityScrapped: 2,
      rates,
    })

    expect(summary.varianceAmount).toBe(2 * standardCost)
  })

  it('treats a null extended cost as contributing nothing, never as a guess', () => {
    const summary = summarizeBuildCompletion({
      components: [{ extendedCost: 1_000 }, { extendedCost: null }],
      producedUnitCost: 1_000,
      quantityProduced: 1,
      quantityScrapped: 0,
      rates: { laborCostPerUnit: null, overheadCostPerUnit: null },
    })

    // The caller refuses to post such a plan anyway — `missingStandardPartIds`
    // is non-empty — so this only pins that the preview does not invent a cost.
    expect(summary.materialCost).toBe(1_000)
  })
})
