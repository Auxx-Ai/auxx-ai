// packages/lib/src/purchasing/bill-intake/__tests__/find-order.test.ts
//
// `findOrderByReference`, with no real database - same chainable stub harness
// as the other bill-intake loader tests.

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
import { findOrderByReference } from '../find-order'

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

const VENDOR = 'def_company:company_1' as never

beforeEach(() => {
  h.defs = new Map([['purchase_order', 'def_purchase_order']])
  h.materialised = new Set([
    'purchase_order_vendor',
    'purchase_order_number',
    'purchase_order_reference',
    'purchase_order_status',
  ])
  h.results = []
  h.selectCalls = 0
})

describe('findOrderByReference', () => {
  it('finds the one order whose printed number matches, folded', async () => {
    h.results = [
      [{ id: 'po_1', status: 'issued' }],
      [
        { entityId: 'po_1', fieldId: 'fld_purchase_order_number', valueText: 'PO-0042' },
        { entityId: 'po_1', fieldId: 'fld_purchase_order_reference', valueText: null },
      ],
    ]

    const result = await findOrderByReference(db, 'org_1', VENDOR, 'po-0042')

    expect(result._unsafeUnwrap()).toBe('def_purchase_order:po_1')
  })

  it('matches on the reference field too', async () => {
    h.results = [
      [{ id: 'po_1', status: 'issued' }],
      [{ entityId: 'po_1', fieldId: 'fld_purchase_order_reference', valueText: 'CONF-99' }],
    ]

    const result = await findOrderByReference(db, 'org_1', VENDOR, 'conf99')

    expect(result._unsafeUnwrap()).toBe('def_purchase_order:po_1')
  })

  it('is null when two open orders match', async () => {
    h.results = [
      [
        { id: 'po_1', status: 'issued' },
        { id: 'po_2', status: 'draft' },
      ],
      [
        { entityId: 'po_1', fieldId: 'fld_purchase_order_number', valueText: 'PO-0042' },
        { entityId: 'po_2', fieldId: 'fld_purchase_order_number', valueText: 'PO-0042' },
      ],
    ]

    const result = await findOrderByReference(db, 'org_1', VENDOR, 'PO-0042')

    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('is null when nothing matches', async () => {
    h.results = [
      [{ id: 'po_1', status: 'issued' }],
      [{ entityId: 'po_1', fieldId: 'fld_purchase_order_number', valueText: 'PO-9999' }],
    ]

    const result = await findOrderByReference(db, 'org_1', VENDOR, 'PO-0042')

    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('ignores a closed order even when its number matches', async () => {
    h.results = [[{ id: 'po_1', status: 'closed' }]]

    const result = await findOrderByReference(db, 'org_1', VENDOR, 'PO-0042')

    expect(result._unsafeUnwrap()).toBeNull()
    // No point reading labels once every candidate is filtered out.
    expect(h.selectCalls).toBe(1)
  })

  it('ignores a canceled order the same way', async () => {
    h.results = [[{ id: 'po_1', status: 'canceled' }]]

    const result = await findOrderByReference(db, 'org_1', VENDOR, 'PO-0042')

    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('is null for a blank reference, with no reads at all', async () => {
    const result = await findOrderByReference(db, 'org_1', VENDOR, null)

    expect(result._unsafeUnwrap()).toBeNull()
    expect(h.selectCalls).toBe(0)
  })

  it('is null when the org has no purchase_order definition', async () => {
    h.defs.delete('purchase_order')

    const result = await findOrderByReference(db, 'org_1', VENDOR, 'PO-0042')

    expect(result._unsafeUnwrap()).toBeNull()
    expect(h.selectCalls).toBe(0)
  })
})
