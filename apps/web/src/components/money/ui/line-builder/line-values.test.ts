// apps/web/src/components/money/ui/line-builder/line-values.test.ts
//
// The row ↔ `Line` adapters. The per-kind rules themselves (writable keys, cross-fill,
// mismatch) are pinned in packages/lib/src/accounting/documents/lines/__tests__/client.test.ts.

import { LINE_KINDS, type Line } from '@auxx/lib/accounting/documents/lines/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { describe, expect, it } from 'vitest'
import {
  crossFillAmount,
  DEFAULT_LINE_VALUES,
  diffLineValues,
  draftCreateInput,
  hasAmountMismatch,
  lineValuesFromLine,
  partCellAttrs,
  toLinePatch,
} from './line-values'

const DEFS = { part: 'def_part', purchase_order_line: 'def_pol', vendor_bill: 'def_vb' }

function line(overrides: Partial<Line>): Line {
  return {
    id: 'l1',
    documentType: 'quote',
    documentId: 'q1',
    sortOrder: 0,
    name: null,
    description: null,
    category: null,
    unit: null,
    qty: null,
    unitPrice: null,
    discount: null,
    taxable: null,
    lineTotal: null,
    netTotal: null,
    taxTotal: null,
    optional: null,
    optionalSelected: null,
    partId: null,
    visitId: null,
    sourceLineId: null,
    fulfilledAt: null,
    fulfilledQty: null,
    shipmentCount: null,
    sourceLineItemId: null,
    disposition: null,
    vendorPartId: null,
    quantityReceived: null,
    quantityBilled: null,
    weight: null,
    glAccountId: null,
    landedBillId: null,
    purchaseOrderLineId: null,
    vendorCode: null,
    returnsStock: null,
    ...overrides,
  }
}

describe('lineValuesFromLine', () => {
  it('applies the display defaults to a raw line', () => {
    const values = lineValuesFromLine(line({}), LINE_KINDS.quote, DEFS)
    expect(values).toMatchObject({ name: '', qty: 1, taxable: true, optional: false })
    expect(values.optionalSelected).toBe(true)
  })

  it('addresses relationships under the target def', () => {
    const values = lineValuesFromLine(
      line({ partId: 'p1', purchaseOrderLineId: 'pol1', landedBillId: 'vb1' }),
      LINE_KINDS.vendor_bill,
      DEFS
    )
    expect(values.partRecordId).toBe('def_part:p1')
    expect(values.purchaseOrderLineRecordId).toBe('def_pol:pol1')
    expect(values.landedBillRecordId).toBe('def_vb:vb1')
  })

  it('reads the amount only where the kind stores it', () => {
    expect(lineValuesFromLine(line({ lineTotal: 500 }), LINE_KINDS.quote, DEFS).lineTotal).toBe(
      null
    )
    expect(
      lineValuesFromLine(line({ lineTotal: 500 }), LINE_KINDS.vendor_bill, DEFS).lineTotal
    ).toBe(500)
  })

  it('ignores a stored optional flag on a kind with no optional lines', () => {
    const values = lineValuesFromLine(
      line({ optional: true, optionalSelected: false }),
      LINE_KINDS.order,
      DEFS
    )
    expect(values.optional).toBe(false)
    expect(values.optionalSelected).toBe(true)
  })
})

describe('toLinePatch', () => {
  it('renames keys and strips relationship ids to instance ids', () => {
    expect(
      toLinePatch(
        { unitPriceCents: 1200, partRecordId: 'def_part:p9' as RecordId },
        LINE_KINDS.quote
      )
    ).toEqual({ unitPrice: 1200, partId: 'p9' })
  })

  it('drops keys the kind cannot write', () => {
    expect(
      toLinePatch({ taxable: false, lineTotal: 900, qty: 2 }, LINE_KINDS.purchase_order)
    ).toEqual({ qty: 2 })
  })

  it('keeps an explicit null', () => {
    expect(toLinePatch({ description: null }, LINE_KINDS.quote)).toEqual({ description: null })
  })
})

describe('draftCreateInput', () => {
  it('sends the accumulated values and leaves blanks to the defaults', () => {
    const input = draftCreateInput(
      { ...DEFAULT_LINE_VALUES, name: 'Labor' },
      LINE_KINDS.quote,
      undefined
    )
    expect(input).toEqual({
      name: 'Labor',
      qty: 1,
      unit: 'each',
      taxable: true,
      optional: false,
      optionalSelected: true,
    })
  })

  it('stamps the visit only on a visit-scoped kind', () => {
    expect(draftCreateInput(DEFAULT_LINE_VALUES, LINE_KINDS.work_order, 'v1').visitId).toBe('v1')
    expect(draftCreateInput(DEFAULT_LINE_VALUES, LINE_KINDS.quote, 'v1').visitId).toBeUndefined()
  })
})

describe('amount adapters', () => {
  it('cross-fills a blank amount on a stored kind', () => {
    const values = { ...DEFAULT_LINE_VALUES, qty: 3 }
    expect(crossFillAmount({ unitPriceCents: 100 }, values, LINE_KINDS.vendor_bill)).toEqual({
      unitPriceCents: 100,
      lineTotal: 300,
    })
  })

  it('back-solves the rate from a typed amount on the purchase order', () => {
    const values = { ...DEFAULT_LINE_VALUES, qty: 3, unitPriceCents: 1 }
    const patch = crossFillAmount({ lineTotal: 10000 }, values, LINE_KINDS.purchase_order)
    expect(patch.lineTotal).toBe(10000)
    expect(patch.unitPriceCents).toBe(3333.333)
  })

  it('flags a stored amount that disagrees with qty × rate', () => {
    const values = { ...DEFAULT_LINE_VALUES, qty: 2, unitPriceCents: 100, lineTotal: 150 }
    expect(hasAmountMismatch(values, LINE_KINDS.vendor_bill)).toBe(true)
    expect(hasAmountMismatch(values, LINE_KINDS.quote)).toBe(false)
  })
})

describe('diffLineValues', () => {
  it('returns only changed values', () => {
    const after = { ...DEFAULT_LINE_VALUES, qty: 3, unit: null }
    expect(diffLineValues(DEFAULT_LINE_VALUES, after)).toEqual({ qty: 3, unit: null })
  })
})

describe('partCellAttrs', () => {
  it('derives the part cell attributes from the kind', () => {
    expect(partCellAttrs(LINE_KINDS.vendor_bill)).toMatchObject({
      part: 'vendor_bill_line_part',
      matchKey: 'vendor_bill_line_purchase_order_line',
      landedBill: 'vendor_bill_line_landed_bill',
      glAccount: 'vendor_bill_line_gl_account',
      weight: null,
    })
    expect(partCellAttrs(LINE_KINDS.purchase_order).weight).toBe('purchase_order_line_weight')
    expect(partCellAttrs(LINE_KINDS.credit_memo).part).toBeNull()
  })
})
