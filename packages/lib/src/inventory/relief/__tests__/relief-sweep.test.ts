// packages/lib/src/inventory/relief/__tests__/relief-sweep.test.ts
//
// The stage-`price` handler (111 Q21/Q22): blocked while a part has no
// standard, accepted once nothing of the document is pending. The pricer and
// the work-item frame are stubbed; this file is about the handler's answers.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Due source ids per kind, as the frame would offer them. */
  due: {} as Record<string, string[]>,
  /** The source the handler last asked about; the fake row read keys on it. */
  lastKey: '',
  /** The parked row the handler reads back. */
  items: new Map<string, { externalRef: string | null; detail: Record<string, unknown> }>(),
  /** Pending movement id -> part id. */
  pending: new Map<string, string>(),
  /** Build id -> its pending movement ids. */
  buildPending: new Map<string, string[]>(),
  standards: new Set<string>(),
  pricePendingMovements: vi.fn(),
  upsertWorkItem: vi.fn(async () => ({ isOk: () => true })),
  deleteWorkItemsAtStage: vi.fn(async () => ({ isOk: () => true })),
  relieveFulfillmentLines: vi.fn(),
  reliefLines: [] as unknown[],
}))

vi.mock('@auxx/database', () => ({
  schema: {
    AccountingWorkItem: {
      organizationId: 'organizationId',
      sourceKind: 'sourceKind',
      sourceId: 'sourceId',
      stage: 'stage',
      externalRef: 'externalRef',
      detail: 'detail',
    },
  },
}))
vi.mock('../../../accounting/work-items/sweep', () => ({
  runWorkItemSweep: async (
    _db: unknown,
    input: { sourceKind: string; handle: (id: string) => Promise<{ status: string }> }
  ) => {
    const counts: Record<string, number> = { scanned: 0, accepted: 0, blocked: 0, skipped: 0 }
    for (const id of h.due[input.sourceKind] ?? []) {
      counts.scanned!++
      try {
        const { status } = await input.handle(id)
        counts[status] = (counts[status] ?? 0) + 1
      } catch {
        counts.blocked!++
      }
    }
    return counts
  },
}))
vi.mock('../../../accounting/work-items/write', () => ({
  upsertWorkItem: h.upsertWorkItem,
  deleteWorkItemsAtStage: h.deleteWorkItemsAtStage,
}))
vi.mock('../../../cache', () => ({ getOrgCache: () => ({ get: async () => 'user_system' }) }))
vi.mock('../../../accounting/sales/fulfillments', () => ({
  readFulfillmentPostingSubject: async () => ({ orderId: 'ord_1', subtotalMinor: 100 }),
}))
vi.mock('../backfill', () => ({ readReliefLines: async () => ({ lines: h.reliefLines }) }))
vi.mock('../relieve', () => ({ relieveFulfillmentLines: h.relieveFulfillmentLines }))
vi.mock('../../costing/price-pending-movements', () => ({
  pricePendingMovements: h.pricePendingMovements,
  readMovementPartIds: async (_db: unknown, _org: string, ids: string[]) => {
    const pending = ids.filter((id) => h.pending.has(id))
    return {
      partIds: [...new Set(pending.map((id) => h.pending.get(id)!))],
      pendingMovementIds: pending,
    }
  },
  readStillPending: async (_db: unknown, _org: string, ids: string[]) =>
    new Set(ids.filter((id) => h.pending.has(id))),
  readBuildPendingParts: async (_db: unknown, _org: string, buildId: string) => {
    const pending = (h.buildPending.get(buildId) ?? []).filter((id) => h.pending.has(id))
    return {
      partIds: [...new Set(pending.map((id) => h.pending.get(id)!))],
      pendingMovementIds: pending,
    }
  },
}))

import { priceOne, sweepPendingPricing } from '../relief-sweep'

const ORG = 'org_1'
const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          const item = h.items.get(h.lastKey)
          return item ? [item] : []
        },
      }),
    }),
  }),
} as never

function park(sourceId: string, detail: Record<string, unknown>, externalRef = 'part_a') {
  h.items.set(sourceId, { externalRef, detail })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.due = {}
  h.items.clear()
  h.pending = new Map()
  h.buildPending = new Map()
  h.standards = new Set()
  h.reliefLines = []
  // The pricer values what has a standard, as the real one does.
  h.pricePendingMovements.mockImplementation(
    async (_db: unknown, _org: string, partIds: string[]) => {
      const priced = [...h.pending].filter(
        ([, partId]) => partIds.includes(partId) && h.standards.has(partId)
      )
      for (const [id] of priced) h.pending.delete(id)
      return {
        isErr: () => false,
        value: { pricedMovementIds: priced.map(([id]) => id), unpricedPartIds: [] },
      }
    }
  )
})

async function handle(sourceKind: 'fulfillment' | 'build' | 'stock_movement', sourceId: string) {
  h.lastKey = sourceId
  return priceOne(db, ORG, sourceKind, sourceId)
}

