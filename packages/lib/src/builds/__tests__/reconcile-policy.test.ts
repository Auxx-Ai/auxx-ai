// packages/lib/src/builds/__tests__/reconcile-policy.test.ts
//
// The whole of Model B's decision, with no database in sight
// (plans/products/13-order-build-reconciliation.md §5, Q3/Q5/Q7/Q11/Q12;
// events/08 phase 5). Pure — no doubles, no mocks, nothing to set up.

import { describe, expect, it } from 'vitest'
import type { AutoBuildStockRule } from '../auto-build-policy'
import type { BuildStatusValue } from '../client'
import {
  type BuildConvergenceAction,
  type OrderBuildConvergenceInput,
  planOrderBuildConvergence,
} from '../reconcile-policy'
import type { BuildRecord } from '../types'

const LIFT = 'part_lift'
const HOIST = 'part_hoist'
const BOLT = 'part_bolt'

let sequence = 0

/** A build row with everything convergence looks at, and defaults for the rest. */
function build(overrides: Partial<BuildRecord> = {}): BuildRecord {
  sequence += 1
  return {
    buildId: `build_${sequence}`,
    recordId: `def:build_${sequence}`,
    number: null,
    partId: LIFT,
    status: 'planned' as BuildStatusValue,
    quantityPlanned: 3,
    quantityProduced: null,
    quantityScrapped: null,
    startedAt: null,
    completedAt: null,
    materialCost: null,
    laborCost: null,
    overheadCost: null,
    producedValue: null,
    varianceAmount: null,
    postedAt: null,
    notes: null,
    orderId: 'order_1',
    source: 'order',
    reversalOfBuildId: null,
    orderRevision: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }
}

/**
 * The happy-path world: every part is a `finished_good` with a bill of materials
 * and nothing on the shelf, so admission turns entirely on what the test varies.
 */
function input(overrides: Partial<OrderBuildConvergenceInput> = {}): OrderBuildConvergenceInput {
  return {
    desired: new Map<string, number>(),
    existing: [],
    partKinds: new Map([
      [LIFT, 'finished_good'],
      [HOIST, 'subassembly'],
      [BOLT, 'component'],
    ]),
    hasBom: new Map([
      [LIFT, true],
      [HOIST, true],
    ]),
    quantitiesOnHand: new Map<string, number>(),
    stockRule: 'out_of_stock_only' as AutoBuildStockRule,
    ...overrides,
  }
}

function plan(overrides: Partial<OrderBuildConvergenceInput> = {}): BuildConvergenceAction[] {
  return planOrderBuildConvergence(input(overrides)).actions
}

const writes = (actions: BuildConvergenceAction[]) => actions.filter((a) => a.kind !== 'skip')

describe('no build yet — the admission tests (12 §5.3 steps 2, 3, 4)', () => {
  it('raises for the WHOLE ordered quantity when the part passes all three (Q5)', () => {
    expect(plan({ desired: new Map([[LIFT, 5]]) })).toEqual([
      { kind: 'raise', partId: LIFT, quantity: 5 },
    ])
  })

  it('never subtracts on-hand stock from the quantity — covered or not at all (Q5)', () => {
    // 4 on the shelf against 5 ordered is NOT covered, and the build is for 5.
    expect(plan({ desired: new Map([[LIFT, 5]]), quantitiesOnHand: new Map([[LIFT, 4]]) })).toEqual(
      [{ kind: 'raise', partId: LIFT, quantity: 5 }]
    )
  })

  it('skips a component — purchased, not built', () => {
    expect(plan({ desired: new Map([[BOLT, 2]]) })).toEqual([
      { kind: 'skip', partId: BOLT, buildId: null, reason: 'not-a-built-part' },
    ])
  })

  it('skips an unclassified part, because a NULL part_kind reads as component', () => {
    expect(plan({ desired: new Map([['part_mystery', 2]]) })).toEqual([
      { kind: 'skip', partId: 'part_mystery', buildId: null, reason: 'not-a-built-part' },
    ])
  })

  it('skips a built part with no bill of materials — a build would consume nothing', () => {
    expect(plan({ desired: new Map([[LIFT, 2]]), hasBom: new Map([[LIFT, false]]) })).toEqual([
      { kind: 'skip', partId: LIFT, buildId: null, reason: 'no-bill-of-materials' },
    ])
  })

  it('skips a part the shelf already covers (AB4)', () => {
    expect(plan({ desired: new Map([[LIFT, 3]]), quantitiesOnHand: new Map([[LIFT, 3]]) })).toEqual(
      [{ kind: 'skip', partId: LIFT, buildId: null, reason: 'covered-by-stock' }]
    )
  })

  it('ignores coverage entirely under all_stock_levels', () => {
    expect(
      plan({
        desired: new Map([[LIFT, 3]]),
        quantitiesOnHand: new Map([[LIFT, 1000]]),
        stockRule: 'all_stock_levels',
      })
    ).toEqual([{ kind: 'raise', partId: LIFT, quantity: 3 }])
  })

  it('tests kind before the bill of materials, exactly as the raise path does', () => {
    expect(plan({ desired: new Map([[BOLT, 2]]) })[0]).toMatchObject({
      reason: 'not-a-built-part',
    })
  })
})

