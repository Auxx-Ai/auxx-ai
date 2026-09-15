// packages/lib/src/purchasing/bill-intake/__tests__/duplicate.test.ts
//
// The one refusal that reads the paper (plans/money/tasks/58 §4.2): the same
// vendor's same invoice number already on file. The org cache is mocked and
// `db` is a chainable stub the way `intake/__tests__/resolve.test.ts` pins the
// tier ladder — what is pinned here is the FOLD (case, trim, internal
// whitespace), not the SQL.

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
import { findExistingBill } from '../duplicate'

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

const VENDOR = 'company:vendor_1' as never

beforeEach(() => {
  h.defs = new Map([['vendor_bill', 'def_vendor_bill']])
  h.materialised = new Set([
    'vendor_bill_vendor',
    'vendor_bill_number',
    'vendor_bill_internal_number',
  ])
  h.results = []
  h.selectCalls = 0
})

describe('findExistingBill', () => {
  it('finds nothing when no rows come back', async () => {
    h.results = [[]]
    const result = await findExistingBill(db, 'org_1', {
      vendorRecordId: VENDOR,
      invoiceNumber: 'INV-1',
    })
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('matches the same invoice number modulo case, trim and internal whitespace', async () => {
    h.results = [
      [{ billInstanceId: 'bill_1', number: '  INV -  88213 ', internalNumber: 'BILL-0042' }],
    ]

    const result = await findExistingBill(db, 'org_1', {
      vendorRecordId: VENDOR,
      invoiceNumber: 'inv - 88213',
    })

    expect(result._unsafeUnwrap()).toMatchObject({
      billRecordId: 'def_vendor_bill:bill_1',
      internalNumber: 'BILL-0042',
      number: '  INV -  88213 ',
    })
  })

  it('does not match a different invoice number from the same vendor', async () => {
    h.results = [[{ billInstanceId: 'bill_1', number: 'INV-1', internalNumber: 'BILL-0001' }]]

    const result = await findExistingBill(db, 'org_1', {
      vendorRecordId: VENDOR,
      invoiceNumber: 'INV-2',
    })

    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('picks the first match when several rows come back', async () => {
    h.results = [
      [
        { billInstanceId: 'bill_1', number: 'INV-1', internalNumber: 'BILL-0001' },
        { billInstanceId: 'bill_2', number: 'INV-1', internalNumber: 'BILL-0002' },
      ],
    ]

    const result = await findExistingBill(db, 'org_1', {
      vendorRecordId: VENDOR,
      invoiceNumber: 'INV-1',
    })

    expect(result._unsafeUnwrap()?.billRecordId).toBe('def_vendor_bill:bill_1')
  })

  it('returns null when the org has not seeded vendor_bill', async () => {
    h.defs = new Map()

    const result = await findExistingBill(db, 'org_1', {
      vendorRecordId: VENDOR,
      invoiceNumber: 'INV-1',
    })

    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('returns null when the org has not materialised the vendor or number fields', async () => {
    h.materialised = new Set()

    const result = await findExistingBill(db, 'org_1', {
      vendorRecordId: VENDOR,
      invoiceNumber: 'INV-1',
    })

    expect(result._unsafeUnwrap()).toBeNull()
  })
})
