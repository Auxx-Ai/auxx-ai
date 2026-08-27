// packages/lib/src/resources/registry/line-builder-contract.test.ts
//
// The web line builder (`apps/web/src/components/money/ui/line-builder/`) reads and
// writes documents by systemAttribute name, resolved at runtime through the org
// cache. Nothing type-checks those names against the registry, so a descriptor can
// name an attribute that does not exist and every test in `apps/web` still passes
// — a test over there can only ever re-read the same table that is wrong.
//
// 🛑 This is not hypothetical. `LINE_SCHEMAS.purchase_order` first derived its
// billing attributes from its prefix the way the three sell-side documents do,
// asking for `purchase_order_discount_type` / `_tax_name` / `_tax_rate`. A PO has
// none of them: it carries `discountValue`, `shippingTotal` and `taxTotal` as
// AMOUNTS, because they are the freight-allocation inputs
// (plans/purchasing/01-build-plan.md §4.1). The footer therefore computed
// `total = subtotal` while the server persisted `subtotal − discount + shipping +
// tax`, and rendered editable discount/tax-rate controls writing to attributes
// that resolve to nothing.
//
// So the contract is mirrored here, beside the registry, and cross-checked against
// it. Update this file in the same change as the descriptor.

import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from './field-registry'

/**
 * What the line builder names, per document. `header` is the parent's own billing
 * mirrors (`LineSchema.billingAttrs` plus the totals the footer displays); `line`
 * is the line entity's own vocabulary (`LineSchema.attrs` + `sortAttr` + `relKey`).
 */
const LINE_BUILDER_CONTRACT: Record<
  string,
  { lineEntityType: string; header: string[]; line: string[] }
> = {
  quote: {
    lineEntityType: 'line_item',
    header: ['quote_discount_type', 'quote_discount_value', 'quote_tax_name', 'quote_tax_rate'],
    line: ['line_item_quote', 'line_item_sort_order'],
  },
  invoice: {
    lineEntityType: 'line_item',
    header: [
      'invoice_discount_type',
      'invoice_discount_value',
      'invoice_tax_name',
      'invoice_tax_rate',
      'invoice_amount_paid',
      'invoice_balance',
    ],
    line: ['line_item_invoice', 'line_item_sort_order'],
  },
  order: {
    lineEntityType: 'line_item',
    header: ['order_discount_type', 'order_discount_value', 'order_tax_name', 'order_tax_rate'],
    line: ['line_item_order', 'line_item_sort_order'],
  },
  work_order: {
    lineEntityType: 'line_item',
    header: [],
    line: ['line_item_work_order', 'line_item_sort_order'],
  },
  purchase_order: {
    lineEntityType: 'purchase_order_line',
    // Amounts, not rates. See the header comment.
    header: [
      'purchase_order_discount_value',
      'purchase_order_shipping_total',
      'purchase_order_tax_total',
      'purchase_order_subtotal',
      'purchase_order_total',
    ],
    line: [
      'purchase_order_line_purchase_order',
      'purchase_order_line_part',
      'purchase_order_line_description',
      'purchase_order_line_quantity_ordered',
      'purchase_order_line_expected_unit_price',
      'purchase_order_line_sort_order',
    ],
  },
  vendor_bill: {
    lineEntityType: 'vendor_bill_line',
    // Transcribed, never computed (01-build-plan.md §5.4b).
    header: ['vendor_bill_subtotal', 'vendor_bill_tax_total', 'vendor_bill_total'],
    line: [
      'vendor_bill_line_vendor_bill',
      'vendor_bill_line_part',
      'vendor_bill_line_description',
      'vendor_bill_line_quantity_billed',
      'vendor_bill_line_unit_price',
      'vendor_bill_line_sort_order',
    ],
  },
}

/** Every systemAttribute declared on one entity type in the registry. */
function attributesOf(entityType: string): Set<string> {
  const fields = RESOURCE_FIELD_REGISTRY[entityType]
  if (!fields) throw new Error(`No registry entry for entityType "${entityType}"`)
  const attrs = new Set<string>()
  for (const field of Object.values(fields)) {
    if (field.systemAttribute) attrs.add(field.systemAttribute)
  }
  return attrs
}

describe('line builder contract', () => {
  const documents = Object.keys(LINE_BUILDER_CONTRACT)

  it.each(documents)('%s: every header attribute exists on the document', (documentType) => {
    const { header } = LINE_BUILDER_CONTRACT[documentType]!
    const declared = attributesOf(documentType)
    for (const attr of header) {
      expect(declared.has(attr), `${documentType} has no field ${attr}`).toBe(true)
    }
  })

  it.each(documents)('%s: every line attribute exists on its line entity', (documentType) => {
    const { lineEntityType, line } = LINE_BUILDER_CONTRACT[documentType]!
    const declared = attributesOf(lineEntityType)
    for (const attr of line) {
      expect(declared.has(attr), `${lineEntityType} has no field ${attr}`).toBe(true)
    }
  })

  // The specific shape that broke: only the three sell-side documents carry a
  // discount TYPE and a tax RATE. Anything else naming one is the bug above.
  it('only quote/invoice/order carry rate-shaped billing fields', () => {
    const rated = documents.filter((documentType) => {
      const declared = attributesOf(documentType)
      return declared.has(`${documentType}_tax_rate`)
    })
    expect(rated.sort()).toEqual(['invoice', 'order', 'quote'])
  })

  // A purchasing line's identity is `(parent, part)`, so `part` must stay required
  // — it is what stops a re-sent order doubling its lines, and it is why the
  // builder cannot materialize a draft row until one is picked.
  it('a purchase order line still requires its part', () => {
    const part = RESOURCE_FIELD_REGISTRY.purchase_order_line?.part
    expect(part?.systemAttribute).toBe('purchase_order_line_part')
    expect(part?.nullable).toBe(false)
    expect(part?.capabilities?.required).toBe(true)
  })
})
