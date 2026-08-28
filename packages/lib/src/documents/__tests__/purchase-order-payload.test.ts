// packages/lib/src/documents/__tests__/purchase-order-payload.test.ts
//
// The purchase order PDF payload builder (plans/purchasing/07 §1.3/§6.3). The org cache,
// `UnifiedCrudHandler` and `@auxx/database` are all doubled, so nothing here needs a
// database — what is pinned is the CONTRACT of a document sent to a VENDOR:
//
//   - a line whose optional `purchase_order_line_vendor_part` link is unset renders no SKU
//     instead of throwing (that link only recently gained a writer, so most rows lack it);
//   - money stays in integer minor units end to end, with freight and tax added on top of
//     the discounted subtotal exactly as `money/totals-hooks.ts` writes them;
//   - the vendor COMPANY is the addressee party while `purchase_order_contact` is the person
//     — two different fields, and the contact is nullable and usually unset today, so the
//     payload must still carry an empty-but-PRESENT `contact` (`print-records-job.ts` reads
//     `payload.contact.name` across the whole union when sorting a batch print run).
//
// The registry half of §1.2 is asserted at the bottom: `purchase_order` resolves by
// entityType and carries the `purchase_order_pdf_asset` pointer `ensure-pdf.ts` needs to
// reuse a rendered PDF instead of minting a fresh MediaAsset on every send.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** systemAttribute -> field id; a missing key models a field the org has not materialised. */
  fields: new Map<string, string>(),
  /** `${recordId}::${fieldId}` -> TypedFieldValue. */
  values: new Map<string, unknown>(),
  /** EntityInstance ids returned by `listFiltered`, in order. */
  lineInstanceIds: [] as string[],
  /** EntityInstance id -> displayName, for the line-name fallback read. */
  displayNames: new Map<string, string>(),
  /** `createdAt` of the purchase order instance. */
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields.has(a) ? { id: h.fields.get(a) } : null])),
    }),
  }),
}))

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  return {
    database: new Proxy({} as Record<string, unknown>, {
      get: (_target, prop) => {
        if (prop === 'then') return undefined
        if (prop === 'query') {
          return {
            EntityInstance: {
              findFirst: async () => ({ createdAt: h.createdAt }),
              findMany: async () =>
                Array.from(h.displayNames, ([id, displayName]) => ({ id, displayName })),
            },
          }
        }
        return createChainableDatabaseMock()
      },
    }),
    schema: createSchemaMock({ EntityInstance: {} }),
  }
})

vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    fieldValueService = {
      batchGetValues: async (params: { recordIds: string[]; fieldReferences: string[] }) => ({
        values: params.recordIds.flatMap((recordId) =>
          params.fieldReferences.map((fieldRef) => ({
            recordId,
            fieldRef,
            // The ref is `<defId>:<fieldId>` — read the double's store by field id.
            value: h.values.get(`${recordId}::${fieldRef.split(':').pop()}`) ?? null,
            fieldType: 'TEXT',
          }))
        ),
      }),
    }

    async getFieldValues(recordId: string, fieldIds: string[]) {
      const map = new Map<string, unknown>()
      for (const fieldId of fieldIds) {
        const value = h.values.get(`${recordId}::${fieldId}`)
        if (value !== undefined) map.set(fieldId, value)
      }
      return map
    }

    async listFiltered() {
      return { ids: h.lineInstanceIds }
    }
  },
}))

vi.mock('../resolve-settings', () => ({
  resolveDocumentSettings: async () => ({
    business: { companyName: 'Klooth Lift', address: { city: 'Austin', country: 'US' } },
    branding: { logo: null, accentColor: '', paperSize: 'letter', dateFormat: 'MMM d, yyyy' },
    quote: {
      defaultTerms: '',
      validDays: 30,
      footerText: '',
      lineDisplay: 'full',
      showDescriptions: true,
    },
    invoice: {
      dueDays: 30,
      paymentInstructions: '',
      footerText: '',
      lineDisplay: 'full',
      showDescriptions: true,
      showPaymentHistory: true,
    },
    currency: 'USD',
  }),
}))

import type { RecordId } from '@auxx/types/resource'
import { buildPurchaseOrderPdfPayload } from '../payload'
import { getDocumentTypeByEntityType, listDocumentTypes } from '../registry'

