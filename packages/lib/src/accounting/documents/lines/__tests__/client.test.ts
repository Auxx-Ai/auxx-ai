// packages/lib/src/accounting/documents/lines/__tests__/client.test.ts
//
// LINE_KINDS invariants and the pure helpers, ported from the builder's
// line-schemas.test.ts / line-values.test.ts onto the `Line` shape.

import { describe, expect, it } from 'vitest'
import {
  crossFillAmount,
  diffLineValues,
  hasAmountMismatch,
  LINE_DOCUMENT_TYPES,
  LINE_KEYS,
  LINE_KINDS,
  type Line,
  lineKindFor,
  linePatchSchema,
  linePatchSchemaFor,
  pickWritablePatch,
  writableLineKeys,
} from '../client'

const ALL = [...LINE_DOCUMENT_TYPES]
const COMPUTED = ALL.filter((d) => lineKindFor(d).totalsMode === 'computed')

function line(over: Partial<Line> = {}): Line {
  const blank = Object.fromEntries(LINE_KEYS.map((key) => [key, null])) as unknown as Omit<
    Line,
    'id' | 'documentType' | 'documentId'
  >
  return { ...blank, id: 'l1', documentType: 'vendor_bill', documentId: 'd1', ...over }
}

describe('the billingPrefix trap', () => {
  it('order reads and writes order_*, never quote_*', () => {
    expect(LINE_KINDS.order.billingPrefix).toBe('order')
    for (const attr of LINE_KINDS.order.billingAttrs) expect(attr.startsWith('order_')).toBe(true)
  })

  it('every document has its own billing prefix', () => {
    expect(new Set(ALL.map((d) => lineKindFor(d).billingPrefix)).size).toBe(ALL.length)
  })

  it.each(ALL)('%s only fetches its own billing attributes', (documentType) => {
    const { billingPrefix, billingAttrs } = lineKindFor(documentType)
    for (const attr of billingAttrs) expect(attr.startsWith(`${billingPrefix}_`)).toBe(true)
  })

  it('every computed document fetches both halves of the tax snapshot', () => {
    for (const documentType of COMPUTED) {
      const { billingAttrs, billingPrefix } = lineKindFor(documentType)
      expect(billingAttrs).toContain(`${billingPrefix}_tax_name`)
      expect(billingAttrs).toContain(`${billingPrefix}_tax_rate`)
    }
  })

  it('the work order stores no totals and the vendor bill is stored, never computed', () => {
    expect(LINE_KINDS.work_order.totalsMode).toBe('none')
    expect(LINE_KINDS.work_order.billingAttrs).toEqual([])
    expect(LINE_KINDS.vendor_bill.totalsMode).toBe('stored')
    expect(COMPUTED).not.toContain('vendor_bill')
  })

  it('only the vendor bill takes its header amounts by hand', () => {
    for (const documentType of ALL) {
      expect(LINE_KINDS[documentType].headerAmountsTyped, documentType).toBe(
        documentType === 'vendor_bill'
      )
    }
  })

  it('no non-computed document names a rate-shaped attribute', () => {
    for (const documentType of ALL) {
      const { totalsMode, billingAttrs } = lineKindFor(documentType)
      if (totalsMode === 'computed') continue
      for (const attr of billingAttrs) {
        for (const suffix of ['_discount_type', '_tax_name', '_tax_rate']) {
          expect(attr.endsWith(suffix), `${attr} on a ${totalsMode} document`).toBe(false)
        }
      }
    }
  })
})

describe('capabilities match the vocabulary', () => {
  it('only the quote offers optional lines; only the work order is visit scoped', () => {
    expect(ALL.filter((d) => lineKindFor(d).capabilities.optional)).toEqual(['quote'])
    expect(ALL.filter((d) => lineKindFor(d).capabilities.visitScoped)).toEqual(['work_order'])
    expect(ALL.filter((d) => lineKindFor(d).capabilities.excludeWorkOrderSourceLines)).toEqual([
      'invoice',
    ])
  })

  it('only the purchase order blocks a draft on its part', () => {
    expect(ALL.filter((d) => lineKindFor(d).capabilities.draftRequiresPart)).toEqual([
      'purchase_order',
    ])
    expect(LINE_KINDS.purchase_order.fields).toContain('partId')
  })

  it('a kind with photos carries the photos key', () => {
    for (const documentType of ALL) {
      const kind = lineKindFor(documentType)
      expect(kind.fields.includes('photos'), documentType).toBe(kind.capabilities.photos)
      expect(kind.photosAttr !== null, documentType).toBe(kind.capabilities.photos)
    }
  })

  it('every kind leads with a text key it carries', () => {
    for (const documentType of ALL) {
      const kind = lineKindFor(documentType)
      expect(kind.fields).toContain(kind.primaryTextKey)
    }
  })
})