describe('a planned build exists — converge its quantity (Q3, the order wins)', () => {
  it('amends when the order now says something else', () => {
    const existing = [build({ buildId: 'b1', quantityPlanned: 3 })]
    expect(plan({ desired: new Map([[LIFT, 5]]), existing })).toEqual([
      { kind: 'amend', buildId: 'b1', partId: LIFT, from: 3, to: 5 },
    ])
  })

  it('amends DOWNWARD too — convergence is not a ratchet', () => {
    const existing = [build({ buildId: 'b1', quantityPlanned: 9 })]
    expect(plan({ desired: new Map([[LIFT, 2]]), existing })).toEqual([
      { kind: 'amend', buildId: 'b1', partId: LIFT, from: 9, to: 2 },
    ])
  })

  it('overwrites a human edit to a planned order-raised build (Q3 — not durable)', () => {
    // Somebody bumped 3 -> 4 for scrap allowance. The order says 3, so it goes.
    const existing = [build({ buildId: 'b1', quantityPlanned: 4 })]
    expect(plan({ desired: new Map([[LIFT, 3]]), existing })).toEqual([
      { kind: 'amend', buildId: 'b1', partId: LIFT, from: 4, to: 3 },
    ])
  })

  it('amends a build whose quantity was never set, reporting from: null', () => {
    const existing = [build({ buildId: 'b1', quantityPlanned: null })]
    expect(plan({ desired: new Map([[LIFT, 3]]), existing })).toEqual([
      { kind: 'amend', buildId: 'b1', partId: LIFT, from: null, to: 3 },
    ])
  })

  it('is a no-op when the build already says what the order says', () => {
    const existing = [build({ buildId: 'b1', quantityPlanned: 3 })]
    const result = planOrderBuildConvergence(input({ desired: new Map([[LIFT, 3]]), existing }))
    expect(result.actions).toEqual([
      { kind: 'skip', partId: LIFT, buildId: 'b1', reason: 'already-current' },
    ])
    expect(result.hasWrites).toBe(false)
  })

  it('cancels when the part is gone from the order — never deletes (AB6)', () => {
    const existing = [build({ buildId: 'b1' })]
    expect(plan({ desired: new Map(), existing })).toEqual([
      { kind: 'cancel', buildId: 'b1', partId: LIFT },
    ])
  })

  it('cancels when the line survives but its quantity resolves to nothing', () => {
    const existing = [build({ buildId: 'b1' })]
    for (const quantity of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(plan({ desired: new Map([[LIFT, quantity]]), existing })).toEqual([
        { kind: 'cancel', buildId: 'b1', partId: LIFT },
      ])
    }
  })

  it('does NOT re-test stock coverage on an existing pair (Q7 — raise only)', () => {
    // The shelf now covers all 5. Q7: builds must not appear and disappear as
    // unrelated orders consume unreserved stock.
    const existing = [build({ buildId: 'b1', quantityPlanned: 3 })]
    expect(
      plan({
        desired: new Map([[LIFT, 5]]),
        existing,
        quantitiesOnHand: new Map([[LIFT, 500]]),
      })
    ).toEqual([{ kind: 'amend', buildId: 'b1', partId: LIFT, from: 3, to: 5 }])
  })
})