const ORDER_RECORD_ID = 'purchase_order:po_1' as RecordId
const VENDOR_RECORD_ID = 'company:co_1'

/** Register a materialised field and return the id the doubles key values by. */
function field(systemAttribute: string): string {
  const id = `fld_${systemAttribute}`
  h.fields.set(systemAttribute, id)
  return id
}

function setValue(recordId: string, systemAttribute: string, value: unknown): void {
  h.values.set(`${recordId}::${field(systemAttribute)}`, value)
}

const text = (value: string) => ({ type: 'text', value })
const number = (value: number) => ({ type: 'number', value })
const relationship = (recordId: string) => ({ type: 'relationship', recordId })

beforeEach(() => {
  h.fields = new Map()
  h.values = new Map()
  h.lineInstanceIds = []
  h.displayNames = new Map()

  // Every field the builder reads is materialised, so a `null` in an assertion below means
  // "no value stored", never "the org lacks the field".
  for (const attr of [
    'purchase_order_number',
    'purchase_order_status',
    'purchase_order_vendor',
    'purchase_order_contact',
    'purchase_order_ordered_at',
    'purchase_order_expected_at',
    'purchase_order_reference',
    'purchase_order_terms',
    'purchase_order_currency',
    'purchase_order_ship_to',
    'purchase_order_shipping_total',
    'purchase_order_tax_total',
    'purchase_order_discount_value',
    'company_name',
    'company_headquarters',
    'company_website',
    'full_name',
    'primary_email',
    'phone',
    'city',
    'region',
    'country',
    'vendor_part_vendor_sku',
    'purchase_order_line_description',
    'purchase_order_line_quantity_ordered',
    'purchase_order_line_expected_unit_price',
    'purchase_order_line_line_total',
    'purchase_order_line_part',
    'purchase_order_line_vendor_part',
  ]) {
    field(attr)
  }

  setValue(ORDER_RECORD_ID, 'purchase_order_number', text('PO-0001'))
  setValue(ORDER_RECORD_ID, 'purchase_order_status', text('draft'))
  setValue(ORDER_RECORD_ID, 'purchase_order_vendor', relationship(VENDOR_RECORD_ID))
  setValue(VENDOR_RECORD_ID, 'company_name', text('Bosch Rexroth'))
})

const build = () =>
  buildPurchaseOrderPdfPayload({
    organizationId: 'org_1',
    userId: 'user_1',
    purchaseOrderRecordId: ORDER_RECORD_ID,
  })

describe('buildPurchaseOrderPdfPayload — lines', () => {
  // The vendor-part link is optional by design (a one-off buy from a supplier with no
  // maintained price list is a legitimate line) and only recently gained a writer, so the
  // common case today is a line with no link at all. It must degrade to a blank SKU.
  it('renders no vendor SKU for a line with no vendor_part link', async () => {
    h.lineInstanceIds = ['pol_1']
    setValue('purchase_order_line:pol_1', 'purchase_order_line_description', text('Seal kit'))
    setValue('purchase_order_line:pol_1', 'purchase_order_line_quantity_ordered', number(4))
    setValue('purchase_order_line:pol_1', 'purchase_order_line_expected_unit_price', number(1250))
    setValue('purchase_order_line:pol_1', 'purchase_order_line_line_total', number(5000))

    const { payload } = await build()

    expect(payload.lines).toEqual([
      {
        lineInstanceId: 'pol_1',
        name: 'Seal kit',
        vendorSku: null,
        qty: 4,
        unitPrice: 1250,
        lineTotal: 5000,
      },
    ])
  })

  it("reads the vendor SKU through the line's vendor_part link when there is one", async () => {
    h.lineInstanceIds = ['pol_1', 'pol_2']
    for (const [instanceId, sku] of [
      ['pol_1', 'vp_1'],
      ['pol_2', undefined],
    ] as const) {
      const recordId = `purchase_order_line:${instanceId}`
      setValue(recordId, 'purchase_order_line_description', text(`Line ${instanceId}`))
      setValue(recordId, 'purchase_order_line_quantity_ordered', number(1))
      setValue(recordId, 'purchase_order_line_line_total', number(100))
      if (sku)
        setValue(recordId, 'purchase_order_line_vendor_part', relationship(`vendor_part:${sku}`))
    }
    setValue('vendor_part:vp_1', 'vendor_part_vendor_sku', text('R900-1234'))

    const { payload } = await build()

    expect(payload.lines.map((l) => l.vendorSku)).toEqual(['R900-1234', null])
  })

  // The supplier-facing description is the authority, but it is nullable — and a blank row
  // on a document a warehouse picks from is worse than our own name for the thing.
  it("falls back to the part's display name when the line carries no description", async () => {
    h.lineInstanceIds = ['pol_1']
    h.displayNames.set('part_1', 'Hydraulic cylinder 80/45')
    setValue('purchase_order_line:pol_1', 'purchase_order_line_quantity_ordered', number(2))
    setValue('purchase_order_line:pol_1', 'purchase_order_line_part', relationship('part:part_1'))

    const { payload } = await build()

    expect(payload.lines[0]?.name).toBe('Hydraulic cylinder 80/45')
  })
})

