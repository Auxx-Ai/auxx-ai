// packages/lib/src/builds/__tests__/auto-build.test.ts
//
// Phase 3a — what `runAutoBuildForOrders` raises, what it declines, and what it
// does when one part blows up (plans/products/12-order-triggered-build.md §5.3).
//
// The collaborators are doubles because every one of them is already covered by
// its own suite: the order/line read (`auto-build-queries`), the settings read
// (`auto-build-settings`), the part-kind read and `createBuild` itself
// (`build-event.test.ts`). What is under test here is the DECISION SEQUENCE —
// which is the whole of this phase, and the part a mocked db double would only
// obscure.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../errors'

const ORG = 'org_1'
const SYSTEM_USER = 'user_system'
const ORDER = 'ord_1'
const OTHER_ORDER = 'ord_2'
const LIFT = 'part_lift'
const HOIST = 'part_hoist'
const MOTOR = 'part_motor'
const ENABLED_AT = new Date('2026-08-01T00:00:00.000Z')

interface FixtureOrder {
  orderId: string
  placedAt: Date
  cancelledAt: Date | null
  lines: { partId: string; quantity: number }[]
}

const h = vi.hoisted(() => ({
  settings: {
    enabled: true,
    enabledAt: null as Date | null,
    status: 'planned' as const,
    stockRule: 'out_of_stock_only' as 'out_of_stock_only' | 'all_stock_levels',
  },
  orders: [] as FixtureOrder[],
  /** partId -> stored `part_kind` option value. Absent reads as `component`. */
  kinds: new Map<string, string>(),
  /** partId -> `part_quantity_on_hand`. */
  onHand: new Map<string, number>(),
  /** partId -> direct subparts. An absent/empty entry is "no bill of materials". */
  bom: new Map<string, { childId: string; qty: number }[]>(),
  /** partIds `createBuild` must refuse, and with what. */
  createFailures: new Map<string, Error>(),
  /** partIds `createBuild` must THROW on, rather than returning an err. */
  createThrows: new Set<string>(),
  createCalls: [] as {
    partId: string
    quantityPlanned: number
    orderId?: string
    source?: string
  }[],
  systemUserCalls: 0,
  nextBuild: 0,
}))

vi.mock('../auto-build-settings', () => ({
  loadAutoBuildSettings: vi.fn(async () => h.settings),
}))

