// packages/lib/src/accounting/sales/fulfillments/__tests__/totals-reconciler.test.ts
//
// Plan 78 §4.3 / events 10 R4: two mark handlers, keyed on the ORDER through either a
// one-hop (fulfillment -> order) or two-hop (line -> fulfillment -> order) resolve, so a
// synced shipment's totals reach the buffered and sync lanes as well as the inline one.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldChangeRef } from '../../../../field-hooks/types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  readFieldRelations: vi.fn(),
  stampOrderShipmentTotals: vi.fn(),
  publishStampBatch: vi.fn(),
  isFulfillmentCancelled: vi.fn(),
  reverseFulfillmentPosting: vi.fn(),
  repostCreditMemosForCancelledFulfillment: vi.fn(),
}))

// Real `defineParentReconciler` + real `resolveParentsByRelation` (plan 78's ladder is
// two calls to it); only the two queries underneath are stubbed, the same seam
// `resolve-parents-by-relation.test.ts` uses to exercise the real resolver with no DB.
vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../../../field-values/read-field-scalars', () => ({
  readFieldRelations: h.readFieldRelations,
}))
vi.mock('../stamp-totals', () => ({
  stampOrderShipmentTotals: h.stampOrderShipmentTotals,
  createStampBatch: () => ({ fieldRefKeys: new Set(), fulfillmentIds: new Set() }),
  publishStampBatch: h.publishStampBatch,
}))
vi.mock('../reads', () => ({ isFulfillmentCancelled: h.isFulfillmentCancelled }))
vi.mock('../../orders/fulfill', () => ({
  reverseFulfillmentPosting: h.reverseFulfillmentPosting,
}))
vi.mock('../../credit-memos/repost', () => ({
  repostCreditMemosForCancelledFulfillment: h.repostCreditMemosForCancelledFulfillment,
}))
vi.mock('@auxx/database', () => ({ database: {} }))

import { runWithDirtyParents } from '../../../../reconcilers/dirty-parents'
import {
  registerFulfillmentTotalsReconcilers,
  stampOrders,
  stampTotalsOnFulfillmentChange,
  stampTotalsOnFulfillmentLineChange,
} from '../totals-reconciler'

const ORG = 'org_1'
const USER = 'usr_1'

const RELATION_FIELDS: Record<string, { id: string }> = {
  fulfillment_line_fulfillment: { id: 'f-line-fulfillment' },
  fulfillment_order: { id: 'f-fulfillment-order' },
}
const FIELD_ID_TO_ATTR: Record<string, string> = Object.fromEntries(
  Object.entries(RELATION_FIELDS).map(([attr, f]) => [f.id, attr])
)

/** `fieldId -> childInstanceId -> parentInstanceId`, set per test. */
let relations: Record<string, Record<string, string>> = {}

function lineEvent(
  instanceId: string,
  systemAttribute: string,
  oldValue?: unknown
): FieldChangeRef {
  return {
    recordId: `fulfillment_line_def:${instanceId}`,
    entityDefinitionId: 'fulfillment_line_def',
    entityType: 'fulfillment_line',
    entitySlug: 'fulfillment-lines',
    field: { id: 'f', systemAttribute } as FieldChangeRef['field'],
    organizationId: ORG,
    userId: USER,
    ...(oldValue !== undefined ? { oldValue } : {}),
  } as FieldChangeRef
}

function fulfillmentEvent(
  instanceId: string,
  systemAttribute: string,
  isCreate?: boolean
): FieldChangeRef {
  return {
    recordId: `fulfillment_def:${instanceId}`,
    entityDefinitionId: 'fulfillment_def',
    entityType: 'fulfillment',
    entitySlug: 'fulfillments',
    field: { id: 'f', systemAttribute } as FieldChangeRef['field'],
    organizationId: ORG,
    userId: USER,
    ...(isCreate ? { isCreate } : {}),
  } as FieldChangeRef
}

beforeAll(() => {
  registerFulfillmentTotalsReconcilers()
})