describe('🛑 Q12 — coverage is decided once per (order, part) PAIR, at first admission', () => {
  it('raises for a part whose only build was cancelled, EVEN WHEN stock covers it', () => {
    // This is the answer to Q12 and the reason `canceled` builds are read at
    // all. Read Q7 as "once ever per order" and this part could never build
    // again — a permanent hole where the projection stops projecting (13 §0).
    const existing = [build({ buildId: 'b1', status: 'canceled', quantityPlanned: 3 })]
    expect(
      plan({
        desired: new Map([[LIFT, 3]]),
        existing,
        quantitiesOnHand: new Map([[LIFT, 999]]),
      })
    ).toEqual([{ kind: 'raise', partId: LIFT, quantity: 3 }])
  })

  it('still applies the kind and BOM tests to a re-admitted pair', () => {
    const existing = [build({ buildId: 'b1', partId: HOIST, status: 'canceled' })]
    expect(
      plan({ desired: new Map([[HOIST, 2]]), existing, hasBom: new Map([[HOIST, false]]) })
    ).toEqual([{ kind: 'skip', partId: HOIST, buildId: null, reason: 'no-bill-of-materials' }])
  })

  it('emits nothing at all for a cancelled pair the order no longer wants', () => {
    const existing = [build({ buildId: 'b1', status: 'canceled' })]
    const result = planOrderBuildConvergence(input({ desired: new Map(), existing }))
    expect(result.actions).toEqual([])
    expect(result.hasWrites).toBe(false)
  })

  it('a cancelled build never produces a skip row of its own — it is terminal', () => {
    const existing = [build({ buildId: 'b1', status: 'canceled' })]
    expect(plan({ desired: new Map([[LIFT, 4]]), existing })).toEqual([
      { kind: 'raise', partId: LIFT, quantity: 4 },
    ])
  })
})

