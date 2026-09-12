// packages/lib/src/money/fulfillments/__tests__/reads.test.ts
//
// `readFulfillmentsForOrders` is the shared contract every other module reads
// fulfillments through (`plans/money/tasks/55-shipment-lines.md` §6) - the
// bulk poster, the credit-memo readers, the order drawer's ledger card, and
// `money/orders/reads.ts`'s single-order path. This is the one place that
// exercises the four-hop assembly end to end: which fulfillments belong to
// these orders, their own fields, which lines belong to those fulfillments,
// and the lines' fields.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({ getCachedEntityDefId: vi.fn(), getOrgCache: vi.fn() }))

import { getCachedEntityDefId, getOrgCache } from '../../../cache'
import {
  loadFulfillmentFieldContext,
  readFulfillmentsForOrder,
  readFulfillmentsForOrders,
  requireFulfillmentFieldContext,
} from '../reads'

/** `systemAttribute -> field id`, standing in for the org cache's resolved `CustomFieldEntity`s. */
const FIELD_IDS: Record<string, string> = {
  fulfillment_order: 'fld_order',
  fulfillment_sequence: 'fld_sequence',
  fulfillment_shipped_at: 'fld_shipped_at',
  fulfillment_status: 'fld_status',
  fulfillment_cancelled_at: 'fld_cancelled_at',
  fulfillment_name: 'fld_name',
  fulfillment_tracking_number: 'fld_tracking_number',
  fulfillment_tracking_company: 'fld_tracking_company',
  fulfillment_tracking_url: 'fld_tracking_url',
  fulfillment_subtotal: 'fld_subtotal',
  fulfillment_total: 'fld_total',
  fulfillment_shipping_recognised: 'fld_shipping_recognised',
  fulfillment_gl_posting: 'fld_gl_posting',
  fulfillment_doc_number: 'fld_doc_number',
  fulfillment_recorded_at: 'fld_recorded_at',
  fulfillment_line_fulfillment: 'fld_line_fulfillment',
  fulfillment_line_line_item: 'fld_line_line_item',
  fulfillment_line_quantity: 'fld_line_quantity',
  fulfillment_line_quantity_relieved: 'fld_line_quantity_relieved',
}

function allFields(): Record<string, { id: string }> {
  return Object.fromEntries(Object.entries(FIELD_IDS).map(([attr, id]) => [attr, { id }]))
}

/** A `db` whose `.select().from().where()` resolves the next queued row set. */
function stubDb(queue: unknown[][]): Database {
  let index = 0
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(queue[index++] ?? []),
      }),
    }),
  } as unknown as Database
}

beforeEach(() => {
  vi.mocked(getCachedEntityDefId).mockImplementation(async (_org: string, entityType: string) =>
    entityType === 'fulfillment'
      ? 'def_fulfillment'
      : entityType === 'fulfillment_line'
        ? 'def_fulfillment_line'
        : undefined
  )
  vi.mocked(getOrgCache).mockReturnValue({
    from: () => ({ bySystemAttributes: async () => allFields() }),
  } as unknown as ReturnType<typeof getOrgCache>)
})

describe('loadFulfillmentFieldContext / requireFulfillmentFieldContext', () => {
  it('resolves both defs and the join fields', async () => {
    const ctx = await loadFulfillmentFieldContext('org_1')
    expect(ctx?.fulfillmentDefId).toBe('def_fulfillment')
    expect(ctx?.fulfillmentLineDefId).toBe('def_fulfillment_line')
  })

  it('is null when the org has not run entity migration 153', async () => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue(undefined)
    expect(await loadFulfillmentFieldContext('org_1')).toBeNull()
  })

  it('require throws the migration refusal instead of returning null', async () => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue(undefined)
    await expect(requireFulfillmentFieldContext('org_1')).rejects.toThrow(/migration 153/i)
  })
})

