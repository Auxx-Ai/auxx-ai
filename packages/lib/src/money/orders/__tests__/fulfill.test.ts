// packages/lib/src/money/orders/__tests__/fulfill.test.ts
//
// 🛑 One property carries this file: **`order_fulfillments` is a single JSON
// cell, so every write of it is a whole-cell replace, and a replace built from a
// stale copy is a lost update.**
//
// That is not a tidiness problem here. `shippedByLine` derives
// `remainingQuantity` from the log, so a shipment that gets overwritten out of
// it reads as UNSHIPPED units - and the next fulfillment re-ships them and
// recognises their revenue a second time, under a NEW sequence, so the posting
// claim's unique index cannot catch it either. Two entries, both balanced, one
// order's revenue counted twice.
//
// There were three places the pre-read copy was written back: the append, the
// post-commit stamp, and the rollback. All three are asserted below.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  /** One array per awaited `readStoredFulfillments`, consumed in order. */
  storedReads: [] as unknown[][],
  postResult: { status: 'posted', glPostingId: 'glp_1', docNumber: 'AUXX-FUL-ORD0012F1' } as {
    status: string
    glPostingId?: string
    docNumber?: string
    error?: string
  },
  updated: [] as Array<{ recordId: string; values: Record<string, unknown> }>,
  locks: 0,
}))

vi.mock('../reads', async () => {
  const actual = await vi.importActual<typeof import('../reads')>('../reads')
  const { ok } = await import('neverthrow')
  return {
    // The tolerant parser stays REAL: the point of these tests is that the
    // module re-reads and re-parses what is stored, not that it trusts a stub.
    parseFulfillments: actual.parseFulfillments,
    requireOrderFieldContext: async () => ({
      orderDefId: 'def_order',
      order: { order_fulfillments: { id: 'fld_fulfillments' } },
      line: {},
    }),
    readOrderForFulfillment: async () => ok(h.order),
  }
})

vi.mock('../../../postings/build-fulfillment-entry', () => ({
  buildFulfillmentEntry: () => ({
    entry: { postingType: 'fulfillment', periodKey: 'ORD0012F1', txnDate: '2026-09-03', lines: [] },
    totalMinor: 50_00,
    shippingMinor: 0,
    revenueRole: 'revenue_dtc',
  }),
}))

vi.mock('../../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: async () => h.postResult,
  previewEntry: async () => ({ lines: [] }),
}))

vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async update(recordId: string, values: Record<string, unknown>) {
      h.updated.push({ recordId, values })
    }
  },
}))

import type { Database } from '@auxx/database'
import type { OrderFulfillment } from '../client'
import { fulfillOrder } from '../fulfill'

const ORG = 'org_1'
const USER = 'user_1'

/** One stored shipment, in the shape the JSON column actually holds. */
function shipment(overrides: Partial<OrderFulfillment> = {}): OrderFulfillment {
  return {
    sequence: 1,
    shippedAt: '2026-09-01',
    lines: [{ lineId: 'li_1', quantity: 2 }],
    totalMinor: 20_00,
    shippingRecognised: false,
    glPostingId: 'glp_old',
    docNumber: 'AUXX-FUL-ORD0012F1',
    recordedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

/** What one `readStoredFulfillments` query resolves to. */
function stored(fulfillments: OrderFulfillment[]) {
  return [{ valueJson: { fulfillments } }]
}

/**
 * `db.transaction` plus a chain whose `.for('update')` stands in for the row
 * lock and whose awaited form serves the next queued stored-log read.
 */
function stubDb(): Database {
  let index = 0
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'limit']) self[method] = () => self
    self.for = () => {
      h.locks += 1
      return Promise.resolve([])
    }
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(h.storedReads[index++] ?? []).then(resolve, reject)
    return self
  }
  const handle = { select: () => chain() }
  return {
    ...handle,
    transaction: async (fn: (tx: unknown) => unknown) => fn(handle),
  } as unknown as Database
}

/** The last `order_fulfillments` array written, unwrapped from its envelope. */
function lastLog(): OrderFulfillment[] {
  const writes = h.updated.filter((write) => 'order_fulfillments' in write.values)
  const envelope = writes.at(-1)?.values.order_fulfillments as
    | { fulfillments: OrderFulfillment[] }
    | undefined
  return envelope?.fulfillments ?? []
}