beforeEach(() => {
  vi.clearAllMocks()
  relations = {}
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => RELATION_FIELDS[a]).map((a) => [a, RELATION_FIELDS[a]]))
  )
  h.readFieldRelations.mockImplementation(
    async (_db: unknown, _org: string, childIds: string[], fieldIds: string[]) => {
      const fieldId = fieldIds[0]!
      const table = relations[FIELD_ID_TO_ATTR[fieldId]!]
      const out = new Map<string, Map<string, string>>()
      for (const childId of childIds) {
        const parent = table?.[childId]
        if (parent) out.set(childId, new Map([[fieldId, parent]]))
      }
      return out
    }
  )
  h.stampOrderShipmentTotals.mockResolvedValue({ fulfillmentsWritten: 0, skippedPosted: 0 })
  h.isFulfillmentCancelled.mockResolvedValue(false)
  h.reverseFulfillmentPosting.mockResolvedValue(null)
})

describe('stampTotalsOnFulfillmentLineChange', () => {
  it('coalesces two line changes on one order into one mark and one stamp', async () => {
    relations = {
      fulfillment_line_fulfillment: { line_1: 'ff_1', line_2: 'ff_1' },
      fulfillment_order: { ff_1: 'order_1' },
    }

    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentLineChange(lineEvent('line_1', 'fulfillment_line_quantity'))
      await stampTotalsOnFulfillmentLineChange(lineEvent('line_2', 'fulfillment_line_quantity'))
    })

    expect(h.stampOrderShipmentTotals).toHaveBeenCalledTimes(1)
    expect(h.stampOrderShipmentTotals).toHaveBeenCalledWith({}, ORG, 'order_1', {})
  })

  it('ignores an attribute the stamp does not depend on', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentLineChange(
        lineEvent('line_1', 'fulfillment_line_quantity_relieved')
      )
    })

    expect(h.stampOrderShipmentTotals).not.toHaveBeenCalled()
  })

  it('a re-pointed line marks both the new order and the one it vacated', async () => {
    relations = {
      // The line's relation reads the NEW fulfillment by the time the drain runs.
      fulfillment_line_fulfillment: { line_1: 'ff_new' },
      fulfillment_order: { ff_new: 'order_new', ff_old: 'order_old' },
    }

    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentLineChange(
        lineEvent('line_1', 'fulfillment_line_fulfillment', 'fulfillment_def:ff_old')
      )
    })

    expect(h.stampOrderShipmentTotals).toHaveBeenCalledTimes(2)
    const orders = h.stampOrderShipmentTotals.mock.calls.map((c) => c[2]).sort()
    expect(orders).toEqual(['order_new', 'order_old'])
  })

  it('a re-point with no oldValue (the sync lane) marks only the current order', async () => {
    relations = {
      fulfillment_line_fulfillment: { line_1: 'ff_new' },
      fulfillment_order: { ff_new: 'order_new' },
    }

    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentLineChange(lineEvent('line_1', 'fulfillment_line_fulfillment'))
    })

    expect(h.stampOrderShipmentTotals).toHaveBeenCalledTimes(1)
    expect(h.stampOrderShipmentTotals).toHaveBeenCalledWith({}, ORG, 'order_new', {})
  })
})

describe('stampTotalsOnFulfillmentChange', () => {
  it('marks the order a fulfillment status change belongs to', async () => {
    relations = { fulfillment_order: { ff_1: 'order_1' } }

    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_status'))
    })

    expect(h.stampOrderShipmentTotals).toHaveBeenCalledTimes(1)
    expect(h.stampOrderShipmentTotals).toHaveBeenCalledWith({}, ORG, 'order_1', {})
  })

  it('does not mark on a write to the fields the stamp itself writes', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_subtotal'))
    })

    expect(h.stampOrderShipmentTotals).not.toHaveBeenCalled()
  })
})

