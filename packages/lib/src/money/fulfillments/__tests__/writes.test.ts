// packages/lib/src/money/fulfillments/__tests__/writes.test.ts
//
// `createFulfillment` / `stampFulfillmentPosting` / `deleteFulfillment`: the
// three writes entity migration 153 put in place of the old JSON cell's
// whole-cell replace (`plans/money/tasks/55-shipment-lines.md` §6.1).
// `UnifiedCrudHandler` is mocked so these assert on WHAT is written - the
// values bag, the RecordId shape linking a line to its parent - rather than on
// the CRUD engine's own behaviour, which has its own tests.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createCalls: [] as Array<{ entityDefinitionId: string; values: Record<string, unknown> }>,
  createResult: { instance: { id: 'ful_1' } },
  bulkCreateCalls: [] as Array<{ entityDefinitionId: string; items: Record<string, unknown>[] }>,
  bulkCreateResult: {
    created: [{ id: 'fl_1' }, { id: 'fl_2' }] as Array<{ id: string }>,
    errors: [] as Array<{ index: number; error: string }>,
  },
  updateCalls: [] as Array<{ recordId: string; values: Record<string, unknown> }>,
  bulkDeleteCalls: [] as string[][],
  bulkDeleteResult: { count: 1, errors: [] as Array<{ recordId: string; message: string }> },
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(entityDefinitionId: string, values: Record<string, unknown>) {
      h.createCalls.push({ entityDefinitionId, values })
      return h.createResult
    }
    async bulkCreate(entityDefinitionId: string, items: Record<string, unknown>[]) {
      h.bulkCreateCalls.push({ entityDefinitionId, items })
      return h.bulkCreateResult
    }
    async update(recordId: string, values: Record<string, unknown>) {
      h.updateCalls.push({ recordId, values })
    }
    async bulkDelete(recordIds: string[]) {
      h.bulkDeleteCalls.push(recordIds)
      return h.bulkDeleteResult
    }
  },
}))

import { createFulfillment, deleteFulfillment, stampFulfillmentPosting } from '../writes'

const DB = {} as Database

beforeEach(() => {
  h.createCalls = []
  h.createResult = { instance: { id: 'ful_1' } }
  h.bulkCreateCalls = []
  h.bulkCreateResult = { created: [{ id: 'fl_1' }, { id: 'fl_2' }], errors: [] }
  h.updateCalls = []
  h.bulkDeleteCalls = []
  h.bulkDeleteResult = { count: 1, errors: [] }
})

const baseInput = {
  organizationId: 'org_1',
  actorUserId: 'user_1',
  orderInstanceId: 'ord_1',
  sequence: 1,
  shippedAt: '2026-09-03T12:00:00.000Z',
  status: 'success' as const,
  name: 'ORD-0012-F1',
  subtotalMinor: 50_00,
  totalMinor: 50_00,
  shippingRecognised: false,
  recordedAt: '2026-09-03T00:00:00.000Z',
  lines: [{ lineItemInstanceId: 'li_1', quantity: 3 }],
}

