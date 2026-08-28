// packages/lib/src/builds/__tests__/auto-build-cancel.test.ts
//
// Phase 3b — a cancelled order cancels a `planned` build and REVERSES a
// `completed` one, and never deletes anything
// (plans/products/12-order-triggered-build.md §6, AB6).
//
// Same doubling reasoning as `auto-build.test.ts`: `cancelBuild` and
// `reverseBuild` have their own suite in `build-event.test.ts`; what is under
// test here is which of them is chosen, for which build, and which builds are
// left alone.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../errors'
import type { BuildRecord } from '../types'

const ORG = 'org_1'
const SYSTEM_USER = 'user_system'
const ORDER = 'ord_1'
const OTHER_ORDER = 'ord_2'
const LIFT = 'part_lift'

interface FixtureOrder {
  orderId: string
  placedAt: Date
  cancelledAt: Date | null
  lines: { partId: string; quantity: number }[]
}

const h = vi.hoisted(() => ({
  orders: [] as FixtureOrder[],
  builds: [] as BuildRecord[],
  /** Set to make the read report a page-shaped list, for the pagination test. */
  pageSize: 100,
  listCalls: [] as Record<string, unknown>[],
  cancelCalls: [] as string[],
  reverseCalls: [] as string[],
  /** buildIds `reverseBuild` must refuse. */
  reverseFailures: new Map<string, Error>(),
  nextReversal: 0,
}))

vi.mock('../auto-build-queries', () => ({
  loadAutoBuildOrders: vi.fn(async (_db: unknown, _org: string, orderIds: string[]) =>
    h.orders.filter((order) => orderIds.includes(order.orderId))
  ),
  readPartQuantitiesOnHand: vi.fn(async () => new Map<string, number>()),
}))

vi.mock('../build-queries', () => ({
  listBuilds: vi.fn(async (_db: unknown, _org: string, filters: Record<string, unknown>) => {
    h.listCalls.push(filters)
    const { ok } = await import('neverthrow')
    // A faithful stand-in for the real filters, so a test that removes the
    // `source` filter from the call sees manual builds arrive.
    const matched = h.builds.filter((build) => {
      if (filters.orderId && build.orderId !== filters.orderId) return false
      if (filters.source && build.source !== filters.source) return false
      return true
    })
    const offset = (filters.offset as number) ?? 0
    const limit = (filters.limit as number) ?? 50
    return ok(matched.slice(offset, offset + limit))
  }),
}))

vi.mock('../build-mutations', () => ({
  cancelBuild: vi.fn(
    async (_db: unknown, _org: string, _user: string, input: { buildId: string }) => {
      h.cancelCalls.push(input.buildId)
      const { ok } = await import('neverthrow')
      return ok({ buildId: input.buildId })
    }
  ),
}))

vi.mock('../reverse-build', () => ({
  reverseBuild: vi.fn(
    async (_db: unknown, _org: string, _user: string, input: { buildId: string }) => {
      h.reverseCalls.push(input.buildId)
      const { err, ok } = await import('neverthrow')
      const failure = h.reverseFailures.get(input.buildId)
      if (failure) return err(failure)
      h.nextReversal += 1
      return ok({ buildId: `rev_${h.nextReversal}`, reversalOfBuildId: input.buildId })
    }
  ),
}))

vi.mock('../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: vi.fn(async () => SYSTEM_USER) },
}))

import { cancelAutoBuildsForOrders } from '../auto-build-cancel'

function build(overrides: Partial<BuildRecord> & { buildId: string }): BuildRecord {
  return {
    recordId: `def_build:${overrides.buildId}`,
    number: null,
    partId: LIFT,
    status: 'planned',
    quantityPlanned: 1,
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
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    ...overrides,
  }
}

function cancelledOrder(orderId = ORDER): FixtureOrder {
  return {
    orderId,
    placedAt: new Date('2026-08-27T00:00:00.000Z'),
    cancelledAt: new Date('2026-08-28T00:00:00.000Z'),
    lines: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.orders = []
  h.builds = []
  h.listCalls = []
  h.cancelCalls = []
  h.reverseCalls = []
  h.reverseFailures = new Map()
  h.nextReversal = 0
})

