// packages/lib/src/inventory/relief/__tests__/backfill.test.ts

/**
 * `backfillFulfillmentRelief` - the record-driven relief door.
 *
 * `relieveFulfillmentLines` and `readFulfillmentsForOrders` are both mocked:
 * this file is about the SWEEP (which orders, which fulfillments, how the
 * per-batch results accumulate, what a failed batch does to the run), not
 * about relief's arithmetic or the fulfillment join shape, each of which has
 * its own tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface TestFulfillment {
  id: string
  orderId: string
  status: string
  shippedAt: string
  lines: { id: string; lineItemId: string; quantity: number; quantityRelieved: number | null }[]
}

const h = vi.hoisted(() => ({
  orderIds: [] as string[],
  fulfillmentsByOrder: new Map<string, unknown[]>(),
  relieveResults: [] as { ok: boolean; movementIds?: string[]; extra?: Record<string, unknown> }[],
  relieveCalls: [] as { lines: unknown[]; userId: string }[],
  systemUser: 'user_system',
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ get: async () => h.systemUser }),
  requireCachedEntityDefId: async () => 'def_order',
}))

vi.mock('../../../money/fulfillments', () => ({
  isLiveFulfillment: (f: { status: string }) => f.status !== 'cancelled',
  readFulfillmentsForOrders: async (
    _db: unknown,
    params: { orderIds: readonly string[] }
  ): Promise<Map<string, unknown[]>> => {
    const out = new Map<string, unknown[]>()
    for (const id of params.orderIds) {
      const rows = h.fulfillmentsByOrder.get(id)
      if (rows) out.set(id, rows)
    }
    return out
  },
}))

vi.mock('../relieve', async () => {
  const { err, ok } = await import('neverthrow')
  return {
    relieveFulfillmentLines: async (_db: unknown, input: { lines: unknown[]; userId: string }) => {
      h.relieveCalls.push({ lines: input.lines, userId: input.userId })
      const next = h.relieveResults.shift()
      if (next && !next.ok) return err(new Error('batch blew up'))
      return ok({
        movementIds: next?.movementIds ?? [],
        affectedPartIds: [],
        skippedNoPart: 0,
        skippedZeroDelta: 0,
        skippedNoCost: 0,
        fallbackStandardCostPartIds: [],
        negativeQoHPartIds: [],
        ...(next?.extra ?? {}),
      })
    },
  }
})

const db = {
  select: () => ({
    from: () => ({
      where: async () => h.orderIds.map((id) => ({ id })),
    }),
  }),
} as never

function fulfillment(over: Partial<TestFulfillment> & { id: string; orderId: string }) {
  return {
    status: 'success',
    shippedAt: '2026-03-04T10:00:00.000Z',
    lines: [
      { id: `${over.id}-l1`, lineItemId: `li-${over.id}`, quantity: 2, quantityRelieved: null },
    ],
    ...over,
  }
}

async function run(input: Record<string, unknown> = {}) {
  const { backfillFulfillmentRelief } = await import('../backfill')
  const result = await backfillFulfillmentRelief(db, {
    organizationId: 'org_1',
    ...input,
  } as never)
  if (result.isErr()) throw result.error
  return result.value
}

beforeEach(() => {
  h.orderIds = []
  h.fulfillmentsByOrder = new Map()
  h.relieveResults = []
  h.relieveCalls = []
  h.systemUser = 'user_system'
  vi.clearAllMocks()
})

describe('backfillFulfillmentRelief', () => {
  it('returns an empty summary and calls relief zero times when the org has no orders', async () => {
    const summary = await run()

    expect(summary.ordersScanned).toBe(0)
    expect(summary.movementsWritten).toBe(0)
    expect(h.relieveCalls).toHaveLength(0)
  })

  it('turns every live fulfillment line into one line to relieve', async () => {
    h.orderIds = ['o1', 'o2']
    h.fulfillmentsByOrder.set('o1', [
      fulfillment({
        id: 'f1',
        orderId: 'o1',
        lines: [
          { id: 'f1-a', lineItemId: 'li-a', quantity: 3, quantityRelieved: null },
          { id: 'f1-b', lineItemId: 'li-b', quantity: 1, quantityRelieved: 1 },
        ],
      }),
    ])
    h.fulfillmentsByOrder.set('o2', [fulfillment({ id: 'f2', orderId: 'o2' })])
    h.relieveResults = [{ ok: true, movementIds: ['m1', 'm2'] }]

    const summary = await run()

    expect(summary.ordersScanned).toBe(2)
    expect(summary.fulfillmentsScanned).toBe(2)
    expect(summary.linesConsidered).toBe(3)
    expect(summary.movementsWritten).toBe(2)
    expect(h.relieveCalls).toHaveLength(1)
    expect(h.relieveCalls[0]?.lines).toEqual([
      {
        fulfillmentLineId: 'f1-a',
        fulfillmentId: 'f1',
        orderId: 'o1',
        lineItemId: 'li-a',
        quantity: 3,
        quantityRelieved: null,
        occurredAt: new Date('2026-03-04T10:00:00.000Z'),
      },
      {
        fulfillmentLineId: 'f1-b',
        fulfillmentId: 'f1',
        orderId: 'o1',
        lineItemId: 'li-b',
        quantity: 1,
        quantityRelieved: 1,
        occurredAt: new Date('2026-03-04T10:00:00.000Z'),
      },
      {
        fulfillmentLineId: 'f2-l1',
        fulfillmentId: 'f2',
        orderId: 'o2',
        lineItemId: 'li-f2',
        quantity: 2,
        quantityRelieved: null,
        occurredAt: new Date('2026-03-04T10:00:00.000Z'),
      },
    ])
  })

  it('excludes a cancelled fulfillment and counts it, never passing its lines to relief', async () => {
    h.orderIds = ['o1']
    h.fulfillmentsByOrder.set('o1', [
      fulfillment({ id: 'live', orderId: 'o1' }),
      fulfillment({ id: 'dead', orderId: 'o1', status: 'cancelled' }),
    ])
    h.relieveResults = [{ ok: true, movementIds: ['m1'] }]

    const summary = await run()

    expect(summary.fulfillmentsScanned).toBe(2)
    expect(summary.fulfillmentsSkippedCancelled).toBe(1)
    expect(summary.linesConsidered).toBe(1)
    expect(h.relieveCalls[0]?.lines).toHaveLength(1)
  })

  it('dates each line from its own dispatch, never from now', async () => {
    h.orderIds = ['o1']
    h.fulfillmentsByOrder.set('o1', [
      fulfillment({ id: 'jan', orderId: 'o1', shippedAt: '2026-01-09T00:00:00.000Z' }),
      fulfillment({ id: 'jun', orderId: 'o1', shippedAt: '2026-06-22T00:00:00.000Z' }),
    ])
    h.relieveResults = [{ ok: true }]

    await run()

    const dates = (h.relieveCalls[0]?.lines as { occurredAt: Date }[]).map((l) =>
      l.occurredAt.toISOString()
    )
    expect(dates).toEqual(['2026-01-09T00:00:00.000Z', '2026-06-22T00:00:00.000Z'])
  })

  it('uses the org system user when the caller names none', async () => {
    h.orderIds = ['o1']
    h.fulfillmentsByOrder.set('o1', [fulfillment({ id: 'f1', orderId: 'o1' })])
    h.relieveResults = [{ ok: true }]

    await run()

    expect(h.relieveCalls[0]?.userId).toBe('user_system')
  })

  it('honours an explicit userId over the system user', async () => {
    h.orderIds = ['o1']
    h.fulfillmentsByOrder.set('o1', [fulfillment({ id: 'f1', orderId: 'o1' })])
    h.relieveResults = [{ ok: true }]

    await run({ userId: 'user_markus' })

    expect(h.relieveCalls[0]?.userId).toBe('user_markus')
  })

  it('sweeps only the orders it was given, never the whole org', async () => {
    h.orderIds = ['o1', 'o2', 'o3']
    for (const id of h.orderIds) {
      h.fulfillmentsByOrder.set(id, [fulfillment({ id: `f-${id}`, orderId: id })])
    }
    h.relieveResults = [{ ok: true }]

    const summary = await run({ orderIds: ['o2'] })

    expect(summary.ordersScanned).toBe(1)
    expect(summary.fulfillmentsScanned).toBe(1)
    expect(h.relieveCalls[0]?.lines).toHaveLength(1)
  })

  it('de-duplicates a caller-supplied order id', async () => {
    h.orderIds = []
    h.fulfillmentsByOrder.set('o1', [fulfillment({ id: 'f1', orderId: 'o1' })])
    h.relieveResults = [{ ok: true }]

    const summary = await run({ orderIds: ['o1', 'o1', 'o1'] })

    expect(summary.ordersScanned).toBe(1)
    expect(summary.linesConsidered).toBe(1)
  })

  it('accumulates the per-batch counts and de-duplicates part ids across batches', async () => {
    // 260 orders is two batches at ORDERS_PER_BATCH = 250.
    h.orderIds = Array.from({ length: 260 }, (_, i) => `o${i}`)
    for (const id of h.orderIds) {
      h.fulfillmentsByOrder.set(id, [fulfillment({ id: `f-${id}`, orderId: id })])
    }
    h.relieveResults = [
      {
        ok: true,
        movementIds: ['m1'],
        extra: {
          affectedPartIds: ['p1', 'p2'],
          skippedNoPart: 1,
          skippedZeroDelta: 2,
          skippedNoCost: 3,
          fallbackStandardCostPartIds: ['p1'],
          negativeQoHPartIds: ['p2'],
        },
      },
      {
        ok: true,
        movementIds: ['m2', 'm3'],
        extra: {
          affectedPartIds: ['p2', 'p3'],
          skippedNoPart: 10,
          skippedZeroDelta: 20,
          skippedNoCost: 30,
          fallbackStandardCostPartIds: ['p1'],
          negativeQoHPartIds: ['p9'],
        },
      },
    ]

    const summary = await run()

    expect(h.relieveCalls).toHaveLength(2)
    expect(summary.movementsWritten).toBe(3)
    expect(summary.skippedNoPart).toBe(11)
    expect(summary.skippedZeroDelta).toBe(22)
    expect(summary.skippedNoCost).toBe(33)
    expect(summary.affectedPartIds.sort()).toEqual(['p1', 'p2', 'p3'])
    // 🛑 One warning per part per RUN, not per batch - p1 fell back twice.
    expect(summary.fallbackStandardCostPartIds).toEqual(['p1'])
    expect(summary.negativeQoHPartIds.sort()).toEqual(['p2', 'p9'])
  })

  it('counts a failed batch and CONTINUES, so one bad batch does not lose the run', async () => {
    h.orderIds = Array.from({ length: 260 }, (_, i) => `o${i}`)
    for (const id of h.orderIds) {
      h.fulfillmentsByOrder.set(id, [fulfillment({ id: `f-${id}`, orderId: id })])
    }
    h.relieveResults = [{ ok: false }, { ok: true, movementIds: ['m1', 'm2'] }]

    const summary = await run()

    expect(summary.batchesFailed).toBe(1)
    expect(summary.movementsWritten).toBe(2)
    expect(h.relieveCalls).toHaveLength(2)
  })

  it('does not call relief for a batch whose orders hold no fulfillments', async () => {
    h.orderIds = ['o1', 'o2']

    const summary = await run()

    expect(summary.ordersScanned).toBe(2)
    expect(summary.fulfillmentsScanned).toBe(0)
    expect(h.relieveCalls).toHaveLength(0)
  })

  it('reports progress once per batch', async () => {
    h.orderIds = Array.from({ length: 260 }, (_, i) => `o${i}`)
    for (const id of h.orderIds) {
      h.fulfillmentsByOrder.set(id, [fulfillment({ id: `f-${id}`, orderId: id })])
    }
    h.relieveResults = [
      { ok: true, movementIds: ['m1'] },
      { ok: true, movementIds: ['m2'] },
    ]
    const seen: { batch: number; batches: number; ordersDone: number }[] = []

    await run({
      onBatch: (p: { batch: number; batches: number; ordersDone: number }) => seen.push(p),
    })

    expect(seen).toEqual([
      { batch: 1, batches: 2, ordersDone: 250, movementsWritten: 1 },
      { batch: 2, batches: 2, ordersDone: 260, movementsWritten: 2 },
    ])
  })
})

// The posting seam has its own test (`postings/__tests__/post-inventory-movement.test.ts`);
// this file is about the movements. `vi.mock` is hoisted, so placement is free.
vi.mock('../../../accounting/ledger/post/post-inventory-movement', () => ({
  postInventoryMovementInTx: async () => null,
  exportInventoryMovement: async () => null,
  inventoryTxnDate: (day: Date) => day.toISOString().slice(0, 10),
  reverseInventoryMovementPosting: async () => null,
  reversePostingForMovement: async () => null,
  linkMovementsToPosting: async () => undefined,
}))
