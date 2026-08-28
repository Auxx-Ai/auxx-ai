// packages/lib/src/builds/__tests__/reconcile-order-builds.test.ts
//
// Phase 5's executor — what `reconcileOrderBuilds` READS, in how many queries,
// and what it does when one write blows up
// (plans/products/13-order-build-reconciliation.md §5; events/08 phase 5).
//
// The DECISION is not under test here; `reconcile-policy.test.ts` owns it, pure
// and with no doubles at all. What is under test is the shell around it: the
// order-level gates that need a clock and a settings read, the batching, the
// three-layer never-throw discipline, and the summary.
//
// The collaborators are doubles because every one of them has its own suite —
// the order read (`auto-build-queries`), the settings (`auto-build-settings`),
// the build read (`reconcile-queries`), the three mutations (`build-event`).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import type { BuildRecord } from '../types'

const ORG = 'org_1'
const SYSTEM_USER = 'user_system'
const ORDER = 'ord_1'
const OTHER_ORDER = 'ord_2'
const LIFT = 'part_lift'
const HOIST = 'part_hoist'
const MOTOR = 'part_motor'
const ENABLED_AT = new Date('2026-08-01T00:00:00.000Z')
const PLACED_AT = new Date('2026-08-27T00:00:00.000Z')
const FINGERPRINT = 'fp_now'

const h = vi.hoisted(() => ({
  settings: {
    enabled: true,
    enabledAt: null as Date | null,
    status: 'planned' as const,
    stockRule: 'out_of_stock_only' as 'out_of_stock_only' | 'all_stock_levels',
  },
  /** partId -> stored `part_kind`. Absent reads as `component`. */
  kinds: new Map<string, string>(),
  /** partId -> `part_quantity_on_hand`. */
  onHand: new Map<string, number>(),
  /** partId -> direct subparts. Absent/empty is "no bill of materials". */
  bom: new Map<string, { childId: string; qty: number }[]>(),
  /** orderId -> the builds `readOrderRaisedBuilds` answers with. */
  existing: new Map<string, unknown[]>(),
  /** orderIds whose build read must THROW. */
  readThrows: new Set<string>(),
  /** buildIds/partIds whose mutation must return an `err`. */
  refusals: new Map<string, Error>(),
  /** buildIds/partIds whose mutation must THROW. */
  throws: new Set<string>(),
  createCalls: [] as Record<string, unknown>[],
  amendCalls: [] as Record<string, unknown>[],
  cancelCalls: [] as Record<string, unknown>[],
  nextBuild: 0,
}))

vi.mock('../auto-build-settings', () => ({
  loadAutoBuildSettings: vi.fn(async () => h.settings),
}))

vi.mock('../auto-build-queries', () => ({
  readPartQuantitiesOnHand: vi.fn(async (_db: unknown, _org: string, partIds: string[]) => {
    const map = new Map<string, number>()
    for (const partId of partIds) map.set(partId, h.onHand.get(partId) ?? 0)
    return map
  }),
}))

vi.mock('../build-queries', () => ({
  readPartKinds: vi.fn(async (_db: unknown, _org: string, partIds: string[]) => {
    const map = new Map<string, string>()
    for (const partId of partIds) {
      const kind = h.kinds.get(partId)
      if (kind) map.set(partId, kind)
    }
    return map
  }),
}))

vi.mock('../../bom/subpart-graph', () => ({
  loadDirectSubparts: vi.fn(async (_db: unknown, _org: string, partId: string) => {
    return h.bom.get(partId) ?? []
  }),
}))

vi.mock('../reconcile-queries', () => ({
  readOrderRaisedBuilds: vi.fn(async (_db: unknown, _org: string, orderId: string) => {
    if (h.readThrows.has(orderId)) throw new Error(`build read failed for ${orderId}`)
    return h.existing.get(orderId) ?? []
  }),
}))

vi.mock('../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: vi.fn(async () => SYSTEM_USER) },
}))

