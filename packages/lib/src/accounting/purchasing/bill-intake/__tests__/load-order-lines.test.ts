// packages/lib/src/accounting/purchasing/bill-intake/__tests__/load-order-lines.test.ts
//
// `loadOrderLineFacts`, with no real database - the org cache is mocked and
// `db` is a chainable stub that answers one queued result array per
// `db.select()` call, in order (the same harness `intake/__tests__/resolve
// .test.ts` uses).
//
// Query order IS the contract of this double, and `readSystemRecords` issues
// two per def (instances, then cells) plus one for the `by:` child ids.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  defs: new Map<string, string>(),
  materialised: new Set<string>(),
  results: [] as unknown[][],
  selectCalls: 0,
}))

vi.mock('../../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) => fieldStubs(attrs, h.materialised),
    }),
  }),
}))

import type { Database } from '@auxx/database'
import { loadOrderLineFacts } from '../load-order-lines'
import { fieldStubs } from './support/field-stubs'

/** Answers `rows` however the builder is chained, then resolves on await. */
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

const ORDER = 'def_purchase_order:po_1' as never

beforeEach(() => {
  h.defs = new Map([
    ['purchase_order_line', 'def_pol'],
    ['part', 'def_part'],
    ['vendor_part', 'def_vp'],
  ])
  h.materialised = new Set([
    'purchase_order_line_purchase_order',
    'purchase_order_line_part',
    'purchase_order_line_vendor_part',
    'purchase_order_line_description',
    'purchase_order_line_quantity_ordered',
    'purchase_order_line_quantity_received',
    'purchase_order_line_quantity_billed',
    'purchase_order_line_expected_unit_price',
    'purchase_order_line_sort_order',
    'part_sku',
    'part_title',
    'vendor_part_vendor_sku',
  ])
  h.results = []
  h.selectCalls = 0
})

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

describe('loadOrderLineFacts', () => {
  it('returns lines in sortOrder order, with sku/title/vendorSku joined', async () => {
    h.results = [
      // 1. the lines whose own parent relation names this order.
      [{ entityId: 'line_b' }, { entityId: 'line_a' }],
      // 2. those lines' instance rows.
      [instance('line_a'), instance('line_b')],
      // 3. line cells.
      [
        row('line_a', 'purchase_order_line_part', {
          relatedEntityId: 'part_1',
          relatedEntityDefinitionId: 'def_part',
        }),
        row('line_a', 'purchase_order_line_vendor_part', {
          relatedEntityId: 'vp_1',
          relatedEntityDefinitionId: 'def_vp',
        }),
        row('line_a', 'purchase_order_line_description', { valueText: 'Hex bolt' }),
        row('line_a', 'purchase_order_line_quantity_ordered', { valueNumber: 100 }),
        row('line_a', 'purchase_order_line_quantity_received', { valueNumber: 50 }),
        row('line_a', 'purchase_order_line_quantity_billed', { valueNumber: 20 }),
        row('line_a', 'purchase_order_line_expected_unit_price', { valueNumber: 250 }),
        row('line_a', 'purchase_order_line_sort_order', { valueNumber: 1 }),
        row('line_b', 'purchase_order_line_part', {
          relatedEntityId: 'part_2',
          relatedEntityDefinitionId: 'def_part',
        }),
        row('line_b', 'purchase_order_line_description', { valueText: 'Washer' }),
        row('line_b', 'purchase_order_line_quantity_ordered', { valueNumber: 10 }),
        row('line_b', 'purchase_order_line_sort_order', { valueNumber: 0 }),
      ],
      // 4. part instances, then 5. their cells.
      [instance('part_1'), instance('part_2')],
      [
        row('part_1', 'part_sku', { valueText: 'HB-M8X40' }),
        row('part_1', 'part_title', { valueText: 'Hex Bolt M8x40' }),
        row('part_2', 'part_sku', { valueText: 'WSH-8' }),
      ],
      // 6. vendor part instances, then 7. their cells.
      [instance('vp_1')],
      [row('vp_1', 'vendor_part_vendor_sku', { valueText: 'AF-4420' })],
    ]

    const result = await loadOrderLineFacts(db, 'org_1', ORDER)
    const lines = result._unsafeUnwrap()

    expect(lines).toHaveLength(2)
    expect(lines[0]?.orderLineRecordId).toBe('def_pol:line_b')
    expect(lines[0]?.partSku).toBe('WSH-8')
    expect(lines[0]?.vendorSku).toBeNull()
    expect(lines[0]?.ordered).toBe(10)
    expect(lines[0]?.received).toBe(0)

    expect(lines[1]?.orderLineRecordId).toBe('def_pol:line_a')
    expect(lines[1]?.partSku).toBe('HB-M8X40')
    expect(lines[1]?.partTitle).toBe('Hex Bolt M8x40')
    expect(lines[1]?.vendorSku).toBe('AF-4420')
    expect(lines[1]?.ordered).toBe(100)
    expect(lines[1]?.received).toBe(50)
    expect(lines[1]?.billed).toBe(20)
    expect(lines[1]?.expectedUnitPriceCents).toBe(250)
  })

  it('is empty when the order has no lines, with no further reads', async () => {
    h.results = [[]]

    const result = await loadOrderLineFacts(db, 'org_1', ORDER)

    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.selectCalls).toBe(1)
  })

  it('is empty when the org has no purchase_order_line definition yet', async () => {
    h.defs.delete('purchase_order_line')
    h.results = []

    const result = await loadOrderLineFacts(db, 'org_1', ORDER)

    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.selectCalls).toBe(0)
  })

  it('is empty when the line -> order relation field is not materialised', async () => {
    h.materialised.delete('purchase_order_line_purchase_order')
    h.results = []

    const result = await loadOrderLineFacts(db, 'org_1', ORDER)

    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.selectCalls).toBe(0)
  })
})
