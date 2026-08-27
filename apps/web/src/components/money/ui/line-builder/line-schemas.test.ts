// apps/web/src/components/money/ui/line-builder/line-schemas.test.ts
//
// Invariants over LINE_SCHEMAS. Was `document-knobs.test.ts`, extended when the
// knobs became a full descriptor (plans/purchasing/03-line-builder-reuse.md).
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
//
// The descriptor widened the blast radius of that class of bug from the billing
// prefix to the line vocabulary itself, so these assertions widened with it.

import { describe, expect, it } from 'vitest'
import { relKeyForDocumentType } from './line-rows'
import {
  type DocumentType,
  LINE_SCHEMAS,
  type LineValues,
  lineAttributesFor,
  linePatchToFieldValues,
  lineSchemaFor,
  lineValuesFromSystemValues,
} from './line-values'

const ALL = Object.keys(LINE_SCHEMAS) as DocumentType[]
const TOTALLED = ALL.filter((d) => lineSchemaFor(d).totalsMode === 'computed')

describe('the billingPrefix trap', () => {
  it('order reads and writes order_*, never quote_*', () => {
    expect(LINE_SCHEMAS.order.billingPrefix).toBe('order')
    expect(LINE_SCHEMAS.order.billingPrefix).not.toBe('quote')
    for (const attr of LINE_SCHEMAS.order.billingAttrs) {
      expect(attr.startsWith('order_'), `${attr} is not an order_* attribute`).toBe(true)
    }
  })

  it('every document has its OWN billing prefix — no two share one', () => {
    const prefixes = ALL.map((d) => lineSchemaFor(d).billingPrefix)
    expect(new Set(prefixes).size).toBe(ALL.length)
  })

  // Every attribute the builder fetches must belong to the document that fetched
  // it — the single assertion that makes a mis-keyed row impossible to miss.
  it.each(ALL)('%s only ever fetches its own billing attributes', (documentType) => {
    const { billingPrefix, billingAttrs } = lineSchemaFor(documentType)
    for (const attr of billingAttrs) {
      expect(attr.startsWith(`${billingPrefix}_`)).toBe(true)
    }
  })

  // `order_tax_name` was missing from ORDER_FIELDS until migration 109: the builder
  // writes `${prefix}_tax_name` and `${prefix}_tax_rate` as a PAIR when a preset is
  // picked, and TotalsFooter matches the stored pair back to decide the selection.
  it('every computed document fetches both halves of the tax snapshot', () => {
    for (const documentType of TOTALLED) {
      const { billingAttrs, billingPrefix } = lineSchemaFor(documentType)
      expect(billingAttrs).toContain(`${billingPrefix}_tax_name`)
      expect(billingAttrs).toContain(`${billingPrefix}_tax_rate`)
    }
  })

  it('work_order has no billing at all — it stores no totals', () => {
    expect(LINE_SCHEMAS.work_order.totalsMode).toBe('none')
    expect(LINE_SCHEMAS.work_order.billingAttrs).toEqual([])
  })

  // plans/purchasing/01-build-plan.md §5.4b. Recomputing a bill's totals from its
  // lines silently corrects the vendor's arithmetic, which is the exact
  // discrepancy the three-way match exists to surface.
  it('the vendor bill is STORED, never computed', () => {
    expect(LINE_SCHEMAS.vendor_bill.totalsMode).toBe('stored')
    expect(TOTALLED).not.toContain('vendor_bill')
  })

  // The PO's subtotal IS ours to compute, but the rest of the document carries
  // AMOUNTS, not rates. This assertion exists because the first cut of this file
  // derived the PO's billing attrs from its prefix and asked for
  // `purchase_order_discount_type` / `_tax_name` / `_tax_rate` — none of which
  // exist. The footer then computed `total = subtotal`, disagreeing with the
  // `subtotal − discount + shipping + tax` the server persists, and rendered
  // editable controls writing to attributes that resolve to nothing.
  it('the purchase order states its additions rather than rating them', () => {
    expect(LINE_SCHEMAS.purchase_order.totalsMode).toBe('stated')
    expect(LINE_SCHEMAS.purchase_order.billingAttrs).toEqual([
      'purchase_order_discount_value',
      'purchase_order_shipping_total',
      'purchase_order_tax_total',
    ])
  })

  // 🛑 Only `computed` documents have a discount TYPE and a tax RATE. Any other
  // mode naming one is asking for a field its entity does not carry — and the
  // footer renders an editable control over it.
  it('no non-computed document names a rate-shaped attribute', () => {
    const RATE_SHAPED = ['_discount_type', '_tax_name', '_tax_rate']
    for (const documentType of ALL) {
      const { totalsMode, billingAttrs } = lineSchemaFor(documentType)
      if (totalsMode === 'computed') continue
      for (const attr of billingAttrs) {
        for (const suffix of RATE_SHAPED) {
          expect(attr.endsWith(suffix), `${attr} on a ${totalsMode} document`).toBe(false)
        }
      }
    }
  })
})