describe('buildPurchaseOrderPdfPayload — money', () => {
  // Integer minor units end to end, and freight/tax are STATED header amounts added on top
  // of the discounted subtotal — the `purchase_order` spec in `money/totals-hooks.ts`. A PO
  // has no tax RATE, so nothing is derived from a percentage.
  it('sums minor units with the discount clamped and freight/tax added on top', async () => {
    h.lineInstanceIds = ['pol_1', 'pol_2']
    setValue('purchase_order_line:pol_1', 'purchase_order_line_line_total', number(5000))
    setValue('purchase_order_line:pol_1', 'purchase_order_line_quantity_ordered', number(1))
    setValue('purchase_order_line:pol_2', 'purchase_order_line_line_total', number(2500))
    setValue('purchase_order_line:pol_2', 'purchase_order_line_quantity_ordered', number(1))
    setValue(ORDER_RECORD_ID, 'purchase_order_discount_value', number(500))
    setValue(ORDER_RECORD_ID, 'purchase_order_shipping_total', number(1995))
    setValue(ORDER_RECORD_ID, 'purchase_order_tax_total', number(619))

    const { payload } = await build()

    expect(payload.subtotal).toBe(7500)
    expect(payload.discountAmount).toBe(500)
    expect(payload.shippingTotal).toBe(1995)
    expect(payload.taxTotal).toBe(619)
    // 7500 - 500 + 1995 + 619
    expect(payload.total).toBe(9614)
  })

  // A `null` unit price means "not yet priced" (the MQ1 convention) and every sum excludes
  // it — an unpriced line must not silently read as free.
  it('excludes an unpriced line from the subtotal', async () => {
    h.lineInstanceIds = ['pol_1', 'pol_2']
    setValue('purchase_order_line:pol_1', 'purchase_order_line_line_total', number(5000))
    setValue('purchase_order_line:pol_1', 'purchase_order_line_quantity_ordered', number(1))
    setValue('purchase_order_line:pol_2', 'purchase_order_line_quantity_ordered', number(1))

    const { payload } = await build()

    expect(payload.lines[1]?.unitPrice).toBeNull()
    expect(payload.subtotal).toBe(5000)
    expect(payload.total).toBe(5000)
  })

  it('prefers the order currency over the org default', async () => {
    setValue(ORDER_RECORD_ID, 'purchase_order_currency', text('EUR'))
    const { payload } = await build()
    expect(payload.currency).toBe('EUR')
  })

  it('falls back to the org currency when the order carries none', async () => {
    const { payload } = await build()
    expect(payload.currency).toBe('USD')
  })
})

