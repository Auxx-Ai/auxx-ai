// packages/lib/src/money/billing-coalescing.test.ts
//
// Plan 08 phase 2c, through the real hooks.
//
// The billing projectors arrived with two of their three legs already right — a
// batched child read and a no-op write guard — so the only thing this pins is the
// third: that N hook fires produce ONE rebuild. Nothing in the existing suite
// could see that, because these six hooks had no test coverage at all before this
// file, and every projection assertion would pass identically at 30 rebuilds and
// at one.
//
// The witness is `syncWorkOrderBillingProjection` itself, mocked and counted.
// The money and purchasing coalescing tests had to proxy through `listFiltered`
// because their rebuild function lived in the module under test; here the
// projectors live in `./billing-projection`, a separate module the reconciler
// lazy-imports, so it can be intercepted and counted directly. That is a truer
// witness — it counts rebuilds, not a query that happens to accompany one.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent, EntityPostDeleteEvent } from '../field-hooks/types'
import { runWithDirtyParents } from '../reconcilers/dirty-parents'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  syncWorkOrder: vi.fn(),
  syncInvoice: vi.fn(),
  syncContact: vi.fn(),
  recomputeTotals: vi.fn(),
  /** `FieldValue` rows for `readFieldRelations`' set-based read. */
  relationRows: vi.fn(),
}))

vi.mock('../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('./billing-projection', () => ({
  syncWorkOrderBillingProjection: h.syncWorkOrder,
  syncInvoiceBillingProjection: h.syncInvoice,
  syncContactBillingProjection: h.syncContact,
}))
vi.mock('./totals-hooks', () => ({ recomputeTotals: h.recomputeTotals }))
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../database/src/db/schema/index')
  return {
    schema,
    database: { select: () => ({ from: () => ({ where: () => h.relationRows() }) }) },
  }
})

import {
  syncBillingAfterInvoiceDelete,
  syncBillingAfterLineDelete,
  syncBillingOnInvoiceChange,
  syncBillingOnLineChange,
  syncBillingOnWorkOrderChange,
  syncContactAfterWorkOrderDelete,
} from './billing-hooks'
import { registerBillingReconcilers } from './billing-reconciler'

const FIELDS: Record<string, { id: string; type: string }> = {
  line_item_work_order: { id: 'f-li-wo', type: 'RELATIONSHIP' },
}

const ORG = 'org_1'
const USER = 'usr_1'

/** A source line pointing at `wo-1`, as the set-based relation read sees it. */
const lineOnWorkOrder = (lineId: string, workOrderId = 'wo-1') => ({
  entityId: lineId,
  fieldId: 'f-li-wo',
  relatedEntityId: workOrderId,
})

const lineEvent = (lineId: string, systemAttribute: string) =>
  ({
    recordId: `line_item:${lineId}`,
    organizationId: ORG,
    userId: USER,
    field: { id: 'f', systemAttribute, type: 'CURRENCY' },
  }) as unknown as EntityFieldChangeEvent

const recordEvent = (recordId: string, systemAttribute: string) =>
  ({
    recordId,
    organizationId: ORG,
    userId: USER,
    field: { id: 'f', systemAttribute, type: 'TEXT' },
  }) as unknown as EntityFieldChangeEvent

const deleteEvent = (values: Record<string, unknown>) =>
  ({ organizationId: ORG, userId: USER, values }) as unknown as EntityPostDeleteEvent

/** Work-order projection rebuilds. */
const rebuilds = () => h.syncWorkOrder.mock.calls.length

beforeAll(() => {
  registerBillingReconcilers()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
  )
  h.syncWorkOrder.mockResolvedValue(undefined)
  h.syncInvoice.mockResolvedValue(undefined)
  h.syncContact.mockResolvedValue(undefined)
  h.recomputeTotals.mockResolvedValue(undefined)
  h.relationRows.mockResolvedValue([])
})

