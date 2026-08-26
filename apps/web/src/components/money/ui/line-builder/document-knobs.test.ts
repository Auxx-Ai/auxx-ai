// apps/web/src/components/money/ui/line-builder/document-knobs.test.ts
//
// plans/products/08-order-build.md §8: "with `documentType: 'order'`, lines write
// `line_item_order` and the billing attributes resolve to the `order_*` prefix —
// NOT `quote_*`. That is the billingPrefix trap, and it is the one UI assertion
// worth writing before the code."
//
// The trap: `billingPrefix` was `documentType === 'invoice' ? 'invoice' : 'quote'`.
// A two-way ternary has no fourth arm to forget — adding `order` to the union
// compiles cleanly and silently reads and writes `quote_tax_rate` on every order.
// Nothing throws; the order just shows another document's totals.

import { describe, expect, it } from 'vitest'
import { relKeyForDocumentType } from './line-rows'
import { DOCUMENT_BILLING_ATTRS, DOCUMENT_KNOBS, type DocumentType } from './line-values'

const ALL: DocumentType[] = ['quote', 'invoice', 'order', 'work_order']

describe('the billingPrefix trap', () => {
  it('order reads and writes order_*, never quote_*', () => {
    expect(DOCUMENT_KNOBS.order.billingPrefix).toBe('order')
    expect(DOCUMENT_KNOBS.order.billingPrefix).not.toBe('quote')
    for (const attr of DOCUMENT_BILLING_ATTRS.order) {
      expect(attr.startsWith('order_'), `${attr} is not an order_* attribute`).toBe(true)
    }
  })

  it('every totalled document has its OWN prefix — no two share one', () => {
    const totalled = ALL.filter((d) => DOCUMENT_KNOBS[d].hasBilling)
    const prefixes = totalled.map((d) => DOCUMENT_KNOBS[d].billingPrefix)
    expect(new Set(prefixes).size).toBe(totalled.length)
    expect(totalled).toEqual(['quote', 'invoice', 'order'])
  })

  // Every attribute the builder fetches must belong to the document that fetched
  // it — the single assertion that makes a mis-keyed row impossible to miss.
  it.each([
    'quote',
    'invoice',
    'order',
  ] as const)('%s only ever fetches its own billing attributes', (documentType) => {
    const prefix = DOCUMENT_KNOBS[documentType].billingPrefix
    for (const attr of DOCUMENT_BILLING_ATTRS[documentType]) {
      expect(attr.startsWith(`${prefix}_`)).toBe(true)
    }
  })

  // `order_tax_name` was missing from ORDER_FIELDS until migration 109: the builder
  // writes `${prefix}_tax_name` and `${prefix}_tax_rate` as a PAIR when a preset is
  // picked, and TotalsFooter matches the stored pair back to decide the selection.
  it('every totalled document fetches both halves of the tax snapshot', () => {
    for (const documentType of ['quote', 'invoice', 'order'] as const) {
      const attrs = DOCUMENT_BILLING_ATTRS[documentType]
      const prefix = DOCUMENT_KNOBS[documentType].billingPrefix
      expect(attrs).toContain(`${prefix}_tax_name`)
      expect(attrs).toContain(`${prefix}_tax_rate`)
    }
  })

  it('work_order has no billing at all — it stores no totals', () => {
    expect(DOCUMENT_KNOBS.work_order.hasBilling).toBe(false)
    expect(DOCUMENT_BILLING_ATTRS.work_order).toEqual([])
  })
})

describe('line stamping', () => {
  it('an order line is stamped line_item_order', () => {
    expect(relKeyForDocumentType('order')).toBe('line_item_order')
  })

  it('every document stamps a DISTINCT relation — a shared one steals lines', () => {
    const relKeys = ALL.map(relKeyForDocumentType)
    expect(new Set(relKeys).size).toBe(ALL.length)
    expect(relKeys).toEqual([
      'line_item_quote',
      'line_item_invoice',
      'line_item_order',
      'line_item_work_order',
    ])
  })

  // The list filter's left side and the create payload's key are the same relation
  // in two notations; a mismatch shows an empty builder that still saves rows.
  it('the write key and the read field id name the same relation', () => {
    for (const documentType of ALL) {
      const { relKey, relFieldId } = DOCUMENT_KNOBS[documentType]
      const fromFieldId = relFieldId.replace('line_item:', '')
      const fromRelKey = relKey
        .replace('line_item_', '')
        .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
      expect(fromRelKey).toBe(fromFieldId)
    }
  })
})
