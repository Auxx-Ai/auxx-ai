// packages/lib/src/accounting/sales/orders/__tests__/fulfill.test.ts
//
// `fulfillOrder` after step 1b (TARGET §1): the `fulfillment` record and the
// status flip are written inside one transaction via
// `money/fulfillments/writes.ts`'s `createFulfillment`, and the entry posts
// right after the transaction commits through `postEntry` directly - there is
// no more accounting-work capture, no acceptance queue and no stamp write.
// A refused post retains the shipment; inventory relief runs regardless.
//
// `money/fulfillments` is mocked wholesale here: this file is about
// `fulfillOrder`'s own orchestration (what it creates, what it posts, what it
// retains and when), not about the record read/write mechanics, which have
// their own tests under `money/fulfillments/__tests__`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  events: [] as string[],
  postResult: { status: 'posted', glPostingId: 'glp_1', docNumber: 'AUXX-FUL-ORD0012F1' } as {
    status: string
    glPostingId?: string
    docNumber?: string
    error?: string
  },
  postCalls: [] as Array<Record<string, unknown>>,
  scope: {} as Record<string, unknown>,
  updated: [] as Array<{ recordId: string; values: Record<string, unknown> }>,
  created: [] as Array<Record<string, unknown>>,
  createResult: {
    fulfillmentInstanceId: 'ful_1',
    recordId: 'fulfillment:ful_1',
    lineInstanceIds: ['fl_1'],
  },
  isAccountingEnabled: vi.fn(async () => true),
  /** What `buildFulfillmentEntry` was handed, so the per-line tax is assertable. */
  built: [] as Array<{ shippedLines: readonly unknown[] }>,
  /** Every `relieveFulfillmentLines` call this run made (50 §1.4). */
  relieved: [] as Array<{ organizationId: string; userId: string; lines: unknown[] }>,
  /** Overridable per test - defaults to a clean run that wrote nothing skipped. */
  reliefResult: null as unknown,
  autoPostMode: 'post' as 'draft' | 'post',
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))

// Neither mock reaches its real module (no `importActual`): the real
// `../reads` and `../../fulfillments` graphs both terminate in
// `UnifiedCrudHandler`, whose own real dependency chain reaches
// `field-values/field-value-mutations.ts` - unrelated, heavy, and exactly
// what mocking the boundary here exists to avoid pulling in.
vi.mock('../reads', () => ({
  readOrderForFulfillment: async () => {
    const { ok } = await import('neverthrow')
    return ok(h.order)
  },
}))

vi.mock('../../fulfillments', () => ({
  // The naming convention is worth asserting on, so it is reproduced here
  // rather than imported - see `client.ts`'s real one-liner.
  defaultFulfillmentName: (orderNumber: string | null, sequence: number) =>
    orderNumber ? `${orderNumber}-F${sequence}` : `Shipment ${sequence}`,
  createFulfillment: async (_db: unknown, input: Record<string, unknown>) => {
    h.created.push(input)
    return h.createResult
  },
}))

vi.mock('../../../ledger/builders/fulfillment', async (importOriginal) => {
  // `computeShipmentTotals` stays REAL: the not-enabled path calls it directly
  // (never the mocked builder below), and its arithmetic is what the
  // "accounting not enabled" tests below assert against.
  const actual = await importOriginal<typeof import('../../../ledger/builders/fulfillment')>()
  return {
    computeShipmentTotals: (input: Parameters<typeof actual.computeShipmentTotals>[0]) => {
      h.built.push({ shippedLines: [...input.lines] })
      return actual.computeShipmentTotals(input)
    },
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

vi.mock('../../../ledger/post/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntryInTx: async (_tx: unknown, options: Record<string, unknown>) => {
    h.events.push('post')
    h.postCalls.push(options)
    return h.postResult
  },
  // The push is outside the transaction; the poster's result rides through it.
  exportPostedEntry: async () => h.postResult,
  previewEntry: async () => ({ lines: [] }),
}))

vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: vi.fn() }))
vi.mock('../../../ledger/reads/list-postings', () => ({
  listPostingsForSource: vi.fn(),
}))

vi.mock('../../../money/customer-money/reads', () => ({
  readOrderSourceScope: async () => h.scope,
}))

vi.mock('../../../ledger/post/accounting-commit-lock', () => ({
  withAccountingCommitLock: async () => {
    h.events.push('lock')
  },
}))
vi.mock('../../../../resources/crud/tx-write-scope', () => ({
  runInTxWrite: async (_input: unknown, fn: () => Promise<unknown>) => ({
    result: await fn(),
    scope: {},
    owned: true,
  }),
}))
vi.mock('../../../../resources/crud/tx-write-flush', () => ({
  flushTxWriteScope: async () => {
    h.events.push('flush')
  },
}))

vi.mock('../../../ledger/periods/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))

vi.mock('../../../ledger/post/auto-post', () => ({
  readAutoPostMode: async () => h.autoPostMode,
}))

vi.mock('../../../../inventory/relief', async () => {
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
        negativeQoHPartIds: [],
      })
    },
  }
})