describe('createFulfillment', () => {
  it('creates the parent with the order edge and header fields', async () => {
    await createFulfillment(DB, baseInput)

    expect(h.createCalls).toHaveLength(1)
    const { entityDefinitionId, values } = h.createCalls[0]!
    expect(entityDefinitionId).toBe('fulfillment')
    expect(values.fulfillment_order).toBe('order:ord_1')
    expect(values.fulfillment_sequence).toBe(1)
    expect(values.fulfillment_status).toBe('success')
    expect(values.fulfillment_name).toBe('ORD-0012-F1')
    expect(values.fulfillment_shipping_recognised).toBe(false)
  })

  it('creates one fulfillment_line per input line, linked to the parent by RecordId', async () => {
    await createFulfillment(DB, baseInput)

    expect(h.bulkCreateCalls).toHaveLength(1)
    const { entityDefinitionId, items } = h.bulkCreateCalls[0]!
    expect(entityDefinitionId).toBe('fulfillment_line')
    expect(items).toEqual([
      {
        fulfillment_line_fulfillment: 'fulfillment:ful_1',
        fulfillment_line_line_item: 'line_item:li_1',
        fulfillment_line_quantity: 3,
      },
    ])
  })

  it('returns the created ids in input order', async () => {
    const result = await createFulfillment(DB, baseInput)
    expect(result).toEqual({
      fulfillmentInstanceId: 'ful_1',
      recordId: 'fulfillment:ful_1',
      lineInstanceIds: ['fl_1', 'fl_2'],
    })
  })

  it('omits optional fields entirely rather than writing them null', async () => {
    await createFulfillment(DB, baseInput)
    const { values } = h.createCalls[0]!
    expect(values).not.toHaveProperty('fulfillment_cancelled_at')
    expect(values).not.toHaveProperty('fulfillment_tracking_number')
  })

  it('throws naming the line when a line fails to create', async () => {
    h.bulkCreateResult = { created: [], errors: [{ index: 0, error: 'boom' }] }
    await expect(createFulfillment(DB, baseInput)).rejects.toThrow(/line 1.*boom/i)
  })
})

describe('stampFulfillmentPosting', () => {
  it('writes glPosting and docNumber as an ordinary field update', async () => {
    await stampFulfillmentPosting(DB, {
      organizationId: 'org_1',
      actorUserId: 'user_1',
      fulfillmentInstanceId: 'ful_1',
      patch: { glPosting: 'gp_1', docNumber: 'AUXX-FUL-1' },
    })
    expect(h.updateCalls).toEqual([
      {
        recordId: 'fulfillment:ful_1',
        values: { fulfillment_gl_posting: 'gp_1', fulfillment_doc_number: 'AUXX-FUL-1' },
      },
    ])
  })

  it('carries recomputed totals only when the caller supplies them', async () => {
    await stampFulfillmentPosting(DB, {
      organizationId: 'org_1',
      actorUserId: 'user_1',
      fulfillmentInstanceId: 'ful_1',
      patch: { glPosting: 'gp_1', docNumber: null, totalMinor: 900, subtotalMinor: 800 },
    })
    expect(h.updateCalls[0]?.values).toMatchObject({
      fulfillment_total: 900,
      fulfillment_subtotal: 800,
    })
  })

  it('leaves totals untouched when the patch does not carry them', async () => {
    await stampFulfillmentPosting(DB, {
      organizationId: 'org_1',
      actorUserId: 'user_1',
      fulfillmentInstanceId: 'ful_1',
      patch: { glPosting: null, docNumber: null },
    })
    expect(h.updateCalls[0]?.values).not.toHaveProperty('fulfillment_total')
    expect(h.updateCalls[0]?.values).not.toHaveProperty('fulfillment_subtotal')
  })
})

describe('deleteFulfillment', () => {
  it('deletes the record by RecordId, taking its lines with it (registry cascade)', async () => {
    await deleteFulfillment(DB, {
      organizationId: 'org_1',
      actorUserId: 'user_1',
      fulfillmentInstanceId: 'ful_1',
    })
    expect(h.bulkDeleteCalls).toEqual([['fulfillment:ful_1']])
  })

  it('throws rather than silently reporting success when nothing was deleted', async () => {
    h.bulkDeleteResult = { count: 0, errors: [] }
    await expect(
      deleteFulfillment(DB, {
        organizationId: 'org_1',
        actorUserId: 'user_1',
        fulfillmentInstanceId: 'ful_1',
      })
    ).rejects.toThrow(/failed to roll back/i)
  })

  it('throws when the engine reports a per-row error', async () => {
    h.bulkDeleteResult = {
      count: 0,
      errors: [{ recordId: 'fulfillment:ful_1', message: 'restricted' }],
    }
    await expect(
      deleteFulfillment(DB, {
        organizationId: 'org_1',
        actorUserId: 'user_1',
        fulfillmentInstanceId: 'ful_1',
      })
    ).rejects.toThrow(/restricted/)
  })
})