describe('what a patch may carry', () => {
  it('only the vendor bill and the two credits store their own amount', () => {
    expect(ALL.filter((d) => lineKindFor(d).amountMode === 'stored')).toEqual([
      'credit_memo',
      'vendor_bill',
      'vendor_credit',
    ])
    for (const documentType of ALL) {
      expect(writableLineKeys(documentType).includes('lineTotal'), documentType).toBe(
        lineKindFor(documentType).amountMode === 'stored'
      )
    }
  })

  it('refuses an engine-owned key rather than dropping it', () => {
    for (const key of ['netTotal', 'fulfilledQty', 'quantityReceived', 'sortOrder', 'photos']) {
      expect(linePatchSchema.safeParse({ [key]: 1 }).success, key).toBe(false)
    }
  })

  it('refuses a line total on a derived document and takes it on a stored one', () => {
    expect(linePatchSchemaFor('quote').safeParse({ lineTotal: 100 }).success).toBe(false)
    expect(linePatchSchemaFor('purchase_order').safeParse({ lineTotal: 100 }).success).toBe(false)
    expect(linePatchSchemaFor('vendor_bill').safeParse({ lineTotal: 100 }).success).toBe(true)
  })

  it('refuses a key the kind does not have', () => {
    expect(linePatchSchemaFor('purchase_order').safeParse({ taxable: true }).success).toBe(false)
    expect(linePatchSchemaFor('quote').safeParse({ weight: 3 }).success).toBe(false)
    expect(linePatchSchemaFor('quote').safeParse({ taxable: true, qty: 2 }).success).toBe(true)
  })

  it('refuses a unit that is not a line item unit', () => {
    expect(linePatchSchemaFor('quote').safeParse({ unit: 'each' }).success).toBe(true)
    expect(linePatchSchemaFor('quote').safeParse({ unit: 'furlong' }).success).toBe(false)
  })

  it('pickWritablePatch strips the typed amount a derived-editable cell back-solved from', () => {
    expect(pickWritablePatch({ lineTotal: 167_370, unitPrice: 1.594 }, 'purchase_order')).toEqual({
      unitPrice: 1.594,
    })
  })
})

describe('diffLineValues', () => {
  it('returns only changed writable values', () => {
    expect(diffLineValues(line({ qty: 1, name: 'A' }), line({ qty: 2, name: 'A' }))).toEqual({
      qty: 2,
    })
  })

  it('is empty for an unchanged snapshot, and ignores engine-owned keys', () => {
    expect(diffLineValues(line(), line())).toEqual({})
    expect(diffLineValues(line({ netTotal: 1 }), line({ netTotal: 2 }))).toEqual({})
  })
})

describe('cross-filling on a stored document', () => {
  const bill = LINE_KINDS.vendor_bill
  const row = (over: Partial<Line>) => line({ qty: 4, ...over })

  it('a typed amount fills a blank rate, a typed rate a blank amount', () => {
    expect(crossFillAmount({ lineTotal: 10000 }, row({}), bill)).toEqual({
      lineTotal: 10000,
      unitPrice: 2500,
    })
    expect(crossFillAmount({ unitPrice: 2500 }, row({}), bill)).toEqual({
      unitPrice: 2500,
      lineTotal: 10000,
    })
  })

  it('never overwrites a sibling that already has a value', () => {
    expect(crossFillAmount({ lineTotal: 9999 }, row({ unitPrice: 2500 }), bill)).toEqual({
      lineTotal: 9999,
    })
    expect(crossFillAmount({ unitPrice: 2500 }, row({ lineTotal: 9999 }), bill)).toEqual({
      unitPrice: 2500,
    })
  })

  it('clearing fills nothing, and a zero quantity derives no rate', () => {
    expect(crossFillAmount({ lineTotal: null }, row({}), bill)).toEqual({ lineTotal: null })
    expect(crossFillAmount({ lineTotal: 10000 }, row({ qty: 0 }), bill)).toEqual({
      lineTotal: 10000,
    })
  })

  it('rounds the derived rate to whole cents', () => {
    expect(crossFillAmount({ lineTotal: 10000 }, row({ qty: 3 }), bill)).toEqual({
      lineTotal: 10000,
      unitPrice: 3333,
    })
  })

  it('is a no-op on every derived document', () => {
    for (const documentType of ALL) {
      const kind = lineKindFor(documentType)
      if (kind.amountMode !== 'derived') continue
      const patch = { unitPrice: 2500 }
      expect(crossFillAmount(patch, row({}), kind), documentType).toBe(patch)
    }
  })
})

describe('cross-filling on the purchase order (derived-editable)', () => {
  const po = LINE_KINDS.purchase_order
  const row = (over: Partial<Line>) =>
    line({ documentType: 'purchase_order', qty: 105_000, ...over })

  it('back-solves the rate at RATE_DECIMALS, even over one already entered', () => {
    expect(crossFillAmount({ lineTotal: 167_370 }, row({}), po)).toEqual({
      lineTotal: 167_370,
      unitPrice: 1.594,
    })
    expect(crossFillAmount({ lineTotal: 167_370 }, row({ unitPrice: 2 }), po)).toEqual({
      lineTotal: 167_370,
      unitPrice: 1.594,
    })
  })

  it('a typed rate fills nothing: there is no line total field to fill', () => {
    const patch = { unitPrice: 1.594 }
    expect(crossFillAmount(patch, row({}), po)).toBe(patch)
  })
})

describe('the amount mismatch is reported, never reconciled', () => {
  const bill = LINE_KINDS.vendor_bill
  const row = (over: Partial<Line>) => line({ qty: 3, ...over })

  it("flags the vendor's arithmetic and stays quiet when the three agree", () => {
    expect(hasAmountMismatch(row({ unitPrice: 3333, lineTotal: 10000 }), bill)).toBe(true)
    expect(hasAmountMismatch(row({ unitPrice: 3333, lineTotal: 9999 }), bill)).toBe(false)
  })

  it('stays quiet while either half is blank, and on every derived document', () => {
    expect(hasAmountMismatch(row({ unitPrice: 3333 }), bill)).toBe(false)
    expect(hasAmountMismatch(row({ lineTotal: 9999 }), bill)).toBe(false)
    for (const documentType of ALL) {
      const kind = lineKindFor(documentType)
      if (kind.amountMode === 'stored') continue
      expect(hasAmountMismatch(row({ unitPrice: 1, lineTotal: 999_999 }), kind)).toBe(false)
    }
  })
})