vi.mock('../build-mutations', () => {
  /** One doubled mutation: record the call, then honour the fixture's verdict. */
  const writer =
    (log: Record<string, unknown>[], keyOf: (input: Record<string, unknown>) => string) =>
    async (_db: unknown, _org: string, _userId: string, input: Record<string, unknown>) => {
      log.push(input)
      const key = keyOf(input)
      if (h.throws.has(key)) throw new Error(`boom for ${key}`)
      const { err, ok } = await import('neverthrow')
      const refusal = h.refusals.get(key)
      if (refusal) return err(refusal)
      h.nextBuild += 1
      return ok({ buildId: `bld_${h.nextBuild}` })
    }

  return {
    createBuild: vi.fn(writer(h.createCalls, (input) => String(input.partId))),
    amendPlannedBuildQuantity: vi.fn(writer(h.amendCalls, (input) => String(input.buildId))),
    cancelBuild: vi.fn(writer(h.cancelCalls, (input) => String(input.buildId))),
  }
})

import { type ReconcileOrderInput, reconcileOrderBuilds } from '../reconcile-order-builds'

let sequence = 0

/** A `planned`, order-raised build of 3 lifts. */
function build(overrides: Partial<BuildRecord> = {}): BuildRecord {
  sequence += 1
  return {
    buildId: `build_${sequence}`,
    recordId: `def_build:build_${sequence}`,
    number: null,
    partId: LIFT,
    status: 'planned',
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
    orderId: ORDER,
    source: 'order',
    reversalOfBuildId: null,
    orderRevision: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as BuildRecord
}

/** A buildable part: classified, with a bill of materials. */
function makeBuildable(partId: string, kind = 'finished_good'): void {
  h.kinds.set(partId, kind)
  h.bom.set(partId, [{ childId: MOTOR, qty: 2 }])
}

function order(overrides: Partial<ReconcileOrderInput> = {}): ReconcileOrderInput {
  return {
    orderId: ORDER,
    placedAt: PLACED_AT,
    cancelledAt: null,
    lines: [{ partId: LIFT, quantity: 3 }],
    fingerprint: FINGERPRINT,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.settings = {
    enabled: true,
    enabledAt: ENABLED_AT,
    status: 'planned',
    stockRule: 'out_of_stock_only',
  }
  h.kinds = new Map()
  h.onHand = new Map()
  h.bom = new Map()
  h.existing = new Map()
  h.readThrows = new Set()
  h.refusals = new Map()
  h.throws = new Set()
  // Emptied in place, NEVER reassigned: the mutation doubles closed over these
  // exact arrays when the module factory ran, and a fresh `[]` would silently
  // detach every assertion below from what the writers actually recorded.
  h.createCalls.length = 0
  h.amendCalls.length = 0
  h.cancelCalls.length = 0
  h.nextBuild = 0
})

async function run(orders: ReconcileOrderInput[]) {
  const result = await reconcileOrderBuilds({} as never, ORG, orders)
  expect(result.isOk()).toBe(true)
  return result._unsafeUnwrap()
}

function reasons(summary: Awaited<ReturnType<typeof run>>): string[] {
  return summary.skipped.map((skip) => skip.reason)
}

// ─── the order-level gates ──────────────────────────────────────────────

describe('the switch', () => {
  it('does nothing at all while `inventory.autoBuildFromOrders` is off', async () => {
    h.settings.enabled = false
    makeBuildable(LIFT)

    const summary = await run([order()])

    expect(reasons(summary)).toEqual(['disabled'])
    expect(summary.ordersConsidered).toBe(0)
    expect(h.createCalls).toEqual([])
    // It also settles the seed lane by construction: the setting is off by
    // default, so a seeded demo order manufactures nothing (plan 13 §5).
  })

  it('returns an empty summary for an empty batch, reading nothing', async () => {
    const summary = await run([])

    expect(summary).toEqual({
      ordersConsidered: 0,
      raised: [],
      amended: [],
      cancelled: [],
      skipped: [],
      failed: [],
    })
    const { loadAutoBuildSettings } = await import('../auto-build-settings')
    expect(loadAutoBuildSettings).not.toHaveBeenCalled()
  })
})

describe('🛑 a CANCELLED order is left alone (plan 13 §5, AB6)', () => {
  it('touches no build and does not even read them', async () => {
    makeBuildable(LIFT)
    h.existing.set(ORDER, [build()])

    const summary = await run([
      order({ cancelledAt: new Date('2026-08-28T00:00:00.000Z'), lines: [] }),
    ])

    // Naive convergence would cancel every planned build here — duplicating
    // `cancelAutoBuildsForOrders`, which already does that AND reverses a
    // `completed` build, and which is deliberately NOT gated on the feature
    // switch so builds already raised are never stranded. Two paths writing the
    // same builds is worse than one.
    expect(reasons(summary)).toEqual(['order-cancelled'])
    expect(summary.ordersConsidered).toBe(0)
    expect(h.cancelCalls).toEqual([])
    const { readOrderRaisedBuilds } = await import('../reconcile-queries')
    expect(readOrderRaisedBuilds).not.toHaveBeenCalled()
  })

  it('still reconciles the OTHER orders in the batch', async () => {
    makeBuildable(LIFT)

    const summary = await run([
      order({ cancelledAt: new Date('2026-08-28T00:00:00.000Z') }),
      order({ orderId: OTHER_ORDER }),
    ])

    expect(summary.raised.map((r) => r.orderId)).toEqual([OTHER_ORDER])
  })
})

describe('the enablement window (AB8 / plan 13 Q11)', () => {
  it('🛑 raises nothing for an order placed BEFORE the switch was turned on', async () => {
    makeBuildable(LIFT)

    const summary = await run([order({ placedAt: new Date('2020-01-01T00:00:00.000Z') })])

    // Under Model B a reconcile IS a raise door — the whole interactive-path fix
    // is "a late line raises the first build" — so an unwindowed apply means
    // editing any back-filled order manufactures against years of history.
    expect(reasons(summary)).toEqual(['before-enablement'])
    expect(h.createCalls).toEqual([])
  })

  it('raises nothing at all when no enablement stamp was ever recorded', async () => {
    h.settings.enabledAt = null
    makeBuildable(LIFT)

    const summary = await run([order(), order({ orderId: OTHER_ORDER })])

    expect(reasons(summary)).toEqual(['before-enablement', 'before-enablement'])
  })
})

// ─── the writes ─────────────────────────────────────────────────────────

describe('what it writes', () => {
  it('raises for the whole ordered quantity, stamped with the order and the fingerprint', async () => {
    makeBuildable(LIFT)

    const summary = await run([order()])

    expect(h.createCalls).toEqual([
      {
        partId: LIFT,
        quantityPlanned: 3,
        orderId: ORDER,
        source: 'order',
        orderRevision: FINGERPRINT,
      },
    ])
    expect(summary.raised).toEqual([
      { orderId: ORDER, partId: LIFT, buildId: 'bld_1', quantityPlanned: 3 },
    ])
  })

  it('amends a planned build the order outgrew, re-stamping in the SAME call (Q3)', async () => {
    makeBuildable(LIFT)
    const existing = build({ quantityPlanned: 1 })
    h.existing.set(ORDER, [existing])

    const summary = await run([order()])

    expect(h.amendCalls).toEqual([
      { buildId: existing.buildId, quantityPlanned: 3, orderRevision: FINGERPRINT },
    ])
    expect(summary.amended).toEqual([
      { orderId: ORDER, partId: LIFT, buildId: existing.buildId, from: 1, to: 3 },
    ])
    expect(h.createCalls).toEqual([])
  })

  it('cancels — never deletes — a planned build for a part the order dropped', async () => {
    makeBuildable(LIFT)
    const existing = build()
    h.existing.set(ORDER, [existing])

    // Every line deleted. This order is NOT skipped for having no parts: "the
    // order wants nothing" is a real instruction here, unlike at raise time.
    const summary = await run([order({ lines: [] })])

    expect(h.cancelCalls).toEqual([{ buildId: existing.buildId, reason: 'Order changed' }])
    expect(summary.cancelled).toEqual([{ orderId: ORDER, partId: LIFT, buildId: existing.buildId }])
  })

  it('records the no-op as `already-current` and writes nothing', async () => {
    makeBuildable(LIFT)
    h.existing.set(ORDER, [build({ quantityPlanned: 3 })])

    const summary = await run([order()])

    expect(reasons(summary)).toEqual(['already-current'])
    expect(h.createCalls).toEqual([])
    expect(h.amendCalls).toEqual([])
    expect(h.cancelCalls).toEqual([])
  })

  it('writes as the org SYSTEM user — there is no human in the call stack', async () => {
    makeBuildable(LIFT)

    await run([order()])

    const { createBuild } = await import('../build-mutations')
    expect(createBuild).toHaveBeenCalledWith({}, ORG, SYSTEM_USER, expect.anything())
  })
})

// ─── batching ───────────────────────────────────────────────────────────

describe('batching (as the deleted `runAutoBuildForOrders` did)', () => {
  it('reads the part kinds, quantities, BOM and system user ONCE for the whole batch', async () => {
    makeBuildable(LIFT)

    await run([order(), order({ orderId: OTHER_ORDER })])

    const { readPartKinds } = await import('../build-queries')
    const { readPartQuantitiesOnHand } = await import('../auto-build-queries')
    const { loadDirectSubparts } = await import('../../bom/subpart-graph')
    const { SystemUserService } = await import('../../users/system-user-service')

    expect(readPartKinds).toHaveBeenCalledTimes(1)
    expect(readPartKinds).toHaveBeenCalledWith({}, ORG, [LIFT])
    expect(readPartQuantitiesOnHand).toHaveBeenCalledTimes(1)
    // One BOM read per DISTINCT part, not per order.
    expect(loadDirectSubparts).toHaveBeenCalledTimes(1)
    expect(SystemUserService.getSystemUserForActions).toHaveBeenCalledTimes(1)
    // Batching the READS never collapses the WRITES: two orders, two builds.
    expect(h.createCalls).toHaveLength(2)
  })

  it('never reads the bill of materials for a part it has already ruled out', async () => {
    h.kinds.set(LIFT, 'component')

    await run([order()])

    const { loadDirectSubparts } = await import('../../bom/subpart-graph')
    expect(loadDirectSubparts).not.toHaveBeenCalled()
  })

  it('reads the existing builds ONCE PER ORDER — `listBuilds` has no multi-order filter', async () => {
    makeBuildable(LIFT)

    await run([order(), order({ orderId: OTHER_ORDER })])

    const { readOrderRaisedBuilds } = await import('../reconcile-queries')
    expect(readOrderRaisedBuilds).toHaveBeenCalledTimes(2)
  })

  it('reads only the parts the orders WANT, not the parts of existing builds', async () => {
    makeBuildable(LIFT)
    // A build for a part no line mentions any more. It needs no kind, no BOM and
    // no stock level to be cancelled.
    h.existing.set(ORDER, [build({ partId: HOIST })])

    await run([order()])

    const { readPartKinds } = await import('../build-queries')
    expect(readPartKinds).toHaveBeenCalledWith({}, ORG, [LIFT])
    expect(h.cancelCalls).toHaveLength(1)
  })
})

// ─── never throw ────────────────────────────────────────────────────────

describe('🛑 never throw — three layers of isolation', () => {
  it('an action a mutation REFUSES still leaves the rest of the order converged', async () => {
    makeBuildable(LIFT)
    makeBuildable(HOIST, 'subassembly')
    h.refusals.set(LIFT, new UnprocessableEntityError('no bill of materials'))

    const summary = await run([
      order({
        lines: [
          { partId: LIFT, quantity: 1 },
          { partId: HOIST, quantity: 2 },
        ],
      }),
    ])

    expect(summary.raised.map((r) => r.partId)).toEqual([HOIST])
    expect(summary.failed).toEqual([
      { orderId: ORDER, partId: LIFT, buildId: null, message: 'no bill of materials' },
    ])
  })

  it('an action that THROWS still leaves the rest of the order converged', async () => {
    makeBuildable(LIFT)
    makeBuildable(HOIST, 'subassembly')
    const doomed = build({ partId: LIFT, quantityPlanned: 1 })
    h.existing.set(ORDER, [doomed])
    h.throws.add(doomed.buildId)

    const summary = await run([
      order({
        lines: [
          { partId: LIFT, quantity: 5 },
          { partId: HOIST, quantity: 2 },
        ],
      }),
    ])

    expect(summary.raised.map((r) => r.partId)).toEqual([HOIST])
    expect(summary.failed).toEqual([
      {
        orderId: ORDER,
        partId: LIFT,
        buildId: doomed.buildId,
        message: `boom for ${doomed.buildId}`,
      },
    ])
  })

  it('an order whose BUILD READ fails does not lose the other orders', async () => {
    makeBuildable(LIFT)
    h.readThrows.add(ORDER)

    const summary = await run([order(), order({ orderId: OTHER_ORDER })])

    // A read that cannot be trusted must not be reconciled against: an empty
    // result would read as "this order raised nothing" and raise everything a
    // second time.
    expect(summary.ordersConsidered).toBe(1)
    expect(summary.raised.map((r) => r.orderId)).toEqual([OTHER_ORDER])
    expect(summary.failed).toEqual([
      {
        orderId: ORDER,
        partId: null,
        buildId: null,
        message: `build read failed for ${ORDER}`,
      },
    ])
  })

  it('an order whose every action throws does not lose the other orders', async () => {
    makeBuildable(LIFT)
    makeBuildable(HOIST, 'subassembly')
    h.throws.add(LIFT)

    const summary = await run([
      order(),
      order({ orderId: OTHER_ORDER, lines: [{ partId: HOIST, quantity: 1 }] }),
    ])

    expect(summary.ordersConsidered).toBe(2)
    expect(summary.raised.map((r) => r.orderId)).toEqual([OTHER_ORDER])
    expect(summary.failed.map((f) => f.orderId)).toEqual([ORDER])
  })

  it('returns an err rather than throwing when the SETTINGS read fails', async () => {
    const settings = await import('../auto-build-settings')
    vi.mocked(settings.loadAutoBuildSettings).mockRejectedValueOnce(new Error('db is on fire'))

    const result = await reconcileOrderBuilds({} as never, ORG, [order()])

    expect(result.isErr()).toBe(true)
  })
})

// ─── the summary ────────────────────────────────────────────────────────

describe('the summary', () => {
  it('carries every outcome with the ids a person needs to go and look', async () => {
    makeBuildable(LIFT)
    makeBuildable(HOIST, 'subassembly')
    const amendable = build({ partId: LIFT, quantityPlanned: 1 })
    const orphan = build({ partId: HOIST })
    const manual = build({ partId: LIFT, source: 'manual' })
    h.existing.set(ORDER, [amendable, orphan, manual])

    const summary = await run([order({ lines: [{ partId: LIFT, quantity: 4 }] })])

    expect(summary.ordersConsidered).toBe(1)
    expect(summary.amended).toEqual([
      { orderId: ORDER, partId: LIFT, buildId: amendable.buildId, from: 1, to: 4 },
    ])
    expect(summary.cancelled).toEqual([{ orderId: ORDER, partId: HOIST, buildId: orphan.buildId }])
    expect(summary.skipped).toEqual([
      { orderId: ORDER, partId: LIFT, buildId: manual.buildId, reason: 'not-order-raised' },
    ])
    expect(summary.raised).toEqual([])
    expect(summary.failed).toEqual([])
  })
})