vi.mock('../../../../resources/crud/unified-handler', () => ({
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
    transaction: async (fn: (tx: unknown) => unknown) => {
      const result = await fn({ update: () => ({ set: () => ({ where: async () => undefined }) }) })
      h.events.push('commit')
      return result
    },
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
  h.events = []
  h.postCalls = []
  h.scope = {}
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
    contactInstanceId: 'contact_1',
    taxLines: [],
  }
  h.postResult = { status: 'posted', glPostingId: 'glp_1', docNumber: 'AUXX-FUL-ORD0012F1' }
  h.updated = []
  h.created = []
  h.built = []
  h.relieved = []
  h.reliefResult = null
  h.autoPostMode = 'post'
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

  it('posts inside the transaction that records the shipment', async () => {
    await fulfillOrder(stubDb(), input)
    // The entry commits WITH the shipment now (follow-up 2), so the post is
    // inside the transaction rather than after it.
    expect(h.events).toEqual(['lock', 'post', 'commit', 'flush'])
  })

  it('posts subject/parent/counterparty sources, storeId from the order scope, and no rail', async () => {
    h.scope = { store: 'fsa_1' }
    await fulfillOrder(stubDb(), input)

    expect(h.postCalls).toHaveLength(1)
    const call = h.postCalls[0]!
    expect(call.mode).toBe('post')
    expect(call.storeId).toBe('fsa_1')
    // D11: a native shipment debits accounts_receivable, never a gateway's
    // clearing account, so it never carries a rail.
    expect(call.railId).toBeNull()
    expect(call.sources).toEqual([
      { sourceKind: 'fulfillment', sourceId: 'ful_1', linkRole: 'subject' },
      { sourceKind: 'order', sourceId: 'ord_1', linkRole: 'parent' },
      { sourceKind: 'contact', sourceId: 'contact_1', linkRole: 'counterparty' },
    ])
  })

  it('omits the counterparty source when the order has no contact', async () => {
    h.order.contactInstanceId = null
    await fulfillOrder(stubDb(), input)

    const call = h.postCalls[0]!
    expect(call.sources).toEqual([
      { sourceKind: 'fulfillment', sourceId: 'ful_1', linkRole: 'subject' },
      { sourceKind: 'order', sourceId: 'ord_1', linkRole: 'parent' },
    ])
  })

  it('resolves a null storeId for the manual bucket or an ambiguous scope', async () => {
    h.scope = { store: null }
    await fulfillOrder(stubDb(), input)
    expect(h.postCalls[0]?.storeId).toBeNull()
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

  it('hands the builder the line total, the ordered quantity and what shipped before (29 §12 item 6)', async () => {
    h.order.lines = [
      {
        lineId: 'li_1',
        name: 'Widget',
        quantity: 5,
        shippedQuantity: 2,
        remainingQuantity: 3,
        unitPriceMinor: 10_00,
        lineTotalMinor: 50_00,
        lineTaxMinor: null,
        sortOrder: 0,
      },
    ]
    await fulfillOrder(stubDb(), input)

    expect(h.built[0]?.shippedLines).toEqual([
      expect.objectContaining({
        lineId: 'li_1',
        quantity: 3,
        lineTotalMinor: 50_00,
        orderedQuantity: 5,
        priorShippedQuantity: 2,
      }),
    ])
  })

  it('passes a null line total when the line carries none, so the builder extends the rate', async () => {
    await fulfillOrder(stubDb(), input)

    expect(h.built[0]?.shippedLines).toEqual([
      expect.objectContaining({
        lineTotalMinor: null,
        orderedQuantity: 5,
        priorShippedQuantity: 0,
      }),
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
              fulfillmentId: 'ful_1',
              orderId: 'ord_1',
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

    it('relieves the actual shipment when bookkeeping refuses', async () => {
      h.postResult = { status: 'period_closed', error: 'Period locked' }
      await fulfillOrder(stubDb(), input)
      expect(h.relieved).toHaveLength(1)
    })

    it('a relief failure is logged and swallowed - fulfillOrder still returns ok', async () => {
      const { err } = await import('neverthrow')
      h.reliefResult = err(new Error('boom'))

      const result = await fulfillOrder(stubDb(), input)
      expect(result.isOk()).toBe(true)
      expect(h.created).toHaveLength(1)
    })
  })

  describe('when the ledger refuses the post', () => {
    beforeEach(() => {
      h.postResult = { status: 'period_closed', error: 'Period locked' }
    })

    it('retains the fulfillment - a refusal never rolls back the shipment', async () => {
      await fulfillOrder(stubDb(), input)
      expect(h.created).toHaveLength(1)
    })

    it('keeps the operational order status for the recorded shipment', async () => {
      await fulfillOrder(stubDb(), input)

      const statusWrites = h.updated.filter((write) => 'order_fulfillment_status' in write.values)
      expect(statusWrites.at(-1)?.values.order_fulfillment_status).toBe('partial')
    })

    it('never posts a doc number that never happened', async () => {
      const result = await fulfillOrder(stubDb(), input)
      expect(result._unsafeUnwrap().fulfillment.glPosting).toBeNull()
      expect(result._unsafeUnwrap().fulfillment.docNumber).toBeNull()
    })

    it('returns ok with the refusal on `post`, not an Err', async () => {
      const result = await fulfillOrder(stubDb(), input)
      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().post.status).toBe('period_closed')
    })
  })

  describe('when accounting is not enabled for the org', () => {
    beforeEach(() => {
      h.isAccountingEnabled.mockResolvedValue(false)
    })

    it('still creates the fulfillment record, using computeShipmentTotals directly, and never posts', async () => {
      const result = await fulfillOrder(stubDb(), input)

      expect(result.isOk()).toBe(true)
      expect(h.created).toHaveLength(1)
      expect(h.postCalls).toHaveLength(0)
      expect(result._unsafeUnwrap().post.status).toBe('not_enabled')
    })

    it('does not roll back - `not_enabled` is an expected outcome, not a refusal', async () => {
      const result = await fulfillOrder(stubDb(), input)
      expect(result.isOk()).toBe(true)
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
