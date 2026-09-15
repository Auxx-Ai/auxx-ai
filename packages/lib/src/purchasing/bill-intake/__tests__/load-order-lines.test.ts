// packages/lib/src/purchasing/bill-intake/__tests__/load-order-lines.test.ts
//
// `loadOrderLineFacts`, with no real database - the org cache is mocked and
// `db` is a chainable stub that answers one queued result array per
// `db.select()` call, in order (the same harness `intake/__tests__/resolve
// .test.ts` uses).

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
import { loadOrderLineFacts } from '../load-order-lines'

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
  ])
  h.materialised = new Set([
    'purchase_order_lines',
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

describe('loadOrderLineFacts', () => {
  it('returns lines in sortOrder order, with sku/title/vendorSku joined', async () => {
    h.results = [
      // 1. the order's own `purchase_order_lines` relation.
      [{ relatedEntityId: 'line_b' }, { relatedEntityId: 'line_a' }],
      // 2. liveness check.
      [{ id: 'line_b' }, { id: 'line_a' }],
      // 3. line cells.
      [
        {
          entityId: 'line_a',
          fieldId: 'fld_purchase_order_line_part',
          valueText: null,
          valueNumber: null,
          relatedEntityId: 'part_1',
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_purchase_order_line_vendor_part',
          valueText: null,
          valueNumber: null,
          relatedEntityId: 'vp_1',
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_purchase_order_line_description',
          valueText: 'Hex bolt',
          valueNumber: null,
          relatedEntityId: null,
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_purchase_order_line_quantity_ordered',
          valueText: null,
          valueNumber: 100,
          relatedEntityId: null,
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_purchase_order_line_quantity_received',
          valueText: null,
          valueNumber: 50,
          relatedEntityId: null,
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_purchase_order_line_quantity_billed',
          valueText: null,
          valueNumber: 20,
          relatedEntityId: null,
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_purchase_order_line_expected_unit_price',
          valueText: null,
          valueNumber: 250,
          relatedEntityId: null,
        },
        {
          entityId: 'line_a',
          fieldId: 'fld_purchase_order_line_sort_order',
          valueText: null,
          valueNumber: 1,
          relatedEntityId: null,
        },
        {
          entityId: 'line_b',
          fieldId: 'fld_purchase_order_line_part',
          valueText: null,
          valueNumber: null,
          relatedEntityId: 'part_2',
        },
        {
          entityId: 'line_b',
          fieldId: 'fld_purchase_order_line_description',
          valueText: 'Washer',
          valueNumber: null,
          relatedEntityId: null,
        },
        {
          entityId: 'line_b',
          fieldId: 'fld_purchase_order_line_quantity_ordered',
          valueText: null,
          valueNumber: 10,
          relatedEntityId: null,
        },
        {
          entityId: 'line_b',
          fieldId: 'fld_purchase_order_line_sort_order',
          valueText: null,
          valueNumber: 0,
          relatedEntityId: null,
        },
      ],
      // 4. part + vendor part labels.
      [
        {
          entityId: 'part_1',
          fieldId: 'fld_part_sku',
          valueText: 'HB-M8X40',
          valueNumber: null,
          relatedEntityId: null,
        },
        {
          entityId: 'part_1',
          fieldId: 'fld_part_title',
          valueText: 'Hex Bolt M8x40',
          valueNumber: null,
          relatedEntityId: null,
        },
        {
          entityId: 'part_2',
          fieldId: 'fld_part_sku',
          valueText: 'WSH-8',
          valueNumber: null,
          relatedEntityId: null,
        },
        {
          entityId: 'vp_1',
          fieldId: 'fld_vendor_part_vendor_sku',
          valueText: 'AF-4420',
          valueNumber: null,
          relatedEntityId: null,
        },
      ],
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

  it('is empty when the purchase_order_lines relation field is not materialised', async () => {
    h.materialised.delete('purchase_order_lines')
    h.results = []

    const result = await loadOrderLineFacts(db, 'org_1', ORDER)

    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.selectCalls).toBe(0)
  })
})
