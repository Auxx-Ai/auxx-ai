// packages/lib/src/purchasing/__tests__/bill-edit.test.ts
//
// 73 D4's two doors. The rules under test, in the order they matter:
//
//  1. **Edit is refused on anything but `posted`** — a draft is already
//     editable and a void bill is corrected by raising a new one.
//  2. **Save posts NOTHING when the entry has not moved.** Re-posting an
//     identical entry would leave a reversal and its twin in the books for
//     every Save that only fixed a description.
//  3. **A change reverses, then re-posts**, in that order, and the flag is
//     cleared only after both.
//  4. **A refusal leaves the entry, the values AND the flag untouched** —
//     a floor, or a reversal the ledger will not take.
//
// The collaborators are stubbed at the module boundary, the shape
// `expense-bill/__tests__/writes.test.ts` uses: `postEntry` and `reverseEntry`
// have their own exhaustive suites.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bill: {} as Record<string, unknown>,
  lines: [] as unknown[],
  editOpen: null as { openedAt: string; byUserId: string } | null,
  builtLines: [{ accountRole: 'grni', direction: 'debit', amount: 250_000 }] as unknown[],
  postings: [] as unknown[],
  reverseEntry: vi.fn(),
  postVendorBillEntry: vi.fn(),
  writeBillEditOpen: vi.fn(),
  clearBillEditOpen: vi.fn(),
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  const enums = await import('../../../../database/src/enums')
  return {
    schema,
    ...enums,
    database: {},
    withAccountingCommitLock: vi.fn(async () => {}),
  }
})
vi.mock('../../accounting/ledger/periods/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))
vi.mock('../../accounting/ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../accounting/ledger/setup/book-time-zone', () => ({
  todayInBookTimeZone: async () => '2026-09-18',
}))
vi.mock('../bill-edit-flag', () => ({
  readBillEditOpen: async () => h.editOpen,
  writeBillEditOpen: h.writeBillEditOpen,
  clearBillEditOpen: h.clearBillEditOpen,
}))
vi.mock('../expense-bill/reads', () => ({
  requireVendorBill: async () => h.bill,
  loadVendorBillLines: async () => h.lines,
}))
vi.mock('../expense-bill/writes', () => ({
  listVendorBillPostings: async () => h.postings,
}))
vi.mock('../post-vendor-bill', () => ({
  readAllocationBasis: async () => 'value',
  buildEntryForVendorBill: () => ({
    entry: { txnDate: '2026-09-01', lines: h.builtLines },
    periodKey: 'BILL-0007',
    totalMinor: 250_000,
    allocations: [],
  }),
  postVendorBillEntry: h.postVendorBillEntry,
}))

import type { Database } from '@auxx/database'
import { BadRequestError, ConflictError } from '../../errors'
import { openBillEdit, saveBillEdit } from '../bill-edit'

const ORG = 'org_1'
const USER = 'user_1'
const BILL_ID = 'ei_bill_1'

/** What the live posting's stored `built` envelope says, per test. */
let storedBuilt: unknown = null

/** A fake `db` that answers the one `GlPosting.built` read `saveBillEdit` makes. */
const db = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: async () => (storedBuilt ? [{ built: storedBuilt }] : []) }),
    }),
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
} as unknown as Database

beforeEach(() => {
  vi.clearAllMocks()
  h.bill = {
    id: BILL_ID,
    number: 'INV-77',
    internalNumber: 'BILL-0007',
    status: 'posted',
    paymentStatus: 'unpaid',
    amountPaidMinor: 0,
    amountCreditedMinor: 0,
    billedAt: '2026-09-01',
    currency: 'USD',
    totalMinor: 250_000,
    subtotalMinor: 250_000,
    shippingMinor: 0,
    taxMinor: 0,
    discountMinor: 0,
    vendorCompanyInstanceId: 'ei_company_1',
    purchaseOrderId: null,
    lineIds: ['l1'],
  }
  h.lines = [
    {
      id: 'l1',
      description: 'Motors',
      lineTotalMinor: 250_000,
      quantityBilled: 50,
      glAccountId: 'ei_acct',
      purchaseOrderLineId: null,
      unitPriceExpectedMinor: null,
      sortOrder: 0,
    },
  ]
  h.editOpen = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: USER }
  h.builtLines = [{ accountRole: 'grni', direction: 'debit', amount: 250_000 }]
  h.postings = [
    {
      glPostingId: 'gp_1',
      docNumber: 'AUXX-BIL-BILL0007',
      status: 'posted',
      postingType: 'vendor_bill',
    },
  ]
  storedBuilt = { entry: { txnDate: '2026-09-01', lines: h.builtLines } }
  h.reverseEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_2' })
  h.postVendorBillEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gp_3',
    docNumber: 'AUXX-BIL-BILL0007-R1',
  })
})

