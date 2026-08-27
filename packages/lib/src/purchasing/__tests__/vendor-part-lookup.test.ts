// packages/lib/src/purchasing/__tests__/vendor-part-lookup.test.ts
// The `(part, supplier)` lookup behind a purchase order line's price prefill.
// The org cache is mocked and `db` is a chainable stub, so nothing here needs a
// database — what is asserted is the CONTRACT: both legs of the natural key are
// required (there is no preferred-vendor fallback), a missing row is `null`
// rather than an error, and a row with no price still returns its link.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  /** One result array per `db.select()` call, in order. */
  results: [] as unknown[][],
  /** How many statements the function actually issued. */
  selectCalls: 0,
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])
        ),
    }),
  }),
}))

import type { Database } from '@auxx/database'
import { findVendorPartForLine } from '../vendor-part-lookup'

/**
 * A drizzle query builder that answers `rows` however it is chained.
 *
 * Every method returns the same proxy, so `.from().innerJoin().where().limit()`
 * composes without the stub having to know the statement's shape — which is the
 * point: this test pins the function's RULES, not its SQL.
 */
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

const PARAMS = { partInstanceId: 'part_1', vendorInstanceId: 'company_1' }

beforeEach(() => {
  h.defs = new Map([['vendor_part', 'def_vendor_part']])
  h.materialised = new Set(['vendor_part_part', 'vendor_part_contact', 'vendor_part_unit_price'])
  h.results = []
  h.selectCalls = 0
})

describe('findVendorPartForLine', () => {
  it('returns the supplier row and its price as a prefill', async () => {
    h.results = [[{ id: 'vp_1' }], [{ valueNumber: 1250 }]]

    const result = await findVendorPartForLine(db, 'org_1', PARAMS)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      vendorPartRecordId: 'def_vendor_part:vp_1',
      unitPrice: 1250,
    })
  })

  // A supplier that stocks the part but has not priced it is a real row, and the
  // link is still worth stamping — there is simply nothing to prefill with. The
  // caller must not read this as "no supplier row".
  it('returns the link with a null price when the row carries no price', async () => {
    h.results = [[{ id: 'vp_1' }], []]

    const result = await findVendorPartForLine(db, 'org_1', PARAMS)

    expect(result._unsafeUnwrap()).toEqual({
      vendorPartRecordId: 'def_vendor_part:vp_1',
      unitPrice: null,
    })
  })

  // 🛑 The rule §5.2 exists to state: no row for THIS pair means no prefill. There
  // is no fall back to the part's preferred vendor — that would put a different
  // supplier's price on this supplier's order.
  it('is null when this supplier has no entry for this part', async () => {
    h.results = [[]]

    const result = await findVendorPartForLine(db, 'org_1', PARAMS)

    expect(result._unsafeUnwrap()).toBeNull()
    // And it does not go looking for a price it has no row to read one from.
    expect(h.selectCalls).toBe(1)
  })

  it('is null, not an error, on an org with no vendor_part definition', async () => {
    h.defs = new Map()

    const result = await findVendorPartForLine(db, 'org_1', PARAMS)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeNull()
    expect(h.selectCalls).toBe(0)
  })

  // 🛑 Both legs of the natural key or nothing. Matching on the part alone would
  // return "any vendor part for this part", which IS the preferred-vendor
  // fallback wearing a different hat — and it would query, which is why the
  // assertion is that no statement is issued at all.
  it.each([
    'vendor_part_part',
    'vendor_part_contact',
  ])('refuses to query when %s is not materialised', async (missing) => {
    h.materialised.delete(missing)
    h.results = [[{ id: 'vp_1' }], [{ valueNumber: 1250 }]]

    const result = await findVendorPartForLine(db, 'org_1', PARAMS)

    expect(result._unsafeUnwrap()).toBeNull()
    expect(h.selectCalls).toBe(0)
  })

  // The price field is the only one that may be absent without sinking the
  // lookup: provenance is still resolvable, and a mid-migration org should get
  // the link rather than nothing.
  it('still returns the link when the price field is not materialised', async () => {
    h.materialised.delete('vendor_part_unit_price')
    h.results = [[{ id: 'vp_1' }]]

    const result = await findVendorPartForLine(db, 'org_1', PARAMS)

    expect(result._unsafeUnwrap()).toEqual({
      vendorPartRecordId: 'def_vendor_part:vp_1',
      unitPrice: null,
    })
    expect(h.selectCalls).toBe(1)
  })
})
