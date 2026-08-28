// packages/lib/src/builds/__tests__/build-client.test.ts
//
// The pure half of the build event: the status gates and the variance
// arithmetic. No doubles of any kind — everything here is a total function of
// its arguments, which is what lets the B7 identity below be asserted as an
// identity rather than as one worked example.

import { describe, expect, it } from 'vitest'
import {
  buildVariance,
  canCancelBuild,
  canCompleteBuild,
  canReverseBuild,
  canStartBuild,
  componentConsumption,
  resolveBuildStatus,
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