// 88 D9: `reverseFulfillmentPosting` gets its first caller. A cancellation that
// arrives from the connector frees the claim before the order is re-stamped.
describe('a cancelled shipment reverses', () => {
  beforeEach(() => {
    relations = { fulfillment_order: { ff_1: 'order_1' } }
    h.isFulfillmentCancelled.mockResolvedValue(true)
  })

  it('reverses the live posting BEFORE the stamp re-walks the order', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_status'))
    })

    expect(h.reverseFulfillmentPosting).toHaveBeenCalledWith(
      {},
      {
        organizationId: ORG,
        fulfillmentInstanceId: 'ff_1',
        actorUserId: USER,
        memo: expect.any(String),
      }
    )
    expect(h.reverseFulfillmentPosting.mock.invocationCallOrder[0]!).toBeLessThan(
      h.stampOrderShipmentTotals.mock.invocationCallOrder[0]!
    )
  })

  // 91 §4.8: the pair nets - the memo on the order re-reads its lines after the reversal.
  it('re-posts the order memos after the shipment reversal', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_status'))
    })

    expect(h.repostCreditMemosForCancelledFulfillment).toHaveBeenCalledWith(
      {},
      { organizationId: ORG, fulfillmentInstanceId: 'ff_1', actorUserId: USER }
    )
    expect(h.reverseFulfillmentPosting.mock.invocationCallOrder[0]!).toBeLessThan(
      h.repostCreditMemosForCancelledFulfillment.mock.invocationCallOrder[0]!
    )
  })

  it('re-posts no memo for a shipment that is not cancelled', async () => {
    h.isFulfillmentCancelled.mockResolvedValue(false)

    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_status'))
    })

    expect(h.repostCreditMemosForCancelledFulfillment).not.toHaveBeenCalled()
  })

  it('reverses on `fulfillment_cancelled_at` too, since either write may land first', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_cancelled_at'))
    })

    expect(h.reverseFulfillmentPosting).toHaveBeenCalledTimes(1)
  })

  it('is a no-op, not an error, when the shipment never posted', async () => {
    // `reverseFulfillmentPosting` answers `null` with no live posting, which is
    // what makes the mark lane's "cancelled now, cause unknown" safe to repeat.
    h.reverseFulfillmentPosting.mockResolvedValue(null)

    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_status'))
    })

    expect(h.stampOrderShipmentTotals).toHaveBeenCalledTimes(1)
  })

  it('still stamps when the reversal throws', async () => {
    h.reverseFulfillmentPosting.mockRejectedValue(new Error('period locked'))

    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_status'))
    })

    expect(h.stampOrderShipmentTotals).toHaveBeenCalledTimes(1)
  })

  it('does not reverse a shipment that is not cancelled', async () => {
    h.isFulfillmentCancelled.mockResolvedValue(false)

    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_status'))
    })

    expect(h.reverseFulfillmentPosting).not.toHaveBeenCalled()
  })

  it('does not read the record at all on the sequence field or on a create', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_sequence'))
      await stampTotalsOnFulfillmentChange(fulfillmentEvent('ff_1', 'fulfillment_status', true))
    })

    expect(h.isFulfillmentCancelled).not.toHaveBeenCalled()
    expect(h.reverseFulfillmentPosting).not.toHaveBeenCalled()
  })
})

describe('stampOrders — announcement', () => {
  it('the inline drain leaves each stamp to publish its own frame', async () => {
    await stampOrders(ORG, USER, ['order_1', 'order_2'])

    expect(h.stampOrderShipmentTotals).toHaveBeenCalledWith({}, ORG, 'order_1', {
      batch: undefined,
    })
    expect(h.publishStampBatch).not.toHaveBeenCalled()
  })

  it('a sync-lane drain shares one batch across orders and publishes it once', async () => {
    await stampOrders(ORG, USER, ['order_1', 'order_2'], { lane: 'sync' })

    const batches = h.stampOrderShipmentTotals.mock.calls.map((c) => c[3]?.batch)
    expect(batches[0]).toBeDefined()
    expect(batches[1]).toBe(batches[0])
    expect(h.publishStampBatch).toHaveBeenCalledTimes(1)
    expect(h.publishStampBatch).toHaveBeenCalledWith(ORG, batches[0])
  })

  it('a failed order still publishes the batch for the rest', async () => {
    h.stampOrderShipmentTotals.mockRejectedValueOnce(new Error('boom'))

    await stampOrders(ORG, USER, ['order_1', 'order_2'], { lane: 'sync' })

    expect(h.stampOrderShipmentTotals).toHaveBeenCalledTimes(2)
    expect(h.publishStampBatch).toHaveBeenCalledTimes(1)
  })
})