async function run(orderIds: string[] = [ORDER]) {
  const result = await cancelAutoBuildsForOrders({} as never, ORG, orderIds)
  expect(result.isOk()).toBe(true)
  return result._unsafeUnwrap()
}

describe('AB6 — cancel a planned run, REVERSE a completed one', () => {
  it('cancels a `planned` build', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [build({ buildId: 'bld_1', status: 'planned' })]

    const summary = await run()

    expect(h.cancelCalls).toEqual(['bld_1'])
    expect(h.reverseCalls).toEqual([])
    expect(summary.outcomes).toEqual([
      { orderId: ORDER, buildId: 'bld_1', action: 'cancelled', reversalBuildId: null },
    ])
  })

  it('cancels an `in_progress` build — no movements exist yet', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [build({ buildId: 'bld_1', status: 'in_progress' })]

    await run()

    expect(h.cancelCalls).toEqual(['bld_1'])
    expect(h.reverseCalls).toEqual([])
  })

  it('🛑 REVERSES a `completed` build, and never cancels it', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [build({ buildId: 'bld_1', status: 'completed' })]

    const summary = await run()

    expect(h.reverseCalls).toEqual(['bld_1'])
    expect(h.cancelCalls).toEqual([])
    expect(summary.outcomes).toEqual([
      { orderId: ORDER, buildId: 'bld_1', action: 'reversed', reversalBuildId: 'rev_1' },
    ])
  })

  it('skips a build that is already `canceled`', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [build({ buildId: 'bld_1', status: 'canceled' })]

    const summary = await run()

    expect(h.cancelCalls).toEqual([])
    expect(h.reverseCalls).toEqual([])
    expect(summary.outcomes[0]?.action).toBe('skipped')
  })

  it('skips a row whose status is missing entirely', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [build({ buildId: 'bld_1', status: null })]

    const summary = await run()

    expect(summary.outcomes[0]?.action).toBe('skipped')
    expect(h.cancelCalls).toEqual([])
    expect(h.reverseCalls).toEqual([])
  })

  it('handles a mixed order: one planned cancelled, one completed reversed', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [
      build({ buildId: 'bld_planned', status: 'planned' }),
      build({ buildId: 'bld_done', status: 'completed' }),
    ]

    await run()

    expect(h.cancelCalls).toEqual(['bld_planned'])
    expect(h.reverseCalls).toEqual(['bld_done'])
  })
})

describe('🛑 nothing is ever deleted', () => {
  it('reports a deleted count of zero, for every shape of build', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [
      build({ buildId: 'bld_planned', status: 'planned' }),
      build({ buildId: 'bld_running', status: 'in_progress' }),
      build({ buildId: 'bld_done', status: 'completed' }),
      build({ buildId: 'bld_dead', status: 'canceled' }),
    ]

    const summary = await run()

    expect(summary.deleted).toBe(0)
    expect(summary.outcomes).toHaveLength(4)
  })

  it('calls only `cancelBuild` and `reverseBuild` — there is no delete path', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [build({ buildId: 'bld_done', status: 'completed' })]

    await run()

    const mutations = await import('../build-mutations')
    const reversal = await import('../reverse-build')
    expect(Object.keys(mutations)).toEqual(['cancelBuild'])
    expect(vi.mocked(reversal.reverseBuild)).toHaveBeenCalledTimes(1)
  })
})