describe('a write rebuilds a projection once', () => {
  it('collapses 30 line fires on one work order into ONE rebuild', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `li-${i}`)
    h.relationRows.mockResolvedValue(lines.map((id) => lineOnWorkOrder(id)))

    await runWithDirtyParents(ORG, USER, async () => {
      for (const id of lines) {
        // The three trigger attributes one line write moves.
        await syncBillingOnLineChange(lineEvent(id, 'line_item_qty'))
        await syncBillingOnLineChange(lineEvent(id, 'line_item_unit_price'))
        await syncBillingOnLineChange(lineEvent(id, 'line_item_work_order'))
      }
    })

    expect(rebuilds()).toBe(1)
    expect(h.syncWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({ workOrderInstanceId: 'wo-1' })
    )
  })

  it('resolves every line parent in ONE relation query, not one per fire', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `li-${i}`)
    h.relationRows.mockResolvedValue(lines.map((id) => lineOnWorkOrder(id)))

    await runWithDirtyParents(ORG, USER, async () => {
      for (const id of lines) await syncBillingOnLineChange(lineEvent(id, 'line_item_qty'))
    })

    expect(h.relationRows).toHaveBeenCalledTimes(1)
  })

  it('still rebuilds each distinct work order', async () => {
    h.relationRows.mockResolvedValue([
      lineOnWorkOrder('li-1', 'wo-1'),
      lineOnWorkOrder('li-2', 'wo-2'),
    ])

    await runWithDirtyParents(ORG, USER, async () => {
      await syncBillingOnLineChange(lineEvent('li-1', 'line_item_qty'))
      await syncBillingOnLineChange(lineEvent('li-2', 'line_item_qty'))
    })

    expect(rebuilds()).toBe(2)
  })

  it('collapses several work-order attribute fires into one rebuild', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await syncBillingOnWorkOrderChange(recordEvent('work_order:wo-1', 'work_order_status'))
      await syncBillingOnWorkOrderChange(recordEvent('work_order:wo-1', 'work_order_pricing_model'))
    })

    expect(rebuilds()).toBe(1)
  })

  it('rebuilds nothing for a line that hangs off no work order', async () => {
    h.relationRows.mockResolvedValue([])

    await runWithDirtyParents(ORG, USER, async () => {
      await syncBillingOnLineChange(lineEvent('li-1', 'line_item_qty'))
    })

    expect(rebuilds()).toBe(0)
  })

  it('ignores an attribute outside the trigger set', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await syncBillingOnLineChange(lineEvent('li-1', 'line_item_description'))
    })

    expect(h.relationRows).not.toHaveBeenCalled()
    expect(rebuilds()).toBe(0)
  })

  it('still refuses to re-enter on a field the projector itself writes', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await syncBillingOnWorkOrderChange(
        recordEvent('work_order:wo-1', 'work_order_uninvoiced_amount')
      )
    })

    expect(rebuilds()).toBe(0)
  })
})

describe('the unscoped fallback', () => {
  it('rebuilds inline when no write method opened a scope', async () => {
    h.relationRows.mockResolvedValue([lineOnWorkOrder('li-1')])

    // No `runWithDirtyParents` — the shape of a caller that reached the hook chain
    // through an exported `field-value-mutations` function.
    await syncBillingOnLineChange(lineEvent('li-1', 'line_item_qty'))

    expect(rebuilds()).toBe(1)
  })

  it('rebuilds a work-order change inline too', async () => {
    await syncBillingOnWorkOrderChange(recordEvent('work_order:wo-1', 'work_order_status'))
    expect(rebuilds()).toBe(1)
  })

  it('rebuilds an invoice change inline too', async () => {
    await syncBillingOnInvoiceChange(recordEvent('invoice:inv-1', 'invoice_status'))
    expect(h.syncInvoice).toHaveBeenCalledTimes(1)
  })
})

describe('the delete paths', () => {
  it('coalesces a bulk work-order delete onto one contact aggregate', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      for (const id of ['wo-1', 'wo-2', 'wo-3']) {
        await syncContactAfterWorkOrderDelete(
          deleteEvent({ work_order_contact: `contact:c-1`, id })
        )
      }
    })

    expect(h.syncContact).toHaveBeenCalledTimes(1)
  })

  it('coalesces several invoice deletes onto one work order', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      for (const _ of [1, 2, 3]) {
        await syncBillingAfterInvoiceDelete(deleteEvent({ invoice_work_order: 'work_order:wo-1' }))
      }
    })

    expect(rebuilds()).toBe(1)
  })

  it('rebuilds nothing when the delete captured no parent', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await syncBillingAfterInvoiceDelete(deleteEvent({}))
      await syncContactAfterWorkOrderDelete(deleteEvent({}))
    })

    expect(rebuilds()).toBe(0)
    expect(h.syncContact).not.toHaveBeenCalled()
  })

  it('a deleted work-order source line rebuilds its work order', async () => {
    await runWithDirtyParents(ORG, USER, async () => {
      await syncBillingAfterLineDelete(deleteEvent({ line_item_work_order: 'work_order:wo-1' }))
    })

    expect(rebuilds()).toBe(1)
    expect(h.recomputeTotals).not.toHaveBeenCalled()
  })

  it('keeps the invoice totals recompute INLINE and ahead of the projection', async () => {
    // The invoice projector cascades to the work order, whose projection reads
    // `invoice_total` — so the totals must land before the projection runs. If
    // both were marked, that dependency would ride on key insertion order.
    const order: string[] = []
    h.recomputeTotals.mockImplementation(async () => {
      order.push('totals')
    })
    h.syncInvoice.mockImplementation(async () => {
      order.push('projection')
    })

    await runWithDirtyParents(ORG, USER, async () => {
      await syncBillingAfterLineDelete(deleteEvent({ line_item_invoice: 'invoice:inv-1' }))
      // The totals recompute has already happened, inside the write.
      expect(order).toEqual(['totals'])
    })

    expect(order).toEqual(['totals', 'projection'])
  })
})