vi.mock('../auto-build-queries', () => ({
  loadAutoBuildOrders: vi.fn(async (_db: unknown, _org: string, orderIds: string[]) =>
    h.orders.filter((order) => orderIds.includes(order.orderId))
  ),
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

vi.mock('../build-mutations', () => ({
  createBuild: vi.fn(
    async (
      _db: unknown,
      _org: string,
      _userId: string,
      input: { partId: string; quantityPlanned: number; orderId?: string; source?: string }
    ) => {
      h.createCalls.push(input)
      if (h.createThrows.has(input.partId)) {
        throw new Error(`boom for ${input.partId}`)
      }
      const failure = h.createFailures.get(input.partId)
      const { err, ok } = await import('neverthrow')
      if (failure) return err(failure)
      h.nextBuild += 1
      return ok({ buildId: `bld_${h.nextBuild}` })
    }
  ),
}))

vi.mock('../../users/system-user-service', () => ({
  SystemUserService: {
    getSystemUserForActions: vi.fn(async () => {
      h.systemUserCalls += 1
      return SYSTEM_USER
    }),
  },
}))

import { runAutoBuildForOrders } from '../auto-build'

/** A buildable part: classified `finished_good`, with a bill of materials. */
function makeBuildable(partId: string, kind = 'finished_good'): void {
  h.kinds.set(partId, kind)
  h.bom.set(partId, [{ childId: MOTOR, qty: 2 }])
}

function order(overrides: Partial<FixtureOrder> = {}): FixtureOrder {
  return {
    orderId: ORDER,
    placedAt: new Date('2026-08-27T00:00:00.000Z'),
    cancelledAt: null,
    lines: [{ partId: LIFT, quantity: 1 }],
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
  h.orders = []
  h.kinds = new Map()
  h.onHand = new Map()
  h.bom = new Map()
  h.createFailures = new Map()
  h.createThrows = new Set()
  h.createCalls = []
  h.systemUserCalls = 0
  h.nextBuild = 0
})

async function run(orderIds: string[] = [ORDER]) {
  const result = await runAutoBuildForOrders({} as never, ORG, orderIds)
  expect(result.isOk()).toBe(true)
  return result._unsafeUnwrap()
}

function reasons(summary: Awaited<ReturnType<typeof run>>): string[] {
  return summary.skipped.map((skip) => skip.reason)
}

describe('the switch', () => {
  it('does nothing at all while `inventory.autoBuildFromOrders` is off', async () => {
    h.settings.enabled = false
    h.orders = [order()]
    makeBuildable(LIFT)

    const summary = await run()

    expect(summary.created).toEqual([])
    expect(reasons(summary)).toEqual(['disabled'])
    expect(h.createCalls).toEqual([])
    // Not even the system user is resolved — nothing is read that is not needed.
    expect(h.systemUserCalls).toBe(0)
  })
})

describe('one build per PART, not per line (§5.3 step 6)', () => {
  it('two lines of the same lift yield ONE build for the SUM', async () => {
    makeBuildable(LIFT)
    h.orders = [
      order({
        lines: [
          { partId: LIFT, quantity: 2 },
          { partId: LIFT, quantity: 3 },
        ],
      }),
    ]

    const summary = await run()

    expect(h.createCalls).toHaveLength(1)
    expect(h.createCalls[0]).toMatchObject({ partId: LIFT, quantityPlanned: 5, orderId: ORDER })
    expect(summary.created).toEqual([
      { orderId: ORDER, partId: LIFT, buildId: 'bld_1', quantityPlanned: 5 },
    ])
  })

  it('two DIFFERENT parts yield two builds', async () => {
    makeBuildable(LIFT)
    makeBuildable(HOIST, 'subassembly')
    h.orders = [
      order({
        lines: [
          { partId: LIFT, quantity: 1 },
          { partId: HOIST, quantity: 4 },
        ],
      }),
    ]

    const summary = await run()

    expect(summary.created.map((c) => [c.partId, c.quantityPlanned]).sort()).toEqual([
      [HOIST, 4],
      [LIFT, 1],
    ])
  })

  it('stamps the order and `source: order` on every build it raises (AB7)', async () => {
    makeBuildable(LIFT)
    h.orders = [order()]

    await run()

    expect(h.createCalls[0]).toEqual({
      partId: LIFT,
      quantityPlanned: 1,
      orderId: ORDER,
      source: 'order',
    })
  })

  it('writes as the org SYSTEM user — there is no human in the call stack', async () => {
    makeBuildable(LIFT)
    h.orders = [order()]

    await run()

    const { createBuild } = await import('../build-mutations')
    expect(createBuild).toHaveBeenCalledWith({}, ORG, SYSTEM_USER, expect.anything())
  })
})

describe('the filters (§5.3 steps 2-4)', () => {
  it('skips a part with NO bill of materials', async () => {
    h.kinds.set(LIFT, 'finished_good')
    h.bom.set(LIFT, [])
    h.orders = [order()]

    const summary = await run()

    expect(summary.created).toEqual([])
    expect(reasons(summary)).toEqual(['no-bill-of-materials'])
    expect(h.createCalls).toEqual([])
  })

  it('skips a `component` part — it is purchased, not assembled', async () => {
    h.kinds.set(LIFT, 'component')
    h.bom.set(LIFT, [{ childId: MOTOR, qty: 2 }])
    h.orders = [order()]

    const summary = await run()

    expect(reasons(summary)).toEqual(['not-a-built-part'])
    expect(h.createCalls).toEqual([])
  })

  it('skips an UNCLASSIFIED part, because a null `part_kind` reads as component', async () => {
    h.bom.set(LIFT, [{ childId: MOTOR, qty: 2 }])
    h.orders = [order()]

    const summary = await run()

    expect(reasons(summary)).toEqual(['not-a-built-part'])
  })

  it('skips an order whose lines reach no part at all', async () => {
    h.orders = [order({ lines: [] })]

    const summary = await run()

    expect(reasons(summary)).toEqual(['no-parts-on-order'])
  })

  it('builds a `subassembly` as readily as a `finished_good`', async () => {
    makeBuildable(HOIST, 'subassembly')
    h.orders = [order({ lines: [{ partId: HOIST, quantity: 1 }] })]

    const summary = await run()

    expect(summary.created).toHaveLength(1)
  })
})

describe('the stock rule (AB4)', () => {
  it('out_of_stock_only SKIPS a part the shelf already covers', async () => {
    makeBuildable(LIFT)
    h.onHand.set(LIFT, 5)
    h.orders = [order({ lines: [{ partId: LIFT, quantity: 3 }] })]

    const summary = await run()

    expect(summary.created).toEqual([])
    expect(reasons(summary)).toEqual(['covered-by-stock'])
  })

  it('out_of_stock_only FIRES for a part the shelf does not cover', async () => {
    makeBuildable(LIFT)
    h.onHand.set(LIFT, 2)
    h.orders = [order({ lines: [{ partId: LIFT, quantity: 3 }] })]

    const summary = await run()

    expect(summary.created).toHaveLength(1)
    expect(h.createCalls[0]).toMatchObject({ quantityPlanned: 3 })
  })

  it('all_stock_levels builds regardless of what is on the shelf', async () => {
    h.settings.stockRule = 'all_stock_levels'
    makeBuildable(LIFT)
    h.onHand.set(LIFT, 999)
    h.orders = [order({ lines: [{ partId: LIFT, quantity: 3 }] })]

    const summary = await run()

    expect(summary.created).toHaveLength(1)
  })

  it('a part nobody has ever counted reads as zero on hand, and builds', async () => {
    makeBuildable(LIFT)
    h.orders = [order()]

    const summary = await run()

    expect(summary.created).toHaveLength(1)
  })
})

describe('the enablement window (AB8)', () => {
  it('skips an order PLACED before the switch was turned on', async () => {
    makeBuildable(LIFT)
    h.orders = [order({ placedAt: new Date('2025-06-01T00:00:00.000Z') })]

    const summary = await run()

    expect(summary.created).toEqual([])
    expect(reasons(summary)).toEqual(['before-enablement'])
    expect(h.createCalls).toEqual([])
  })

  it('🛑 skips EVERY order when no enablement stamp was ever recorded', async () => {
    h.settings.enabledAt = null
    makeBuildable(LIFT)
    h.orders = [order(), order({ orderId: OTHER_ORDER })]

    const summary = await run([ORDER, OTHER_ORDER])

    expect(summary.created).toEqual([])
    expect(reasons(summary)).toEqual(['before-enablement', 'before-enablement'])
  })

  it('skips an order that arrived already cancelled', async () => {
    makeBuildable(LIFT)
    h.orders = [order({ cancelledAt: new Date('2026-08-27T01:00:00.000Z') })]

    const summary = await run()

    expect(summary.created).toEqual([])
    expect(reasons(summary)).toEqual(['order-cancelled'])
  })
})

describe('🛑 never throw (§5.3 step 7)', () => {
  it('a line that `createBuild` REFUSES still leaves the rest of the order built', async () => {
    makeBuildable(LIFT)
    makeBuildable(HOIST, 'subassembly')
    h.createFailures.set(LIFT, new UnprocessableEntityError('no bill of materials'))
    h.orders = [
      order({
        lines: [
          { partId: LIFT, quantity: 1 },
          { partId: HOIST, quantity: 2 },
        ],
      }),
    ]

    const summary = await run()

    expect(summary.created.map((c) => c.partId)).toEqual([HOIST])
    expect(summary.failed).toEqual([
      { orderId: ORDER, partId: LIFT, message: 'no bill of materials' },
    ])
  })

  it('a line that THROWS still leaves the rest of the order built', async () => {
    makeBuildable(LIFT)
    makeBuildable(HOIST, 'subassembly')
    h.createThrows.add(LIFT)
    h.orders = [
      order({
        lines: [
          { partId: LIFT, quantity: 1 },
          { partId: HOIST, quantity: 2 },
        ],
      }),
    ]

    const summary = await run()

    expect(summary.created.map((c) => c.partId)).toEqual([HOIST])
    expect(summary.failed).toEqual([
      { orderId: ORDER, partId: LIFT, message: 'boom for part_lift' },
    ])
  })

  it('a bad order does not lose the other orders in the batch', async () => {
    makeBuildable(LIFT)
    makeBuildable(HOIST, 'subassembly')
    h.createThrows.add(LIFT)
    h.orders = [
      order({ lines: [{ partId: LIFT, quantity: 1 }] }),
      order({ orderId: OTHER_ORDER, lines: [{ partId: HOIST, quantity: 1 }] }),
    ]

    const summary = await run([ORDER, OTHER_ORDER])

    expect(summary.ordersConsidered).toBe(2)
    expect(summary.created.map((c) => c.orderId)).toEqual([OTHER_ORDER])
    expect(summary.failed.map((f) => f.orderId)).toEqual([ORDER])
  })

  it('returns an err rather than throwing when the whole read fails', async () => {
    const queries = await import('../auto-build-queries')
    vi.mocked(queries.loadAutoBuildOrders).mockRejectedValueOnce(new Error('db is on fire'))
    h.orders = [order()]

    const result = await runAutoBuildForOrders({} as never, ORG, [ORDER])

    expect(result.isErr()).toBe(true)
  })
})

describe('batching', () => {
  it('reads the part kinds, quantities and BOM once per DISTINCT part', async () => {
    makeBuildable(LIFT)
    h.orders = [
      order({ lines: [{ partId: LIFT, quantity: 1 }] }),
      order({ orderId: OTHER_ORDER, lines: [{ partId: LIFT, quantity: 1 }] }),
    ]

    await run([ORDER, OTHER_ORDER])

    const { readPartKinds } = await import('../build-queries')
    const { loadDirectSubparts } = await import('../../bom/subpart-graph')
    expect(readPartKinds).toHaveBeenCalledTimes(1)
    expect(readPartKinds).toHaveBeenCalledWith({}, ORG, [LIFT])
    expect(loadDirectSubparts).toHaveBeenCalledTimes(1)
    // Two orders, one part each -> still two builds. Batching the READS never
    // collapses the WRITES: these are two different orders.
    expect(h.createCalls).toHaveLength(2)
  })

  it('never reads the bill of materials for a part it has already ruled out', async () => {
    h.kinds.set(LIFT, 'component')
    h.orders = [order()]

    await run()

    const { loadDirectSubparts } = await import('../../bom/subpart-graph')
    expect(loadDirectSubparts).not.toHaveBeenCalled()
  })
})