describe('a hand-raised build is never touched (§6.2)', () => {
  it('asks the read for `source: order` only', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [
      build({ buildId: 'bld_auto', status: 'planned', source: 'order' }),
      build({ buildId: 'bld_hand', status: 'planned', source: 'manual' }),
    ]

    await run()

    expect(h.listCalls[0]).toMatchObject({ orderId: ORDER, source: 'order' })
    expect(h.cancelCalls).toEqual(['bld_auto'])
  })

  it('🛑 re-checks `source` in memory, because `listBuilds` drops an unmaterialised filter', async () => {
    // Simulate an org where `build_source` is not materialised: the real
    // `listBuilds` silently ignores the filter and hands back everything.
    const { listBuilds } = await import('../build-queries')
    vi.mocked(listBuilds).mockImplementationOnce(async () => {
      const { ok } = await import('neverthrow')
      return ok(h.builds)
    })
    h.orders = [cancelledOrder()]
    h.builds = [
      build({ buildId: 'bld_auto', status: 'planned', source: 'order' }),
      build({ buildId: 'bld_hand', status: 'planned', source: 'manual' }),
    ]

    await run()

    expect(h.cancelCalls).toEqual(['bld_auto'])
  })

  it('🛑 re-checks `orderId` in memory too', async () => {
    const { listBuilds } = await import('../build-queries')
    vi.mocked(listBuilds).mockImplementationOnce(async () => {
      const { ok } = await import('neverthrow')
      return ok(h.builds)
    })
    h.orders = [cancelledOrder()]
    h.builds = [
      build({ buildId: 'bld_mine', status: 'planned' }),
      build({ buildId: 'bld_theirs', status: 'planned', orderId: OTHER_ORDER }),
    ]

    await run()

    expect(h.cancelCalls).toEqual(['bld_mine'])
  })
})

describe('idempotence', () => {
  it('never reverses a build that already carries a reversal', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [
      build({ buildId: 'bld_done', status: 'completed' }),
      // The reversal itself: same order, same source, carried by `reverseBuild`.
      build({ buildId: 'rev_1', status: 'completed', reversalOfBuildId: 'bld_done' }),
    ]

    const summary = await run()

    expect(h.reverseCalls).toEqual([])
    expect(summary.outcomes.map((o) => o.action)).toEqual(['skipped', 'skipped'])
  })

  it('never undoes a reversing build — that would re-apply what it removed', async () => {
    h.orders = [cancelledOrder()]
    h.builds = [build({ buildId: 'rev_1', status: 'completed', reversalOfBuildId: 'bld_gone' })]

    await run()

    expect(h.reverseCalls).toEqual([])
    expect(h.cancelCalls).toEqual([])
  })
})

describe('the cancellation stamp is re-read, not trusted', () => {
  it('does nothing for an order whose `order_cancelled_at` is empty', async () => {
    // The interactive native-field door fires `on: set` for ANY write of the
    // field, so this is the case that stops a cleared value undoing production.
    h.orders = [{ ...cancelledOrder(), cancelledAt: null }]
    h.builds = [build({ buildId: 'bld_1', status: 'planned' })]

    const summary = await run()

    expect(summary.ordersCancelled).toBe(0)
    expect(h.cancelCalls).toEqual([])
    expect(h.listCalls).toEqual([])
  })
})

describe('🛑 never throw', () => {
  it('a build that refuses to reverse leaves the rest of the order undone anyway', async () => {
    h.orders = [cancelledOrder()]
    h.reverseFailures.set('bld_done', new ConflictError('already reversed'))
    h.builds = [
      build({ buildId: 'bld_done', status: 'completed' }),
      build({ buildId: 'bld_planned', status: 'planned' }),
    ]

    const summary = await run()

    expect(h.cancelCalls).toEqual(['bld_planned'])
    expect(summary.failed).toEqual([
      { orderId: ORDER, buildId: 'bld_done', message: 'already reversed' },
    ])
  })

  it('returns an err rather than throwing when the order read fails', async () => {
    const queries = await import('../auto-build-queries')
    vi.mocked(queries.loadAutoBuildOrders).mockRejectedValueOnce(new Error('db is on fire'))

    const result = await cancelAutoBuildsForOrders({} as never, ORG, [ORDER])

    expect(result.isErr()).toBe(true)
  })
})

describe('paging', () => {
  it('walks past the first page, and stops on the first short one', async () => {
    h.orders = [cancelledOrder()]
    h.builds = Array.from({ length: 150 }, (_, i) =>
      build({ buildId: `bld_${i}`, status: 'planned' })
    )

    const summary = await run()

    expect(summary.outcomes).toHaveLength(150)
    expect(h.cancelCalls).toHaveLength(150)
    expect(h.listCalls.map((c) => c.offset)).toEqual([0, 100])
  })
})
