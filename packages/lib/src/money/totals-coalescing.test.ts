// packages/lib/src/money/totals-coalescing.test.ts
//
// Plan 08 phase 2, end to end through the real hooks.
//
// The post-write hook chain is dispatched per `(record, field)`, so before this
// a 20-line paste recomputed the same quote 40 times. Nothing in the money suite
// could see that: every totals assertion passes identically at 40 recomputes and
// at one. `listFiltered` is the witness — `recomputeDocumentTotals` calls it
// exactly once per document rebuild, so counting it counts rebuilds.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent } from '../field-hooks/types'
import { runWithDirtyParents } from '../reconcilers/dirty-parents'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  listFiltered: vi.fn(),
  setValuesForEntity: vi.fn(),
  syncInvoicePaymentState: vi.fn(),
  /** `select()` with no projection — the LINE VALUE read in `totals-hooks`. */
  fieldValueRows: vi.fn(),
  /** `select({...})` — the RELATION read in `totals-reconciler`. */
  relationRows: vi.fn(),
}))

vi.mock('../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../resources/crud', () => ({
  UnifiedCrudHandler: class {
    getFieldValues = h.getFieldValues
    listFiltered = h.listFiltered
  },
}))
vi.mock('../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
vi.mock('./payments/ledger', () => ({ syncInvoicePaymentState: h.syncInvoicePaymentState }))
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../database/src/db/schema/index')
  return {
    schema,
    database: {
      // The two set-based reads are told apart by their projection: the line
      // VALUE read takes no argument, the relation read names three columns.
      select: (projection?: unknown) => ({
        from: () => ({ where: () => (projection ? h.relationRows() : h.fieldValueRows()) }),
      }),
    },
  }
})

import {
  recomputeOnLineChange,
  recomputeOnPurchaseOrderLineChange,
  recomputeOnQuoteBillingChange,
} from './totals-hooks'
import { registerMoneyTotalsReconcilers } from './totals-reconciler'

const FIELDS: Record<string, { id: string; type: string }> = {
  quote_discount_type: { id: 'f-q-dtype', type: 'SINGLE_SELECT' },
  quote_discount_value: { id: 'f-q-dvalue', type: 'CURRENCY' },
  quote_tax_rate: { id: 'f-q-rate', type: 'NUMBER' },
  quote_subtotal: { id: 'f-q-subtotal', type: 'CURRENCY' },
  quote_tax_total: { id: 'f-q-taxtotal', type: 'CURRENCY' },
  quote_total: { id: 'f-q-total', type: 'CURRENCY' },
  line_item_line_total: { id: 'f-li-total', type: 'CURRENCY' },
  line_item_taxable: { id: 'f-li-taxable', type: 'BOOLEAN' },
  line_item_quote: { id: 'f-li-quote', type: 'RELATIONSHIP' },
  line_item_invoice: { id: 'f-li-invoice', type: 'RELATIONSHIP' },
  line_item_order: { id: 'f-li-order', type: 'RELATIONSHIP' },
  line_item_work_order: { id: 'f-li-wo', type: 'RELATIONSHIP' },
  purchase_order_discount_value: { id: 'f-po-discount', type: 'CURRENCY' },
  purchase_order_shipping_total: { id: 'f-po-shipping', type: 'CURRENCY' },
  purchase_order_tax_total: { id: 'f-po-tax', type: 'CURRENCY' },
  purchase_order_subtotal: { id: 'f-po-subtotal', type: 'CURRENCY' },
  purchase_order_total: { id: 'f-po-total', type: 'CURRENCY' },
  purchase_order_line_line_total: { id: 'f-pol-total', type: 'CURRENCY' },
  purchase_order_line_purchase_order: { id: 'f-pol-po', type: 'RELATIONSHIP' },
}

function lineEvent(lineInstanceId: string, systemAttribute: string): EntityFieldChangeEvent {
  return {
    recordId: `line_item:${lineInstanceId}`,
    organizationId: 'org_1',
    userId: 'usr_1',
    field: { id: 'f', systemAttribute, type: 'CURRENCY' },
  } as unknown as EntityFieldChangeEvent
}

/** How many times a whole document was rebuilt. */
const rebuilds = () => h.listFiltered.mock.calls.length

beforeAll(() => {
  registerMoneyTotalsReconcilers()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
  )
  h.setValuesForEntity.mockResolvedValue(undefined)
  h.syncInvoicePaymentState.mockResolvedValue(undefined)
  h.listFiltered.mockResolvedValue({ ids: [] })
  h.getFieldValues.mockResolvedValue(new Map())
  h.fieldValueRows.mockResolvedValue([])
  h.relationRows.mockResolvedValue([])
})