describe('🛑 the rails — 13 §5, one test each', () => {
  it('never touches a source: manual build, whatever the order says', () => {
    const manual = build({ buildId: 'b1', source: 'manual', quantityPlanned: 3 })
    for (const desired of [new Map([[LIFT, 9]]), new Map<string, number>()]) {
      const actions = plan({ desired, existing: [manual] })
      expect(actions).toContainEqual({
        kind: 'skip',
        partId: LIFT,
        buildId: 'b1',
        reason: 'not-order-raised',
      })
      expect(writes(actions).some((a) => 'buildId' in a && a.buildId === 'b1')).toBe(false)
    }
  })

  it('treats a build with no source the same way — a row predating the field', () => {
    const legacy = build({ buildId: 'b1', source: null })
    expect(plan({ desired: new Map(), existing: [legacy] })).toEqual([
      { kind: 'skip', partId: LIFT, buildId: 'b1', reason: 'not-order-raised' },
    ])
  })

  it('a manual build does NOT block the order raising its own (AB7 — they coexist)', () => {
    const manual = build({ buildId: 'b1', source: 'manual' })
    expect(plan({ desired: new Map([[LIFT, 5]]), existing: [manual] })).toEqual([
      { kind: 'skip', partId: LIFT, buildId: 'b1', reason: 'not-order-raised' },
      { kind: 'raise', partId: LIFT, quantity: 5 },
    ])
  })

  it('never amends or cancels a completed build — B6/B8, reversed not edited', () => {
    const completed = build({ buildId: 'b1', status: 'completed', quantityPlanned: 3 })
    for (const desired of [new Map([[LIFT, 9]]), new Map<string, number>()]) {
      const actions = plan({ desired, existing: [completed] })
      expect(actions).toEqual([
        { kind: 'skip', partId: LIFT, buildId: 'b1', reason: 'completed-immutable' },
      ])
    }
  })

  it('never reverses either — an edited line is not a cancelled order (AB6)', () => {
    const completed = build({ buildId: 'b1', status: 'completed' })
    const actions = plan({ desired: new Map(), existing: [completed] })
    expect(writes(actions)).toEqual([])
  })

  it('never amends an in_progress build — material may already be cut (§1.0(a))', () => {
    const started = build({ buildId: 'b1', status: 'in_progress', quantityPlanned: 3 })
    expect(plan({ desired: new Map([[LIFT, 9]]), existing: [started] })).toEqual([
      { kind: 'skip', partId: LIFT, buildId: 'b1', reason: 'in-progress-not-amendable' },
    ])
  })

  it('does not CANCEL an in_progress build either — that is the AB6 sweep, not this pass', () => {
    const started = build({ buildId: 'b1', status: 'in_progress' })
    const actions = plan({ desired: new Map(), existing: [started] })
    expect(writes(actions)).toEqual([])
    expect(actions).toEqual([
      { kind: 'skip', partId: LIFT, buildId: 'b1', reason: 'in-progress-not-amendable' },
    ])
  })

  it('skips a reversing build BEFORE reading its status — a reversal lands completed', () => {
    // `reverseBuild` copies the original's source and lands the reversal
    // `completed`, so a status-first classification would mislabel it.
    const reversal = build({
      buildId: 'b2',
      status: 'completed',
      reversalOfBuildId: 'b1',
      quantityPlanned: null,
    })
    expect(plan({ desired: new Map([[LIFT, 5]]), existing: [reversal] })).toContainEqual({
      kind: 'skip',
      partId: LIFT,
      buildId: 'b2',
      reason: 'is-a-reversal',
    })
  })

  it('refuses to treat a null status as amendable, and refuses to build beside it', () => {
    // `resolveBuildStatus` deliberately never defaults to `planned`. A row whose
    // lifecycle nobody can state might BE a planned build with a broken option
    // value, so creating a record next to it is not a recoverable mistake.
    const broken = build({ buildId: 'b1', status: null, quantityPlanned: 3 })
    const actions = plan({ desired: new Map([[LIFT, 9]]), existing: [broken] })
    expect(actions).toEqual([
      { kind: 'skip', partId: LIFT, buildId: 'b1', reason: 'unknown-status' },
    ])
    expect(writes(actions)).toEqual([])
  })

  it('is total — no input throws, including empty everything', () => {
    expect(() => planOrderBuildConvergence(input())).not.toThrow()
    expect(() =>
      planOrderBuildConvergence({
        desired: new Map([['', Number.NaN]]),
        existing: [build({ partId: null, status: null, source: null, createdAt: new Date(0) })],
        partKinds: new Map(),
        hasBom: new Map(),
        quantitiesOnHand: new Map(),
        stockRule: 'out_of_stock_only',
      })
    ).not.toThrow()
  })

  it('drops a build with no part rather than inventing a pair for it', () => {
    expect(plan({ desired: new Map(), existing: [build({ partId: null })] })).toEqual([])
  })
})