describe('buildPurchaseOrderPdfPayload — header', () => {
  it('addresses the vendor company, with its headquarters as display lines', async () => {
    setValue('company:co_1', 'company_headquarters', {
      type: 'json',
      value: {
        street1: 'An den Kelterwiesen 14',
        city: 'Lohr am Main',
        zipCode: '97816',
        country: 'DE',
      },
    })
    setValue('company:co_1', 'company_website', text('https://boschrexroth.com'))

    const { payload } = await build()

    expect(payload.vendor).toEqual({
      name: 'Bosch Rexroth',
      // DE orders the postcode BEFORE the city, the same split `formatAddress` makes.
      addressLines: ['An den Kelterwiesen 14', '97816 Lohr am Main', 'Germany'],
      website: 'https://boschrexroth.com',
    })
  })

  it('carries the ship-to address as its own block', async () => {
    setValue(ORDER_RECORD_ID, 'purchase_order_ship_to', {
      type: 'json',
      value: {
        street1: '900 E 5th St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78702',
        country: 'US',
      },
    })

    const { payload } = await build()

    expect(payload.shipToLines).toEqual(['900 E 5th St', 'Austin, TX 78702', 'United States'])
  })

  it('leaves the ship-to empty rather than inventing one', async () => {
    const { payload } = await build()
    expect(payload.shipToLines).toEqual([])
  })

  // Never `new Date()` — a moving `issuedAt` would change the content hash on every call and
  // defeat the render-or-reuse cache entirely (the MQ2 lesson).
  it("falls back to the instance's createdAt when the order has not been placed", async () => {
    const { payload, hash } = await build()

    expect(payload.issuedAt).toBe('2026-01-02T00:00:00.000Z')
    const again = await build()
    expect(again.hash).toBe(hash)
  })

  it('prefers purchase_order_ordered_at when it is set', async () => {
    setValue(ORDER_RECORD_ID, 'purchase_order_ordered_at', {
      type: 'date',
      value: '2026-03-04T00:00:00.000Z',
    })
    const { payload } = await build()
    expect(payload.issuedAt).toBe('2026-03-04T00:00:00.000Z')
  })

  // 🛑 `purchase_order_contact` is nullable and nothing prefills it yet, so this is the
  // common shape today. `print-records-job.ts`'s `sortBy: 'contact'` reads
  // `payload.contact.name` across the WHOLE payload union — an omitted key would break batch
  // -print sorting for quotes and invoices too, so the object must be present and empty.
  it('carries an empty-but-present contact when the order names nobody', async () => {
    const { payload } = await build()

    expect(payload.contact).toEqual({
      name: '',
      email: null,
      phone: null,
      city: null,
      region: null,
      country: null,
    })
  })

  // The vendor is a `company` and the contact is the PERSON — one never stands in for the
  // other, so both are resolved and both appear.
  it('resolves the contact person alongside the vendor company', async () => {
    setValue(ORDER_RECORD_ID, 'purchase_order_contact', relationship('contact:c_1'))
    setValue('contact:c_1', 'full_name', text('Anke Vogel'))
    setValue('contact:c_1', 'primary_email', text('anke@boschrexroth.com'))

    const { payload } = await build()

    expect(payload.vendor.name).toBe('Bosch Rexroth')
    expect(payload.contact.name).toBe('Anke Vogel')
    expect(payload.contact.email).toBe('anke@boschrexroth.com')
  })

  it('keeps the vendor reference separate from our own PO number', async () => {
    setValue(ORDER_RECORD_ID, 'purchase_order_reference', text('AB-77120'))
    const { payload } = await build()
    expect(payload.number).toBe('PO-0001')
    expect(payload.vendorReference).toBe('AB-77120')
  })
})

describe('document-type registry', () => {
  it('resolves purchase_order by entityType', () => {
    expect(getDocumentTypeByEntityType('purchase_order')?.id).toBe('purchase_order')
  })

  // 🛑 The pointer is the whole reason `pointerAttr` is required. `ensure-pdf.ts` reads it to
  // decide whether a cached render can be reused; a missing or misnamed field does not throw,
  // it just never finds a pointer — so every send re-renders AND mints a fresh MediaAsset
  // instead of versioning the existing one. That is an asset leak with no error attached,
  // which is why the exact attribute is pinned rather than merely asserted non-empty.
  it('points purchase_order at its own pdf-asset field', () => {
    expect(getDocumentTypeByEntityType('purchase_order')?.pointerAttr).toBe(
      'purchase_order_pdf_asset'
    )
  })

  it('gives every registered type a distinct pointer field', () => {
    const pointers = listDocumentTypes().map((d) => d.pointerAttr)
    expect(pointers).toEqual(['quote_pdf_asset', 'invoice_pdf_asset', 'purchase_order_pdf_asset'])
    expect(new Set(pointers).size).toBe(pointers.length)
  })

  it('still resolves the two older types by entityType', () => {
    expect(getDocumentTypeByEntityType('quote')?.id).toBe('quote')
    expect(getDocumentTypeByEntityType('invoice')?.id).toBe('invoice')
  })
})