describe('line stamping', () => {
  it('an order line is stamped line_item_order', () => {
    expect(relKeyForDocumentType('order')).toBe('line_item_order')
  })

  it('every document stamps a DISTINCT relation — a shared one steals lines', () => {
    const relKeys = ALL.map(relKeyForDocumentType)
    expect(new Set(relKeys).size).toBe(ALL.length)
  })

  // The list filter's left side and the create payload's key are the same relation
  // in two notations; a mismatch shows an empty builder that still saves rows.
  it('the write key and the read field id name the same relation', () => {
    for (const documentType of ALL) {
      const { relKey, relFieldId, lineEntityType } = lineSchemaFor(documentType)
      const [entity, fromFieldId] = relFieldId.split(':')
      expect(entity).toBe(lineEntityType)
      const fromRelKey = relKey
        .replace(`${lineEntityType}_`, '')
        .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
      expect(fromRelKey).toBe(fromFieldId)
    }
  })

  // A relation/sort attribute that does not start with its own line entity's
  // prefix is pointing at another entity's field, which resolves to nothing.
  it('every line attribute belongs to that document&apos;s own line entity', () => {
    for (const documentType of ALL) {
      const schema = lineSchemaFor(documentType)
      for (const attr of lineAttributesFor(schema)) {
        expect(attr.startsWith(`${schema.lineEntityType}_`), `${attr} on ${documentType}`).toBe(
          true
        )
      }
      expect(schema.relKey.startsWith(`${schema.lineEntityType}_`)).toBe(true)
      expect(schema.sortAttr.startsWith(`${schema.lineEntityType}_`)).toBe(true)
    }
  })
})

describe('absent attributes are dropped, never written as null', () => {
  // 🛑 The defect this class of schema introduces: a shared default or a copied
  // draft carries `taxable`/`optional` onto a line entity that has no such field.
  // Writing it resolves to a field id that does not exist.
  it('a purchasing line never writes a sell-side field', () => {
    const patch: LineValues = {
      name: 'ignored',
      description: 'Motor, 3kW',
      category: 'part',
      taxable: false,
      qty: 4,
      unit: 'each',
      unitPriceCents: 12_500,
      optional: true,
      optionalSelected: false,
      catalogItemRecordId: null,
    }
    const written = linePatchToFieldValues(patch, LINE_SCHEMAS.purchase_order)
    expect(written.map((u) => u.fieldId)).toEqual([
      'purchase_order_line_description',
      'purchase_order_line_quantity_ordered',
      'purchase_order_line_expected_unit_price',
    ])
    for (const update of written) {
      expect(update.fieldId.startsWith('purchase_order_line_')).toBe(true)
    }
  })

  it('a quote line still writes the full sell-side vocabulary', () => {
    const written = linePatchToFieldValues(
      { name: 'Drain repair', qty: 2, unit: 'hour', unitPriceCents: 12500 },
      LINE_SCHEMAS.quote
    )
    expect(written.map((u) => u.fieldId)).toEqual([
      'line_item_name',
      'line_item_qty',
      'line_item_unit',
      'line_item_unit_price',
    ])
  })

  it('retains explicit null and false while omitting absent keys', () => {
    expect(
      linePatchToFieldValues({ description: null, taxable: false }, LINE_SCHEMAS.quote)
    ).toEqual([
      { fieldId: 'line_item_description', value: null, fieldType: 'TEXT' },
      { fieldId: 'line_item_taxable', value: false, fieldType: 'CHECKBOX' },
    ])
  })
})

describe('reading back a line whose entity lacks the sell-side fields', () => {
  // The totals math takes taxable/optional/optionalSelected for EVERY line. A
  // purchasing line has none of them, so the neutral default is what keeps
  // `computeDocumentTotals` correct rather than zeroing the document.
  it('defaults a purchasing line to taxable, not optional, selected', () => {
    const line = lineValuesFromSystemValues(
      {
        purchase_order_line_description: 'Motor, 3kW',
        purchase_order_line_quantity_ordered: 4,
        purchase_order_line_expected_unit_price: 12_500,
      },
      LINE_SCHEMAS.purchase_order
    )
    expect(line.description).toBe('Motor, 3kW')
    expect(line.qty).toBe(4)
    expect(line.unitPriceCents).toBe(12_500)
    expect(line.taxable).toBe(true)
    expect(line.optional).toBe(false)
    expect(line.optionalSelected).toBe(true)
  })

  // Only the quote supports optional lines; every other document must read a
  // stray stored value as not-optional rather than honouring it.
  it('an order ignores a stored optional flag it has no UI for', () => {
    const line = lineValuesFromSystemValues(
      { line_item_optional: true, line_item_optional_selected: false },
      LINE_SCHEMAS.order
    )
    expect(line.optional).toBe(false)
    expect(line.optionalSelected).toBe(true)
  })

  it('a quote honours both halves of the optional pair', () => {
    const line = lineValuesFromSystemValues(
      { line_item_optional: true, line_item_optional_selected: false },
      LINE_SCHEMAS.quote
    )
    expect(line.optional).toBe(true)
    expect(line.optionalSelected).toBe(false)
  })
})