describe('🛑 several builds for one pair — the pre-existing duplicate hazard (13 §1.4)', () => {
  const older = build({
    buildId: 'b_old',
    quantityPlanned: 3,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  })
  const newer = build({
    buildId: 'b_new',
    quantityPlanned: 3,
    createdAt: new Date('2026-08-02T00:00:00.000Z'),
  })

  it('amends exactly ONE — the oldest — and skips the rest as duplicates', () => {
    // Amending both would put 10 units on the floor for an order of 5.
    expect(plan({ desired: new Map([[LIFT, 5]]), existing: [newer, older] })).toEqual([
      { kind: 'amend', buildId: 'b_old', partId: LIFT, from: 3, to: 5 },
      { kind: 'skip', partId: LIFT, buildId: 'b_new', reason: 'duplicate-build' },
    ])
  })

  it('picks the same primary however the rows arrive', () => {
    const forwards = plan({ desired: new Map([[LIFT, 5]]), existing: [older, newer] })
    const backwards = plan({ desired: new Map([[LIFT, 5]]), existing: [newer, older] })
    expect(forwards).toEqual(backwards)
  })

  it('cancels EVERY planned duplicate when the part is no longer wanted', () => {
    // The asymmetry with amend is deliberate: cancelling writes no movements
    // (B2), and cancelling only the oldest would leave a live build for a part
    // the order does not want — 13 §0's defect, re-created by this very pass.
    expect(plan({ desired: new Map(), existing: [newer, older] })).toEqual([
      { kind: 'cancel', buildId: 'b_old', partId: LIFT },
      { kind: 'cancel', buildId: 'b_new', partId: LIFT },
    ])
  })

  it('never raises beside an existing active build — no top-up builds', () => {
    const started = build({ buildId: 'b1', status: 'in_progress', quantityPlanned: 1 })
    const actions = plan({ desired: new Map([[LIFT, 20]]), existing: [started] })
    expect(actions.some((a) => a.kind === 'raise')).toBe(false)
  })

  it('a completed build blocks a re-raise, even once it has been reversed', () => {
    // Conservative on purpose: automation must not read "reversed" as "build it
    // again". The escape hatch is a source: manual build (13 Q3).
    const completed = build({ buildId: 'b1', status: 'completed' })
    const reversal = build({ buildId: 'b2', status: 'completed', reversalOfBuildId: 'b1' })
    const actions = plan({ desired: new Map([[LIFT, 3]]), existing: [completed, reversal] })
    expect(writes(actions)).toEqual([])
  })
})

describe('the whole-order pass', () => {
  it('handles raise, amend, cancel and skip across four parts in one plan', () => {
    const result = planOrderBuildConvergence(
      input({
        desired: new Map([
          [LIFT, 5],
          [HOIST, 2],
          [BOLT, 7],
        ]),
        existing: [
          build({ buildId: 'b_lift', partId: LIFT, quantityPlanned: 3 }),
          build({ buildId: 'b_gone', partId: 'part_gone', quantityPlanned: 1 }),
        ],
        partKinds: new Map([
          [LIFT, 'finished_good'],
          [HOIST, 'subassembly'],
          [BOLT, 'component'],
          ['part_gone', 'finished_good'],
        ]),
        hasBom: new Map([
          [LIFT, true],
          [HOIST, true],
          ['part_gone', true],
        ]),
      })
    )

    expect(result.hasWrites).toBe(true)
    expect(result.actions).toEqual([
      { kind: 'skip', partId: BOLT, buildId: null, reason: 'not-a-built-part' },
      { kind: 'cancel', buildId: 'b_gone', partId: 'part_gone' },
      { kind: 'raise', partId: HOIST, quantity: 2 },
      { kind: 'amend', buildId: 'b_lift', partId: LIFT, from: 3, to: 5 },
    ])
  })

  it('is empty for an order with no demand and no builds', () => {
    const result = planOrderBuildConvergence(input())
    expect(result.actions).toEqual([])
    expect(result.hasWrites).toBe(false)
  })

  it('cancels every planned build when the order loses all its lines', () => {
    const existing = [
      build({ buildId: 'b1', partId: LIFT }),
      build({ buildId: 'b2', partId: HOIST }),
    ]
    expect(plan({ desired: new Map(), existing })).toEqual([
      { kind: 'cancel', buildId: 'b2', partId: HOIST },
      { kind: 'cancel', buildId: 'b1', partId: LIFT },
    ])
  })

  it('orders parts by id, so the plan is comparable between runs', () => {
    const actions = plan({
      desired: new Map([
        [LIFT, 1],
        [HOIST, 1],
      ]),
    })
    expect(actions.map((a) => a.partId)).toEqual([HOIST, LIFT])
  })

  it('reports hasWrites false when every action is a skip', () => {
    const result = planOrderBuildConvergence(
      input({
        desired: new Map([[BOLT, 4]]),
        existing: [build({ buildId: 'b1', status: 'completed' })],
      })
    )
    expect(result.actions.every((a) => a.kind === 'skip')).toBe(true)
    expect(result.hasWrites).toBe(false)
  })
})