describe('a paste rebuilds the document once', () => {
  it('collapses 40 line fires on one quote into ONE rebuild', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `li-${i}`)
    h.relationRows.mockResolvedValue(
      lines.map((id) => ({ entityId: id, fieldId: 'f-li-quote', relatedEntityId: 'q-1' }))
    )

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      for (const id of lines) {
        // The two attributes one line write sets — two dispatches, as in production.
        await recomputeOnLineChange(lineEvent(id, 'line_item_qty'))
        await recomputeOnLineChange(lineEvent(id, 'line_item_unit_price'))
      }
    })

    expect(rebuilds()).toBe(1)
  })

  it('resolves every line parent in ONE relation query, not one ladder per line', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `li-${i}`)
    h.relationRows.mockResolvedValue(
      lines.map((id) => ({ entityId: id, fieldId: 'f-li-quote', relatedEntityId: 'q-1' }))
    )

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      for (const id of lines) await recomputeOnLineChange(lineEvent(id, 'line_item_taxable'))
    })

    expect(h.relationRows).toHaveBeenCalledTimes(1)
  })

  it('still rebuilds each distinct document', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-li-quote', relatedEntityId: 'q-1' },
      { entityId: 'li-2', fieldId: 'f-li-quote', relatedEntityId: 'q-2' },
    ])

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      await recomputeOnLineChange(lineEvent('li-1', 'line_item_taxable'))
      await recomputeOnLineChange(lineEvent('li-2', 'line_item_taxable'))
    })

    expect(rebuilds()).toBe(2)
  })

  it('does not rebuild anything for an attribute outside the trigger set', async () => {
    await runWithDirtyParents('org_1', 'usr_1', async () => {
      await recomputeOnLineChange(lineEvent('li-1', 'line_item_description'))
    })

    expect(h.relationRows).not.toHaveBeenCalled()
    expect(rebuilds()).toBe(0)
  })
})

describe('the parent ladder is preserved when batched', () => {
  it('prefers the quote over an invoice on the same line', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-li-invoice', relatedEntityId: 'inv-1' },
      { entityId: 'li-1', fieldId: 'f-li-quote', relatedEntityId: 'q-1' },
    ])

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      await recomputeOnLineChange(lineEvent('li-1', 'line_item_taxable'))
    })

    expect(
      (
        h.listFiltered.mock.calls[0]![0] as {
          filters: Array<{ conditions: Array<{ value: string }> }>
        }
      ).filters[0]!.conditions[0]!.value
    ).toBe('quote:q-1')
  })

  it('refuses the invoice when the line carries a work order — a WO copy must not count twice', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-li-invoice', relatedEntityId: 'inv-1' },
      { entityId: 'li-1', fieldId: 'f-li-wo', relatedEntityId: 'wo-1' },
    ])

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      await recomputeOnLineChange(lineEvent('li-1', 'line_item_taxable'))
    })

    expect(rebuilds()).toBe(0)
  })

  it('falls through to the order when there is no quote and no invoice', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-li-order', relatedEntityId: 'ord-1' },
    ])

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      await recomputeOnLineChange(lineEvent('li-1', 'line_item_taxable'))
    })

    expect(
      (
        h.listFiltered.mock.calls[0]![0] as {
          filters: Array<{ conditions: Array<{ value: string }> }>
        }
      ).filters[0]!.conditions[0]!.value
    ).toBe('order:ord-1')
  })

  it('rebuilds nothing for an orphaned line', async () => {
    h.relationRows.mockResolvedValue([])

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      await recomputeOnLineChange(lineEvent('li-1', 'line_item_taxable'))
    })

    expect(rebuilds()).toBe(0)
  })

  it('resolves a purchase order line through its single relation', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'pol-1', fieldId: 'f-pol-po', relatedEntityId: 'po-1' },
      { entityId: 'pol-2', fieldId: 'f-pol-po', relatedEntityId: 'po-1' },
    ])

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      for (const id of ['pol-1', 'pol-2']) {
        await recomputeOnPurchaseOrderLineChange({
          recordId: `purchase_order_line:${id}`,
          organizationId: 'org_1',
          userId: 'usr_1',
          field: {
            id: 'f',
            systemAttribute: 'purchase_order_line_quantity_ordered',
            type: 'NUMBER',
          },
        } as unknown as EntityFieldChangeEvent)
      }
    })

    expect(rebuilds()).toBe(1)
    expect(
      (h.listFiltered.mock.calls[0]![0] as { entityDefinitionId: string }).entityDefinitionId
    ).toBe('purchase_order_line')
  })
})

describe('the unscoped fallback', () => {
  it('rebuilds inline when no write method opened a scope', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-li-quote', relatedEntityId: 'q-1' },
    ])

    // No `runWithDirtyParents` — this is the shape of a caller that reached the
    // hook chain through an exported `field-value-mutations` function.
    await recomputeOnLineChange(lineEvent('li-1', 'line_item_taxable'))

    expect(rebuilds()).toBe(1)
  })

  it('rebuilds a header change inline too', async () => {
    await recomputeOnQuoteBillingChange({
      recordId: 'quote:q-1',
      organizationId: 'org_1',
      userId: 'usr_1',
      field: { id: 'f', systemAttribute: 'quote_tax_rate', type: 'NUMBER' },
    } as unknown as EntityFieldChangeEvent)

    expect(rebuilds()).toBe(1)
  })
})