describe('a parked dispatch', () => {
  it('stays blocked while its part has no standard, and backs off rather than being re-offered', async () => {
    park('ful_1', { pendingMovementIds: ['mv_1'], partIds: ['part_a'] })
    h.pending.set('mv_1', 'part_a')

    expect(await handle('fulfillment', 'ful_1')).toEqual({ status: 'blocked' })
    expect(h.pricePendingMovements).toHaveBeenCalledWith(db, ORG, ['part_a'])
    expect(h.upsertWorkItem).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'fulfillment',
      sourceId: 'ful_1',
      stage: 'price',
      reasonCode: 'STANDARD_COST_MISSING',
      externalRef: 'part_a',
      detail: { pendingMovementIds: ['mv_1'], partIds: ['part_a'] },
    })
    expect(h.deleteWorkItemsAtStage).not.toHaveBeenCalled()
  })

  it('is done once the standard exists and every named row is priced', async () => {
    park('ful_1', { pendingMovementIds: ['mv_1', 'mv_2'] })
    h.pending.set('mv_1', 'part_a').set('mv_2', 'part_a')
    h.standards.add('part_a')

    expect(await handle('fulfillment', 'ful_1')).toEqual({ status: 'accepted' })
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'fulfillment',
      sourceIds: ['ful_1'],
      stage: 'price',
    })
    expect(h.upsertWorkItem).not.toHaveBeenCalled()
  })

  it('is done when a concurrent pass priced its rows, though this pass priced none', async () => {
    park('ful_1', { pendingMovementIds: ['mv_1', 'mv_2'] })
    h.pending.set('mv_1', 'part_a').set('mv_2', 'part_a')
    h.standards.add('part_a')
    // The other pass claimed both rows first; this pass's fill skipped them.
    h.pricePendingMovements.mockImplementationOnce(async () => {
      h.pending.clear()
      return { isErr: () => false, value: { pricedMovementIds: [], unpricedPartIds: [] } }
    })

    expect(await handle('fulfillment', 'ful_1')).toEqual({ status: 'accepted' })
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'fulfillment',
      sourceIds: ['ful_1'],
      stage: 'price',
    })
    expect(h.upsertWorkItem).not.toHaveBeenCalled()
  })

  it('is done without pricing when nothing it named is pending any more', async () => {
    park('ful_1', { pendingMovementIds: ['mv_1'] })

    expect(await handle('fulfillment', 'ful_1')).toEqual({ status: 'accepted' })
    expect(h.pricePendingMovements).not.toHaveBeenCalled()
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalled()
  })

  // Migration 193 re-staged `relieve` rows that name no movements: relief writes them now.
  it('re-runs relief for a row re-staged from relieve, and reads its answer from the run', async () => {
    park('ful_old', { partIds: ['part_a'] })
    h.reliefLines = [{ fulfillmentLineId: 'line_1' }]
    h.relieveFulfillmentLines.mockResolvedValueOnce({
      isErr: () => false,
      value: { skippedNoCost: 1 },
    })
    expect(await handle('fulfillment', 'ful_old')).toEqual({ status: 'blocked' })
    expect(h.pricePendingMovements).not.toHaveBeenCalled()

    h.relieveFulfillmentLines.mockResolvedValueOnce({
      isErr: () => false,
      value: { skippedNoCost: 0 },
    })
    expect(await handle('fulfillment', 'ful_old')).toEqual({ status: 'accepted' })
  })

  it('skips and clears a dispatch that no longer has lines to relieve', async () => {
    park('ful_gone', {})
    expect(await handle('fulfillment', 'ful_gone')).toEqual({ status: 'skipped' })
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'fulfillment',
      sourceIds: ['ful_gone'],
      stage: 'price',
    })
  })
})

describe('a parked build and a parked movement', () => {
  it('prices the parts behind the build legs still pending', async () => {
    park('build_1', { pendingMovementIds: ['mv_c'] })
    h.buildPending.set('build_1', ['mv_c', 'mv_p'])
    h.pending.set('mv_c', 'part_motor').set('mv_p', 'part_lift')
    h.standards.add('part_motor')

    expect(await handle('build', 'build_1')).toEqual({ status: 'blocked' })
    expect(h.pricePendingMovements).toHaveBeenCalledWith(db, ORG, ['part_motor', 'part_lift'])

    h.standards.add('part_lift')
    expect(await handle('build', 'build_1')).toEqual({ status: 'accepted' })
  })

  it('prices the one movement a stock_movement row names', async () => {
    park('mv_adj', { pendingMovementIds: ['mv_adj'] })
    h.pending.set('mv_adj', 'part_a')
    h.standards.add('part_a')

    expect(await handle('stock_movement', 'mv_adj')).toEqual({ status: 'accepted' })
    expect(h.pricePendingMovements).toHaveBeenCalledWith(db, ORG, ['part_a'])
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'stock_movement',
      sourceIds: ['mv_adj'],
      stage: 'price',
    })
  })
})

describe('sweepPendingPricing', () => {
  it('runs the frame over all three source kinds and sums the counts', async () => {
    h.due = { fulfillment: ['ful_1'], build: ['build_1'], stock_movement: ['mv_adj'] }
    park('ful_1', { pendingMovementIds: ['mv_1'] })
    park('build_1', { pendingMovementIds: ['mv_c'] })
    park('mv_adj', { pendingMovementIds: ['mv_adj'] })
    h.buildPending.set('build_1', ['mv_c'])
    h.pending.set('mv_1', 'part_a').set('mv_c', 'part_b').set('mv_adj', 'part_a')
    h.standards.add('part_a')
    // The frame's `handle` reads the row by the id it was offered.
    const original = h.items
    h.items = new Proxy(original, {
      get: (target, key, receiver) => {
        if (key === 'get')
          return (id: string) => {
            h.lastKey = id
            return target.get(id)
          }
        return Reflect.get(target, key, receiver)
      },
    })

    const counts = await sweepPendingPricing(db, { organizationId: ORG, limit: 10 })

    expect(counts).toMatchObject({ scanned: 3, accepted: 2, blocked: 1 })
    h.items = original
  })
})