describe('reading values back from the store', () => {
  // 🛑 The defect this pins shipped: `useSystemValues` collapses SINGLE_SELECT to a
  // scalar but leaves RELATIONSHIP as an ARRAY, and `lineValuesFromSystemValues`
  // read `partRecordId` as if it were a scalar. The one-element array then flowed
  // into `LinePartCellView`, which wraps it a second time, so `RecordBadge` got an
  // array where it expects an id and rendered a permanent loading skeleton. Every
  // purchase-order line showed a grey pill instead of its part, and nothing threw.
  it('collapses the RELATIONSHIP array a part reads back as', () => {
    const line = lineValuesFromSystemValues(
      { purchase_order_line_part: ['part_def:part_instance'] },
      LINE_SCHEMAS.purchase_order
    )
    expect(line.partRecordId).toBe('part_def:part_instance')
  })

  it('reads a bare relationship id unchanged, and an empty one as null', () => {
    const scalar = lineValuesFromSystemValues(
      { vendor_bill_line_part: 'part_def:part_instance' },
      LINE_SCHEMAS.vendor_bill
    )
    expect(scalar.partRecordId).toBe('part_def:part_instance')
    expect(
      lineValuesFromSystemValues({ vendor_bill_line_part: [] }, LINE_SCHEMAS.vendor_bill)
        .partRecordId
    ).toBeNull()
    expect(lineValuesFromSystemValues({}, LINE_SCHEMAS.vendor_bill).partRecordId).toBeNull()
  })

  // A document whose lines carry no unit field must not render the unit control —
  // `linePatchToFieldValues` drops the key, so the pick would silently do nothing.
  it('every document that shows a unit has a unit attribute to write it to', () => {
    for (const documentType of ALL) {
      const { capabilities, attrs } = lineSchemaFor(documentType)
      expect(capabilities.unit).toBe(attrs.unit !== null)
    }
  })

  // The leading cell of a buy-side row is a part picker; heading it "Description"
  // names the wrong one of the two controls stacked in it.
  it('labels the leading column for what it actually picks', () => {
    for (const documentType of ALL) {
      const { capabilities, primaryColumnLabel } = lineSchemaFor(documentType)
      expect(primaryColumnLabel).toBe(capabilities.partPicker ? 'Part' : 'Description')
    }
  })
})

describe('capabilities match the vocabulary', () => {
  // The defect a flag/vocabulary mismatch produces is a rendered cell that writes
  // to a field the entity does not have.
  it.each(ALL)('%s declares no capability its line entity cannot back', (documentType) => {
    const { attrs, capabilities, photosAttr, primaryTextKey } = lineSchemaFor(documentType)
    if (capabilities.taxable) expect(attrs.taxable).not.toBeNull()
    if (capabilities.optional) {
      expect(attrs.optional).not.toBeNull()
      expect(attrs.optionalSelected).not.toBeNull()
    }
    if (capabilities.category) expect(attrs.category).not.toBeNull()
    if (capabilities.unit) expect(attrs.unit).not.toBeNull()
    if (capabilities.photos) expect(photosAttr).not.toBeNull()
    if (capabilities.catalogPicker) expect(attrs.catalogItemRecordId).not.toBeNull()
    // The row has to have something to render in its leading text cell.
    expect(attrs[primaryTextKey]).not.toBeNull()
  })

  it('only the quote offers optional lines', () => {
    expect(ALL.filter((d) => lineSchemaFor(d).capabilities.optional)).toEqual(['quote'])
  })

  // 🛑 `useLineHotkeys` gates the `/`-on-empty-cell shortcut on this flag. Turning
  // it on for a purchasing line opens an empty catalog over the row — a PO line
  // picks a part/vendor_part, not a sell-side catalog_item.
  it('purchasing lines have no catalog picker', () => {
    expect(LINE_SCHEMAS.purchase_order.capabilities.catalogPicker).toBe(false)
    expect(LINE_SCHEMAS.vendor_bill.capabilities.catalogPicker).toBe(false)
  })

  it('only the invoice unstamps on delete and shows payment mirrors', () => {
    expect(ALL.filter((d) => lineSchemaFor(d).capabilities.deleteMode === 'unstamp')).toEqual([
      'invoice',
    ])
    expect(ALL.filter((d) => lineSchemaFor(d).capabilities.paymentMirrors)).toEqual(['invoice'])
  })

  it('only the work order is visit scoped; only the invoice excludes source lines', () => {
    expect(ALL.filter((d) => lineSchemaFor(d).capabilities.visitScoped)).toEqual(['work_order'])
    expect(ALL.filter((d) => lineSchemaFor(d).capabilities.excludeWorkOrderSourceLines)).toEqual([
      'invoice',
    ])
  })
})
