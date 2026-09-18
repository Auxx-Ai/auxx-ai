// packages/lib/src/purchasing/bill-intake/__tests__/load-bill-lines.test.ts
//
// `loadBillLineFacts`, with no real database - same chainable stub harness as
// `load-order-lines.test.ts`. Query order IS the contract of the double, and
// `readSystemRecords` issues two per def: the instances, then their cells.

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
      bySystemAttributes: async (attrs: readonly string[]) => fieldStubs(attrs, h.materialised),
    }),
  }),
}))

import type { Database } from '@auxx/database'
import { loadBillLineFacts } from '../load-bill-lines'
import { fieldStubs } from './support/field-stubs'

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

/** One `FieldValue` row, in the shape `rowsToTypedValues` reads. */
function row(
  entityId: string,
  attribute: string,
  value: Partial<{
    valueText: string
    valueNumber: number
    relatedEntityId: string
    relatedEntityDefinitionId: string
  }>
): Record<string, unknown> {
  return {
    id: `fv_${entityId}_${attribute}`,
    entityId,
    fieldId: `fld_${attribute}`,
    sortKey: 'a0',
    createdAt: null,
    updatedAt: null,
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
    optionId: null,
    relatedEntityId: null,
    relatedEntityDefinitionId: null,
    actorId: null,
    ...value,
  }
}

const instance = (id: string) => ({ id, createdAt: null, updatedAt: null, archivedAt: null })

beforeEach(() => {
  h.defs = new Map([
    ['vendor_bill', 'def_vendor_bill'],
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
      // 1. the bill's instance row.
      [instance('bill_1')],
      // 2. bill header cells (includes the vendor_bill_lines rows).
      [
        row('bill_1', 'vendor_bill_vendor', {
          relatedEntityId: 'company_1',
          relatedEntityDefinitionId: 'def_company',
        }),
        row('bill_1', 'vendor_bill_purchase_order', {
          relatedEntityId: 'po_1',
          relatedEntityDefinitionId: 'def_purchase_order',
        }),
        row('bill_1', 'vendor_bill_currency', { valueText: 'EUR' }),
        row('bill_1', 'vendor_bill_lines', {
          relatedEntityId: 'line_b',
          relatedEntityDefinitionId: 'def_vbl',
        }),
        row('bill_1', 'vendor_bill_lines', {
          relatedEntityId: 'line_a',
          relatedEntityDefinitionId: 'def_vbl',
        }),
      ],
      // 3. the two lines' instance rows.
      [instance('line_a'), instance('line_b')],
      // 4. line cells.
      [
        row('line_a', 'vendor_bill_line_vendor_code', { valueText: 'AF-4420' }),
        row('line_a', 'vendor_bill_line_description', { valueText: 'Hex bolt' }),
        row('line_a', 'vendor_bill_line_quantity_billed', { valueNumber: 100 }),
        row('line_a', 'vendor_bill_line_unit_price', { valueNumber: 250 }),
        row('line_a', 'vendor_bill_line_purchase_order_line', {
          relatedEntityId: 'pol_1',
          relatedEntityDefinitionId: 'def_pol',
        }),
        row('line_a', 'vendor_bill_line_sort_order', { valueNumber: 1 }),
        row('line_b', 'vendor_bill_line_description', { valueText: 'Freight' }),
        row('line_b', 'vendor_bill_line_quantity_billed', { valueNumber: 1 }),
        row('line_b', 'vendor_bill_line_sort_order', { valueNumber: 0 }),
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
      [instance('bill_1')],
      [
        row('bill_1', 'vendor_bill_lines', {
          relatedEntityId: 'line_a',
          relatedEntityDefinitionId: 'def_vbl',
        }),
      ],
      [instance('line_a')],
      [row('line_a', 'vendor_bill_line_description', { valueText: 'Hex bolt' })],
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