const input = {
  organizationId: ORG,
  actorUserId: USER,
  orderId: 'ord_1',
  shippedLines: [{ lineId: 'li_1', quantity: 3 }],
  shippedAt: '2026-09-03',
}

beforeEach(() => {
  h.order = {
    orderId: 'ord_1',
    recordId: 'def_order:ord_1',
    number: 'ORD-0012',
    channel: 'dtc',
    currency: 'USD',
    subtotalMinor: 50_00,
    taxTotalMinor: 0,
    shippingTotalMinor: 0,
    totalMinor: 50_00,
    fulfillmentStatus: 'unfulfilled',
    fulfillments: [],
    lines: [
      {
        lineId: 'li_1',
        name: 'Widget',
        quantity: 5,
        shippedQuantity: 0,
        remainingQuantity: 5,
        unitPriceMinor: 10_00,
        sortOrder: 0,
      },
    ],
    nextSequence: 1,
    shippingOwed: true,
  }
  h.storedReads = []
  h.postResult = { status: 'posted', glPostingId: 'glp_1', docNumber: 'AUXX-FUL-ORD0012F1' }
  h.updated = []
  h.locks = 0
})

describe('the append re-reads the stored log under a lock', () => {
  it('takes the row lock before it reads', async () => {
    h.storedReads = [stored([]), stored([shipment({ sequence: 1, glPostingId: null })])]
    await fulfillOrder(stubDb(), input)
    expect(h.locks).toBeGreaterThan(0)
  })

  // 🛑 The compare-and-set. The entry has ALREADY been built against
  // `nextSequence`, and its document number is keyed on it, so a log that moved
  // makes this whole attempt stale: appending anyway would claim a period key
  // another shipment already holds, and `already_posted` is a SUCCESS status -
  // this shipment would silently recognise nothing.
  it('refuses when another shipment landed while this one was being prepared', async () => {
    h.storedReads = [stored([shipment({ sequence: 1 })])]

    const result = await fulfillOrder(stubDb(), input)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/another shipment was recorded/i)
    expect(h.updated).toHaveLength(0)
  })

  it('appends to the STORED log, not to the copy the pre-read returned', async () => {
    // The pre-read said the log was empty; by the time the transaction opens it
    // is not. The CAS above is what catches the sequence case; this asserts the
    // write itself is built from `stored`.
    h.storedReads = [stored([]), stored([shipment({ sequence: 1, glPostingId: null })])]
    await fulfillOrder(stubDb(), input)

    const firstWrite = h.updated[0]?.values.order_fulfillments as {
      fulfillments: OrderFulfillment[]
    }
    expect(firstWrite.fulfillments.map((row) => row.sequence)).toEqual([1])
  })
})

describe('the post-commit stamp replaces one row rather than rebuilding the log', () => {
  it('keeps a shipment that landed between the commit and the stamp', async () => {
    h.storedReads = [
      // the append's read: still empty
      stored([]),
      // the stamp's read: our row, plus one that landed in between
      stored([
        shipment({ sequence: 1, glPostingId: null, docNumber: null }),
        shipment({ sequence: 2, glPostingId: 'glp_2' }),
      ]),
    ]

    const result = await fulfillOrder(stubDb(), input)
    expect(result.isOk()).toBe(true)

    const log = lastLog()
    // 🛑 Two rows. Rebuilding from the pre-read copy would have written one, and
    // the dropped shipment's units would read as unshipped - re-shipped and
    // re-recognised by the next fulfillment.
    expect(log.map((row) => row.sequence)).toEqual([1, 2])
    expect(log.find((row) => row.sequence === 1)?.glPostingId).toBe('glp_1')
    expect(log.find((row) => row.sequence === 2)?.glPostingId).toBe('glp_2')
  })
})

describe('the rollback removes THIS shipment, not everything since the pre-read', () => {
  it('drops only the refused sequence and restores the status', async () => {
    h.postResult = { status: 'period_closed', error: 'August is closed.' }
    h.storedReads = [
      stored([]),
      // the rollback's read
      stored([
        shipment({ sequence: 1, glPostingId: null, docNumber: null }),
        shipment({ sequence: 2, glPostingId: 'glp_2' }),
      ]),
    ]

    const result = await fulfillOrder(stubDb(), input)
    expect(result._unsafeUnwrap().post.status).toBe('period_closed')

    const log = lastLog()
    expect(log.map((row) => row.sequence)).toEqual([2])
    expect(h.updated.at(-1)?.values.order_fulfillment_status).toBe('unfulfilled')
  })
})
