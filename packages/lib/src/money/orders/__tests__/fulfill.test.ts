// packages/lib/src/money/orders/__tests__/fulfill.test.ts
//
// `fulfillOrder` after entity migration 153
// (`plans/money/tasks/55-shipment-lines.md` §6.1): the `fulfillment` record and
// the status flip are written inside one transaction via
// `money/fulfillments/writes.ts`'s `createFulfillment`, the entry posts AFTER
// the transaction commits, and a refused post is undone by DELETING the
// record and restoring the status - never by patching a JSON cell.
//
// `money/fulfillments` is mocked wholesale here: this file is about
// `fulfillOrder`'s own orchestration (what it creates, what it stamps, what it
// rolls back and when), not about the record read/write mechanics, which have
// their own tests under `money/fulfillments/__tests__`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  postResult: { status: 'posted', glPostingId: 'glp_1', docNumber: 'AUXX-FUL-ORD0012F1' } as {
    status: string
    glPostingId?: string
    docNumber?: string
    error?: string
  },
  updated: [] as Array<{ recordId: string; values: Record<string, unknown> }>,
  created: [] as Array<Record<string, unknown>>,
  createResult: {
    fulfillmentInstanceId: 'ful_1',
    recordId: 'fulfillment:ful_1',
    lineInstanceIds: ['fl_1'],
  },
  deleted: [] as Array<{ fulfillmentInstanceId: string }>,
  stamped: [] as Array<{ fulfillmentInstanceId: string; patch: Record<string, unknown> }>,
  isAccountingEnabled: vi.fn(async () => true),
  /** What `buildFulfillmentEntry` was handed, so the per-line tax is assertable. */
  built: [] as Array<{ shippedLines: Array<{ lineId: string; taxMinor?: number }> }>,
  /** Every `relieveFulfillmentLines` call this run made (50 §1.4). */
  relieved: [] as Array<{ organizationId: string; userId: string; lines: unknown[] }>,
  /** Overridable per test - defaults to a clean run that wrote nothing skipped. */
  reliefResult: null as unknown,
}))

vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))

vi.mock('../reads', async () => {
  const actual = await vi.importActual<typeof import('../reads')>('../reads')
  const { ok } = await import('neverthrow')
  return {
    ...actual,
    readOrderForFulfillment: async () => ok(h.order),
  }
})

vi.mock('../../fulfillments', async () => {
  const actual = await vi.importActual<typeof import('../../fulfillments')>('../../fulfillments')
  return {
    // Pure and unmocked: it is what turns `order.number` into the `name` the
    // create call carries, and the naming convention is worth asserting on.
    defaultFulfillmentName: actual.defaultFulfillmentName,
    createFulfillment: async (_db: unknown, input: Record<string, unknown>) => {
      h.created.push(input)
      return h.createResult
    },
    deleteFulfillment: async (_db: unknown, params: { fulfillmentInstanceId: string }) => {
      h.deleted.push(params)
    },
    stampFulfillmentPosting: async (
      _db: unknown,
      params: { fulfillmentInstanceId: string; patch: Record<string, unknown> }
    ) => {
      h.stamped.push({ fulfillmentInstanceId: params.fulfillmentInstanceId, patch: params.patch })
    },
  }
})

vi.mock('../../../postings/build-fulfillment-entry', async (importOriginal) => {
  // `computeShipmentTotals` stays REAL: the not-enabled path calls it directly
  // (never the mocked builder below), and its arithmetic is what the
  // "accounting not enabled" tests below assert against.
  const actual = await importOriginal<typeof import('../../../postings/build-fulfillment-entry')>()
  return {
    computeShipmentTotals: actual.computeShipmentTotals,
    buildFulfillmentEntry: (input: {
      shippedLines: Array<{ lineId: string; taxMinor?: number }>
    }) => {
      h.built.push({ shippedLines: input.shippedLines })
      return {
        entry: {
          postingType: 'fulfillment',
          periodKey: 'ORD0012F1',
          txnDate: '2026-09-03',
          lines: [],
        },
        periodKey: 'ORD0012F1',
        revenueRole: 'revenue_dtc',
        channelDimension: 'dtc',
        subtotalMinor: 50_00,
        taxMinor: 0,
        shippingMinor: 0,
        totalMinor: 50_00,
        taxBasis: 'allocated',
      }
    },
  }
})

