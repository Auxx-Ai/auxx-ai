// packages/lib/src/purchasing/bill-intake/__tests__/load-bill-lines.test.ts
//
// `loadBillLineFacts`, with no real database - same chainable stub harness as
// `load-order-lines.test.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  defs: new Map<string, string>(),
  materialised: new Set<string>(),
  results: [] as unknown[][],
  selectCalls: 0,
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(
          attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])
        ),
    }),
  }),
}))

import type { Database } from '@auxx/database'
import { loadBillLineFacts } from '../load-bill-lines'

function chainReturning(rows: unknown[]): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(rows)
        return () => proxy
      },
    }
  )
  return proxy
}

const db = {
  select: () => chainReturning(h.results[h.selectCalls++] ?? []),
} as unknown as Database

const BILL = 'def_vendor_bill:bill_1' as never

const FULLY_MATERIALISED = [
  'vendor_bill_vendor',
  'vendor_bill_purchase_order',
  'vendor_bill_currency',
  'vendor_bill_lines',
  'vendor_bill_line_vendor_code',
  'vendor_bill_line_description',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price',
  'vendor_bill_line_purchase_order_line',
  'vendor_bill_line_sort_order',
]

beforeEach(() => {
  h.defs = new Map([
    ['company', 'def_company'],
    ['purchase_order', 'def_purchase_order'],
    ['vendor_bill_line', 'def_vbl'],
    ['purchase_order_line', 'def_pol'],
  ])
  h.materialised = new Set(FULLY_MATERIALISED)
  h.results = []
  h.selectCalls = 0
})

describe('loadBillLineFacts', () => {
  it('reads the header and its lines, in sort order', async () => {
    h.results = [
      // 1. existence check.
      [{ id: 'bill_1' }],
      // 2. bill header cells (includes the vendor_bill_lines rows).
      [
        {
          entityId: 'bill_1',
          fieldId: 'fld_vendor_bill_vendor',
          valueText: null,
          valueNumber: null,
          relatedEntityId: 'company_1',
        },
        {
          entityId: 'bill_1',
          fieldId: 'fld_vendor_bill_purchase_order',
          valueText: null,
          valueNumber: null,
          relatedEntityId: 'po_1',
        },
        {
          entityId: 'bill_1',
          fieldId: 'fld_vendor_bill_currency',
          valueText: 'EUR',
          valueNumber: null,
          relatedEntityId: null,
        },
        {
          entityId: 'bill_1',
          fieldId: 'fld_vendor_bill_lines',
          valueText: null,
          valueNumber: null,
          relatedEntityId: 'line_b',
        },
        {
          entityId: 'bill_1',
          fieldId: 'fld_vendor_bill_lines',
          valueText: null,
          valueNumber: null,
          relatedEntityId: 'line_a',
        },
      ],
      // 3. liveness check for the two lines.
      [{ id: 'line_b' }, { id: 'line_a' }],
      // 4. line cells.
      [
        {
          entityId: 'line_a',
          fieldId: 'fld_vendor_bill_line_vendor_code',
          valueText: 'AF-4420',
          valueNumber: null,
          relatedEntityId: null,
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_vendor_bill_line_description',
          valueText: 'Hex bolt',
          valueNumber: null,
          relatedEntityId: null,
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_vendor_bill_line_quantity_billed',
          valueText: null,
          valueNumber: 100,
          relatedEntityId: null,
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_vendor_bill_line_unit_price',
          valueText: null,
          valueNumber: 250,
          relatedEntityId: null,
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_vendor_bill_line_purchase_order_line',
          valueText: null,
          valueNumber: null,
          relatedEntityId: 'pol_1',
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_vendor_bill_line_sort_order',
          valueText: null,
          valueNumber: 1,
          relatedEntityId: null,
        },
        {
          entityId: 'line_b',
          fieldId: 'fld_vendor_bill_line_description',
          valueText: 'Freight',
          valueNumber: null,
          relatedEntityId: null,
        },
        {
          entityId: 'line_b',
          fieldId: 'fld_vendor_bill_line_quantity_billed',
          valueText: null,
          valueNumber: 1,
          relatedEntityId: null,
        },
        {
          entityId: 'line_b',
          fieldId: 'fld_vendor_bill_line_sort_order',
          valueText: null,
          valueNumber: 0,
          relatedEntityId: null,
        },
      ],
    ]

    const result = await loadBillLineFacts(db, 'org_1', BILL)
    const bill = result._unsafeUnwrap()

    expect(bill.vendorRecordId).toBe('def_company:company_1')
    expect(bill.purchaseOrderRecordId).toBe('def_purchase_order:po_1')
    expect(bill.currency).toBe('EUR')
    expect(bill.lines).toHaveLength(2)

    expect(bill.lines[0]?.lineRecordId).toBe('def_vbl:line_b')
    expect(bill.lines[0]?.lineId).toBe('def_vbl:line_b')
    expect(bill.lines[0]?.description).toBe('Freight')
    expect(bill.lines[0]?.vendorCode).toBeNull()
    expect(bill.lines[0]?.customerCode).toBeNull()
    expect(bill.lines[0]?.purchaseOrderLineRecordId).toBeNull()

    expect(bill.lines[1]?.lineRecordId).toBe('def_vbl:line_a')
    expect(bill.lines[1]?.vendorCode).toBe('AF-4420')
    expect(bill.lines[1]?.quantity).toBe(100)
    expect(bill.lines[1]?.unitPriceCents).toBe(250)
    expect(bill.lines[1]?.purchaseOrderLineRecordId).toBe('def_pol:pol_1')
  })

  it('reads vendorCode as null when the org has not migrated vendor_bill_line_vendor_code yet', async () => {
    h.materialised.delete('vendor_bill_line_vendor_code')
    h.results = [
      [{ id: 'bill_1' }],
      [
        {
          entityId: 'bill_1',
          fieldId: 'fld_vendor_bill_lines',
          valueText: null,
          valueNumber: null,
          relatedEntityId: 'line_a',
        },
      ],
      [{ id: 'line_a' }],
      [
        {
          entityId: 'line_a',
          fieldId: 'fld_vendor_bill_line_description',
          valueText: 'Hex bolt',
          valueNumber: null,
          relatedEntityId: null,
        },
      ],
    ]

    const result = await loadBillLineFacts(db, 'org_1', BILL)
    const bill = result._unsafeUnwrap()

    expect(bill.lines[0]?.vendorCode).toBeNull()
  })

  it('fails with NotFoundError when the bill does not exist', async () => {
    h.results = [[]]

    const result = await loadBillLineFacts(db, 'org_1', BILL)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toBe('Vendor bill not found')
  })
})
