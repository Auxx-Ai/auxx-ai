// packages/lib/src/purchasing/bill-intake/__tests__/resolve-vendor.test.ts
//
// The auto-continue rule (plans/money/tasks/58 §4.1 step 2): strict, because
// there is no review screen before the bill is created. `resolveQuoteVendor`
// itself is exercised in `intake/__tests__/resolve.test.ts`; this file mocks
// it and pins only what THIS module adds on top — the fold and the
// exactly-one-hit gate.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  candidates: [] as { recordId: string; displayName: string; secondary: string | null }[],
}))

vi.mock('../../intake/resolve', () => ({
  resolveQuoteVendor: vi.fn(async () => {
    const { ok } = await import('neverthrow')
    return ok(h.candidates)
  }),
}))

import type { Database } from '@auxx/database'
import { resolveInvoiceVendor } from '../resolve-vendor'

const db = {} as Database

beforeEach(() => {
  h.candidates = []
})

describe('resolveInvoiceVendor', () => {
  it('continues on exactly one exact (folded) name match', async () => {
    h.candidates = [{ recordId: 'company:c1', displayName: 'Acme', secondary: null }]

    const result = await resolveInvoiceVendor(db, 'org_1', {
      vendorName: 'Acme',
      vendorEmail: null,
    })

    expect(result._unsafeUnwrap().vendorRecordId).toBe('company:c1')
  })

  it('does not continue on two exact hits', async () => {
    h.candidates = [
      { recordId: 'company:c1', displayName: 'Acme', secondary: null },
      { recordId: 'company:c2', displayName: 'Acme', secondary: null },
    ]

    const result = await resolveInvoiceVendor(db, 'org_1', {
      vendorName: 'Acme',
      vendorEmail: null,
    })

    const resolution = result._unsafeUnwrap()
    expect(resolution.vendorRecordId).toBeNull()
    expect(resolution.candidates).toHaveLength(2)
  })

  it('does not continue on a contains-only hit', async () => {
    h.candidates = [{ recordId: 'company:c1', displayName: 'Acme Industrial', secondary: null }]

    const result = await resolveInvoiceVendor(db, 'org_1', {
      vendorName: 'Acme',
      vendorEmail: null,
    })

    expect(result._unsafeUnwrap().vendorRecordId).toBeNull()
  })

  it('continues across a suffix difference ("Acme Ltd" vs "ACME Limited")', async () => {
    h.candidates = [{ recordId: 'company:c1', displayName: 'ACME Limited', secondary: null }]

    const result = await resolveInvoiceVendor(db, 'org_1', {
      vendorName: 'Acme Ltd',
      vendorEmail: null,
    })

    expect(result._unsafeUnwrap().vendorRecordId).toBe('company:c1')
  })

  it('does not continue when there are no candidates at all', async () => {
    h.candidates = []

    const result = await resolveInvoiceVendor(db, 'org_1', {
      vendorName: 'Nobody Ltd',
      vendorEmail: null,
    })

    const resolution = result._unsafeUnwrap()
    expect(resolution.vendorRecordId).toBeNull()
    expect(resolution.candidates).toEqual([])
  })

  it('does not continue when the invoice prints no vendor name at all', async () => {
    h.candidates = [{ recordId: 'company:c1', displayName: 'Acme', secondary: null }]

    const result = await resolveInvoiceVendor(db, 'org_1', {
      vendorName: null,
      vendorEmail: 'billing@acme.com',
    })

    expect(result._unsafeUnwrap().vendorRecordId).toBeNull()
  })
})
