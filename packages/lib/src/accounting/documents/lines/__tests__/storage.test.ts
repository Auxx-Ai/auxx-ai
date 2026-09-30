// packages/lib/src/accounting/documents/lines/__tests__/storage.test.ts
//
// The L0 attr maps agree with LINE_KINDS: a key a kind carries has exactly one
// attribute behind it, on that kind's own line entity.

import { describe, expect, it } from 'vitest'
import { LINE_DOCUMENT_TYPES, LINE_KINDS } from '../client'
import { KIND_STORAGE } from '../storage/field-value'

const ALL = [...LINE_DOCUMENT_TYPES]

describe('the L0 attr maps', () => {
  it.each(ALL)('%s maps exactly the keys its kind carries', (documentType) => {
    const { entity } = KIND_STORAGE[documentType]
    expect(Object.keys(entity.columns).sort()).toEqual([...LINE_KINDS[documentType].fields].sort())
    expect(entity.lineEntityType).toBe(LINE_KINDS[documentType].lineEntityType)
  })

  it.each(ALL)('%s reads and writes only attributes of its own line entity', (documentType) => {
    const { entity, parentAttr } = KIND_STORAGE[documentType]
    const prefix = `${entity.lineEntityType}_`
    const attrs = [
      ...Object.values(entity.columns).map((c) => c!.attr),
      parentAttr,
      entity.sortAttr,
    ]
    for (const attr of attrs) {
      expect(attr.startsWith(prefix), attr).toBe(true)
      expect(entity.attributes).toContain(attr)
    }
  })

  it('every document stamps a distinct parent relation', () => {
    const parents = ALL.map((documentType) => KIND_STORAGE[documentType].parentAttr)
    expect(new Set(parents).size).toBe(ALL.length)
    expect(KIND_STORAGE.order.parentAttr).toBe('line_item_order')
  })

  it('carries the per-kind exceptions', () => {
    expect(KIND_STORAGE.credit_memo.entity.columns.name?.attr).toBe('credit_memo_line_description')
    expect(KIND_STORAGE.credit_memo.entity.columns.lineTotal?.attr).toBe(
      'credit_memo_line_subtotal'
    )
    expect(KIND_STORAGE.purchase_order.entity.columns.unitPrice?.attr).toBe(
      'purchase_order_line_expected_unit_price'
    )
    expect(KIND_STORAGE.vendor_bill.entity.columns.qty?.attr).toBe(
      'vendor_bill_line_quantity_billed'
    )
    expect(KIND_STORAGE.invoice.excludeAttr).toBe('line_item_work_order')
  })
})