vi.mock('../../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: async () => h.postResult,
  previewEntry: async () => ({ lines: [] }),
}))

vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))

vi.mock('../../../relief', async () => {
  const { ok } = await import('neverthrow')
  return {
    relieveFulfillmentLines: async (
      _db: unknown,
      params: { organizationId: string; userId: string; lines: unknown[] }
    ) => {
      h.relieved.push(params)
      if (h.reliefResult) return h.reliefResult
      return ok({
        movementIds: [],
        affectedPartIds: [],
        skippedNoPart: 0,
        skippedZeroDelta: 0,
        skippedNoCost: 0,
        fallbackStandardCostPartIds: [],
        negativeQoHPartIds: [],
      })
    },
  }
})

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async update(recordId: string, values: Record<string, unknown>) {
      h.updated.push({ recordId, values })
    }
  },
}))

import type { Database } from '@auxx/database'
import { fulfillOrder } from '../fulfill'

const ORG = 'org_1'
const USER = 'user_1'

/** `db.transaction` runs the body against an opaque handle - nothing in it is inspected directly. */
function stubDb(): Database {
  return {
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  } as unknown as Database
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
  h.postResult = { status: 'posted', glPostingId: 'glp_1', docNumber: 'AUXX-FUL-ORD0012F1' }
  h.updated = []
  h.created = []
  h.deleted = []
  h.stamped = []
  h.built = []
  h.relieved = []
  h.reliefResult = null
  h.isAccountingEnabled.mockResolvedValue(true)
})

