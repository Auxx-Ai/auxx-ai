// packages/lib/src/builds/__tests__/reconcile-queries.test.ts
//
// The ONE read of "every build the system raised against this order", extracted
// from `auto-build-cancel.ts` so its two writers share an implementation
// (plans/products/13-order-build-reconciliation.md §5).
//
// 🛑 What is under test is the DOUBLE filter. `listBuilds` builds its `source`
// and `orderId` predicates as INNER JOINs it only adds when the org has
// materialised the field (`build-queries.ts:318,340`) — a filter whose field is
// missing is silently dropped, with no error and no marker on the result. Both
// callers act on this answer by WRITING, so the in-memory re-check is the whole
// reason the function exists rather than a bare `listBuilds` call.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildRecord } from '../types'

const ORG = 'org_1'
const ORDER = 'ord_1'
const OTHER_ORDER = 'ord_2'
const LIFT = 'part_lift'

const h = vi.hoisted(() => ({
  builds: [] as BuildRecord[],
  listCalls: [] as Record<string, unknown>[],
  /** Set to make `listBuilds` behave as it does on an org missing the field. */
  ignoreFilters: false,
}))

vi.mock('../build-queries', () => ({
  listBuilds: vi.fn(async (_db: unknown, _org: string, filters: Record<string, unknown>) => {
    h.listCalls.push(filters)
    const { ok } = await import('neverthrow')
    const matched = h.ignoreFilters
      ? h.builds
      : h.builds.filter((build) => {
          if (filters.orderId && build.orderId !== filters.orderId) return false
          if (filters.source && build.source !== filters.source) return false
          return true
        })
    const offset = (filters.offset as number) ?? 0
    const limit = (filters.limit as number) ?? 50
    return ok(matched.slice(offset, offset + limit))
  }),
}))

import { readOrderRaisedBuilds } from '../reconcile-queries'

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

beforeEach(() => {
  vi.clearAllMocks()
  h.builds = []
  h.listCalls = []
  h.ignoreFilters = false
})

describe('readOrderRaisedBuilds', () => {
  it('asks the SQL for `source: order` against this order', async () => {
    h.builds = [build({ buildId: 'bld_auto' })]

    const builds = await readOrderRaisedBuilds({} as never, ORG, ORDER)

    expect(builds.map((b) => b.buildId)).toEqual(['bld_auto'])
    expect(h.listCalls[0]).toMatchObject({ orderId: ORDER, source: 'order', limit: 100, offset: 0 })
  })

  it('🛑 drops a `manual` build in memory when the SQL filter was silently skipped', async () => {
    // An org that has not materialised `build_source`: the real `listBuilds`
    // never adds the join and hands back everything. Without the second filter
    // this turns "undo what the system raised" into "undo everything anyone
    // raised" — and the caller is a writer.
    h.ignoreFilters = true
    h.builds = [
      build({ buildId: 'bld_auto', source: 'order' }),
      build({ buildId: 'bld_hand', source: 'manual' }),
    ]

    const builds = await readOrderRaisedBuilds({} as never, ORG, ORDER)

    expect(builds.map((b) => b.buildId)).toEqual(['bld_auto'])
  })

  it('🛑 drops another order’s build in memory too', async () => {
    h.ignoreFilters = true
    h.builds = [
      build({ buildId: 'bld_mine', orderId: ORDER }),
      build({ buildId: 'bld_theirs', orderId: OTHER_ORDER }),
    ]

    const builds = await readOrderRaisedBuilds({} as never, ORG, ORDER)

    expect(builds.map((b) => b.buildId)).toEqual(['bld_mine'])
  })

  it('walks past the first page and stops on the first short one', async () => {
    // `listBuilds` defaults to 50; an order that raised 150 builds must not have
    // 100 of them silently escape the reconcile.
    h.builds = Array.from({ length: 150 }, (_, i) => build({ buildId: `bld_${i}` }))

    const builds = await readOrderRaisedBuilds({} as never, ORG, ORDER)

    expect(builds).toHaveLength(150)
    expect(h.listCalls.map((call) => call.offset)).toEqual([0, 100])
  })

  it('stops at the cap rather than looping forever', async () => {
    // A cap, not an unbounded loop: this runs inline off a field write, so a
    // pathological order degrades to "some builds were not reconciled, and it is
    // in the log" rather than to a write that never returns.
    h.builds = Array.from({ length: 1200 }, (_, i) => build({ buildId: `bld_${i}` }))

    const builds = await readOrderRaisedBuilds({} as never, ORG, ORDER)

    expect(builds).toHaveLength(1000)
    expect(h.listCalls).toHaveLength(10)
  })

  it('throws rather than reporting an unreadable order as having no builds', async () => {
    const { listBuilds } = await import('../build-queries')
    vi.mocked(listBuilds).mockImplementationOnce(async () => {
      const { err } = await import('neverthrow')
      return err(new Error('db is on fire'))
    })

    await expect(readOrderRaisedBuilds({} as never, ORG, ORDER)).rejects.toThrow('db is on fire')
  })
})