describe('readFulfillmentsForOrders', () => {
  it('returns empty without querying when no order ids are given', async () => {
    const db = stubDb([])
    expect(await readFulfillmentsForOrders(db, { organizationId: 'org_1', orderIds: [] })).toEqual(
      new Map()
    )
  })

  it('returns empty when the org has no fulfillment entities yet', async () => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue(undefined)
    const db = stubDb([])
    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })
    expect(result).toEqual(new Map())
  })

  it('assembles one fulfillment with two lines from the four hops', async () => {
    const db = stubDb([
      // Hop 1: fulfillment -> order edges.
      [{ fulfillmentId: 'ful_1', orderId: 'ord_1' }],
      // Hop 2: the fulfillment's own fields.
      [
        { entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 },
        { entityId: 'ful_1', fieldId: 'fld_shipped_at', valueDate: '2026-09-03T12:00:00.000Z' },
        { entityId: 'ful_1', fieldId: 'fld_status', optionId: 'success' },
        { entityId: 'ful_1', fieldId: 'fld_name', valueText: 'ORD-1-F1' },
        { entityId: 'ful_1', fieldId: 'fld_subtotal', valueNumber: 50_00 },
        { entityId: 'ful_1', fieldId: 'fld_total', valueNumber: 55_00 },
        { entityId: 'ful_1', fieldId: 'fld_shipping_recognised', valueBoolean: true },
        { entityId: 'ful_1', fieldId: 'fld_recorded_at', valueDate: '2026-09-03T00:00:00.000Z' },
      ],
      // Hop 3: fulfillment_line -> fulfillment edges.
      [
        { lineId: 'fl_1', fulfillmentId: 'ful_1' },
        { lineId: 'fl_2', fulfillmentId: 'ful_1' },
      ],
      // Hop 4: the lines' own fields.
      [
        { entityId: 'fl_1', fieldId: 'fld_line_line_item', relatedEntityId: 'li_1' },
        { entityId: 'fl_1', fieldId: 'fld_line_quantity', valueNumber: 2 },
        { entityId: 'fl_2', fieldId: 'fld_line_line_item', relatedEntityId: 'li_2' },
        { entityId: 'fl_2', fieldId: 'fld_line_quantity', valueNumber: 3 },
        { entityId: 'fl_2', fieldId: 'fld_line_quantity_relieved', valueNumber: 1 },
      ],
    ])

    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })

    expect(result.get('ord_1')).toEqual([
      {
        id: 'ful_1',
        recordId: 'fulfillment:ful_1',
        orderId: 'ord_1',
        sequence: 1,
        shippedAt: '2026-09-03T12:00:00.000Z',
        status: 'success',
        cancelledAt: null,
        name: 'ORD-1-F1',
        trackingNumber: null,
        trackingCompany: null,
        trackingUrl: null,
        subtotalMinor: 50_00,
        totalMinor: 55_00,
        shippingRecognised: true,
        glPosting: null,
        docNumber: null,
        recordedAt: '2026-09-03T00:00:00.000Z',
        lines: [
          {
            id: 'fl_1',
            recordId: 'fulfillment_line:fl_1',
            lineItemId: 'li_1',
            quantity: 2,
            quantityRelieved: null,
          },
          {
            id: 'fl_2',
            recordId: 'fulfillment_line:fl_2',
            lineItemId: 'li_2',
            quantity: 3,
            quantityRelieved: 1,
          },
        ],
      },
    ])
  })

  it('sorts an order with several fulfillments by sequence, not by write order', async () => {
    const db = stubDb([
      [
        { fulfillmentId: 'ful_2', orderId: 'ord_1' },
        { fulfillmentId: 'ful_1', orderId: 'ord_1' },
      ],
      [
        { entityId: 'ful_2', fieldId: 'fld_sequence', valueNumber: 2 },
        { entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 },
      ],
      [], // no lines on either fulfillment
      [],
    ])

    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })
    expect(result.get('ord_1')?.map((f) => f.sequence)).toEqual([1, 2])
  })

  it('drops a fulfillment_line row with no line_item edge rather than crashing', async () => {
    const db = stubDb([
      [{ fulfillmentId: 'ful_1', orderId: 'ord_1' }],
      [{ entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 }],
      [{ lineId: 'fl_1', fulfillmentId: 'ful_1' }],
      // fl_1 carries a quantity but no line_item edge - unusable, not a crash.
      [{ entityId: 'fl_1', fieldId: 'fld_line_quantity', valueNumber: 2 }],
    ])

    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })
    expect(result.get('ord_1')?.[0]?.lines).toEqual([])
  })
})

describe('readFulfillmentsForOrder', () => {
  it('is readFulfillmentsForOrders for a single order id', async () => {
    const db = stubDb([
      [{ fulfillmentId: 'ful_1', orderId: 'ord_1' }],
      [{ entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 }],
      [],
      [],
    ])
    const result = await readFulfillmentsForOrder(db, { organizationId: 'org_1', orderId: 'ord_1' })
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('ful_1')
  })

  it('is empty for an order nothing has shipped against', async () => {
    const db = stubDb([[]])
    const result = await readFulfillmentsForOrder(db, { organizationId: 'org_1', orderId: 'ord_1' })
    expect(result).toEqual([])
  })
})