describe('fulfillOrder', () => {
  it('creates the fulfillment record and its lines inside one transaction', async () => {
    const result = await fulfillOrder(stubDb(), input)

    expect(result.isOk()).toBe(true)
    expect(h.created).toHaveLength(1)
    const create = h.created[0]!
    expect(create.orderInstanceId).toBe('ord_1')
    expect(create.sequence).toBe(1)
    expect(create.status).toBe('success')
    // The synthesised display name - never absent (registry field's "not optional" rule).
    expect(create.name).toBe('ORD-0012-F1')
    expect(create.lines).toEqual([{ lineItemInstanceId: 'li_1', quantity: 3 }])
  })

  it('flips order_fulfillment_status in the SAME transaction as the create', async () => {
    await fulfillOrder(stubDb(), input)

    const statusWrite = h.updated.find((write) => 'order_fulfillment_status' in write.values)
    expect(statusWrite).toBeDefined()
    // 5 ordered, 3 shipped - partial, not fulfilled.
    expect(statusWrite?.values.order_fulfillment_status).toBe('partial')
  })

  it('stamps the posting onto the record it produced, after the commit', async () => {
    await fulfillOrder(stubDb(), input)

    expect(h.stamped).toEqual([
      {
        fulfillmentInstanceId: 'ful_1',
        patch: { glPosting: 'glp_1', docNumber: 'AUXX-FUL-ORD0012F1' },
      },
    ])
  })

  it('returns the fulfillment it created, settled with the posting identity', async () => {
    const result = await fulfillOrder(stubDb(), input)

    expect(result.isOk()).toBe(true)
    const { fulfillment, fulfillmentStatus } = result._unsafeUnwrap()
    expect(fulfillment.id).toBe('ful_1')
    expect(fulfillment.glPosting).toBe('glp_1')
    expect(fulfillment.docNumber).toBe('AUXX-FUL-ORD0012F1')
    expect(fulfillment.lines).toEqual([
      {
        id: 'fl_1',
        recordId: 'fulfillment_line:fl_1',
        lineItemId: 'li_1',
        quantity: 3,
        quantityRelieved: null,
      },
    ])
    expect(fulfillmentStatus).toBe('partial')
  })

  it('scales per-line tax proportionally for a partial shipment', async () => {
    h.order.lines = [
      {
        lineId: 'li_1',
        name: 'Widget',
        quantity: 5,
        shippedQuantity: 0,
        remainingQuantity: 5,
        unitPriceMinor: 10_00,
        lineTaxMinor: 500,
        sortOrder: 0,
      },
    ]
    await fulfillOrder(stubDb(), input)

    // 3 of 5 units: 500 * 3 / 5 = 300.
    expect(h.built[0]?.shippedLines).toEqual([
      expect.objectContaining({ lineId: 'li_1', taxMinor: 300 }),
    ])
  })

  describe('inventory relief (50 §1.4)', () => {
    it('relieves every line the shipment created, unrelieved, at the dispatch date', async () => {
      await fulfillOrder(stubDb(), input)

      expect(h.relieved).toEqual([
        {
          organizationId: ORG,
          userId: USER,
          lines: [
            {
              fulfillmentLineId: 'fl_1',
              lineItemId: 'li_1',
              quantity: 3,
              quantityRelieved: null,
              occurredAt: new Date('2026-09-03T12:00:00.000Z'),
            },
          ],
        },
      ])
    })

    it('still runs when accounting is not enabled - on-hand is an inventory fact', async () => {
      h.isAccountingEnabled.mockResolvedValue(false)
      await fulfillOrder(stubDb(), input)
      expect(h.relieved).toHaveLength(1)
    })

    it('does NOT run when the ledger refuses the post - there is no record left to point at', async () => {
      h.postResult = { status: 'blocked', error: 'Period locked' }
      await fulfillOrder(stubDb(), input)
      expect(h.relieved).toHaveLength(0)
    })

    it('a relief failure is logged and swallowed - fulfillOrder still returns ok', async () => {
      const { err } = await import('neverthrow')
      h.reliefResult = err(new Error('boom'))

      const result = await fulfillOrder(stubDb(), input)
      expect(result.isOk()).toBe(true)
      expect(h.stamped).toHaveLength(1)
    })
  })

  describe('when the ledger refuses the post', () => {
    beforeEach(() => {
      h.postResult = { status: 'blocked', error: 'Period locked' }
    })

    it('deletes the fulfillment record it just created', async () => {
      await fulfillOrder(stubDb(), input)
      expect(h.deleted).toEqual([
        { organizationId: ORG, actorUserId: USER, fulfillmentInstanceId: 'ful_1' },
      ])
    })

    it('restores the order to its PRIOR status, not the one this attempt wanted', async () => {
      await fulfillOrder(stubDb(), input)

      const statusWrites = h.updated.filter((write) => 'order_fulfillment_status' in write.values)
      // One write from the create transaction (-> 'partial'), one from the
      // rollback's compensating transaction (-> back to 'unfulfilled').
      expect(statusWrites.at(-1)?.values.order_fulfillment_status).toBe('unfulfilled')
    })

    it('never stamps a posting that never happened', async () => {
      await fulfillOrder(stubDb(), input)
      expect(h.stamped).toHaveLength(0)
    })

    it('returns ok with the refusal on `post`, not an Err', async () => {
      const result = await fulfillOrder(stubDb(), input)
      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().post.status).toBe('blocked')
    })
  })

  describe('when accounting is not enabled for the org', () => {
    beforeEach(() => {
      h.isAccountingEnabled.mockResolvedValue(false)
    })

    it('still creates the fulfillment record, using computeShipmentTotals directly', async () => {
      const result = await fulfillOrder(stubDb(), input)

      expect(result.isOk()).toBe(true)
      expect(h.created).toHaveLength(1)
      // The real builder mock above was never called for this org.
      expect(h.built).toHaveLength(0)
      expect(result._unsafeUnwrap().post.status).toBe('not_enabled')
    })

    it('does not roll back - `not_enabled` is an expected outcome, not a refusal', async () => {
      await fulfillOrder(stubDb(), input)
      expect(h.deleted).toHaveLength(0)
    })
  })

  describe('validation', () => {
    it('refuses a quantity greater than what remains on the line', async () => {
      const result = await fulfillOrder(stubDb(), {
        ...input,
        shippedLines: [{ lineId: 'li_1', quantity: 999 }],
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toMatch(/has 5 left to ship/i)
      expect(h.created).toHaveLength(0)
    })

    it('refuses a line that is not on the order', async () => {
      const result = await fulfillOrder(stubDb(), {
        ...input,
        shippedLines: [{ lineId: 'li_missing', quantity: 1 }],
      })
      expect(result.isErr()).toBe(true)
      expect(h.created).toHaveLength(0)
    })

    it('refuses when nothing is shipped', async () => {
      const result = await fulfillOrder(stubDb(), { ...input, shippedLines: [] })
      expect(result.isErr()).toBe(true)
      expect(h.created).toHaveLength(0)
    })
  })
})