describe('openBillEdit', () => {
  it('writes the flag on a posted bill', async () => {
    h.editOpen = null
    const flag = await openBillEdit(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(flag.byUserId).toBe(USER)
    expect(h.writeBillEditOpen).toHaveBeenCalled()
  })

  it('is idempotent — a second Edit returns the standing flag and writes nothing', async () => {
    const flag = await openBillEdit(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(flag.openedAt).toBe('2026-09-18T00:00:00.000Z')
    expect(h.writeBillEditOpen).not.toHaveBeenCalled()
  })

  it('refuses a void bill', async () => {
    h.editOpen = null
    h.bill = { ...h.bill, status: 'void' }
    await expect(
      openBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/void/)
    expect(h.writeBillEditOpen).not.toHaveBeenCalled()
  })

  it('refuses a draft bill — there is nothing to unlock', async () => {
    h.editOpen = null
    h.bill = { ...h.bill, status: 'draft' }
    await expect(
      openBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(BadRequestError)
    expect(h.writeBillEditOpen).not.toHaveBeenCalled()
  })
})

describe('saveBillEdit', () => {
  it('refuses when the bill is not open for editing', async () => {
    h.editOpen = null
    await expect(
      saveBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/not open for editing/)
    expect(h.reverseEntry).not.toHaveBeenCalled()
  })

  it('posts nothing when the rebuilt entry equals the live one, and clears the flag', async () => {
    const result = await saveBillEdit(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(result.outcome).toBe('unchanged')
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.postVendorBillEntry).not.toHaveBeenCalled()
    expect(h.clearBillEditOpen).toHaveBeenCalled()
  })

  it('reverses then re-posts when a line moved, and clears the flag', async () => {
    h.builtLines = [{ accountRole: 'grni', direction: 'debit', amount: 275_000 }]

    const result = await saveBillEdit(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(result.outcome).toBe('reposted')
    expect(h.reverseEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ glPostingId: 'gp_1' })
    )
    expect(h.postVendorBillEntry).toHaveBeenCalled()
    expect(h.reverseEntry.mock.invocationCallOrder[0]!).toBeLessThan(
      h.postVendorBillEntry.mock.invocationCallOrder[0]!
    )
    expect(h.clearBillEditOpen).toHaveBeenCalled()
  })

  it('treats a moved accounting date as a change', async () => {
    storedBuilt = { entry: { txnDate: '2026-08-01', lines: h.builtLines } }

    const result = await saveBillEdit(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(result.outcome).toBe('reposted')
  })

  // The floor, and what it protects: A/P driven negative on a bill the vendor
  // has already been paid for.
  it('refuses when the new total is below what has been paid and credited', async () => {
    h.bill = { ...h.bill, totalMinor: 100_000, amountPaidMinor: 150_000 }

    await expect(
      saveBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(ConflictError)
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.postVendorBillEntry).not.toHaveBeenCalled()
    expect(h.clearBillEditOpen).not.toHaveBeenCalled()
  })

  it('saves a bill that bills less than has been received - that is ordinary GRNI', async () => {
    h.lines = [{ ...(h.lines[0] as object), purchaseOrderLineId: 'pol_1', quantityBilled: 4 }]

    const result = await saveBillEdit(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })
    expect(result.outcome).toBe('unchanged')
    expect(h.clearBillEditOpen).toHaveBeenCalled()
  })

  it('leaves everything alone when the reversal is refused', async () => {
    h.builtLines = [{ accountRole: 'grni', direction: 'debit', amount: 275_000 }]
    h.reverseEntry.mockResolvedValue({ status: 'period_closed', error: 'September is locked' })

    await expect(
      saveBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/September is locked/)
    expect(h.postVendorBillEntry).not.toHaveBeenCalled()
    expect(h.clearBillEditOpen).not.toHaveBeenCalled()
  })

  it('leaves everything alone when the re-post is refused', async () => {
    h.builtLines = [{ accountRole: 'grni', direction: 'debit', amount: 275_000 }]
    h.postVendorBillEntry.mockResolvedValue({ status: 'account_unmapped', error: 'no ppv account' })

    await expect(
      saveBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/no ppv account/)
    expect(h.clearBillEditOpen).not.toHaveBeenCalled()
  })

  it('clears the flag with no ledger work when the bill carries no live posting', async () => {
    h.postings = []

    const result = await saveBillEdit(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(result.outcome).toBe('not_posted')
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.clearBillEditOpen).toHaveBeenCalled()
  })

  it('refuses a bill that is no longer posted', async () => {
    h.bill = { ...h.bill, status: 'void' }
    await expect(
      saveBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(BadRequestError)
  })
})
