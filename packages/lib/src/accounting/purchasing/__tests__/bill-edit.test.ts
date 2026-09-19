// packages/lib/src/accounting/purchasing/__tests__/bill-edit.test.ts
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
//
// 🛑 The BUILDER is real here, only the poster is stubbed. Stubbing
// `buildEntryForVendorBill` too is what hid the repost's document-number
// collision: every repost was keyed on the bill's own internal number, which
// the reversed original still carries, and `GlPosting_org_docNumber_key`
// rejects the second one.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bill: {} as Record<string, unknown>,
  lines: [] as unknown[],
  editOpen: null as { openedAt: string; byUserId: string } | null,
  postings: [] as unknown[],
  reverseEntry: vi.fn(),
  discardDraftPosting: vi.fn(),
  postVendorBillEntry: vi.fn(),
  writeBillEditOpen: vi.fn(),
  clearBillEditOpen: vi.fn(),
  ledgerState: { draftGlPostingId: null as string | null, generation: 1 },
  writeBillLedgerGeneration: vi.fn(),
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../database/src/db/schema/index')
  const enums = await import('../../../../../database/src/enums')
  return {
    schema,
    ...enums,
    database: {},
    withAccountingCommitLock: vi.fn(async () => {}),
  }
})
vi.mock('../../ledger/periods/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))
vi.mock('../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../ledger/post/draft-lines', () => ({ discardDraftPosting: h.discardDraftPosting }))
vi.mock('../../ledger/setup/book-time-zone', () => ({
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
vi.mock('../bill-ledger-state', () => ({
  readBillLedgerState: async () => h.ledgerState,
  writeBillLedgerGeneration: h.writeBillLedgerGeneration,
  writeBillDraftPosting: vi.fn(),
}))
// Partial: the builder and the key scheme are the real ones - see the header.
vi.mock('../post-vendor-bill', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../post-vendor-bill')>()),
  readAllocationBasis: async () => 'value' as const,
  postVendorBillEntry: h.postVendorBillEntry,
}))

import type { Database } from '@auxx/database'
import { BadRequestError, ConflictError } from '../../../errors'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH } from '../../ledger/builders/doc-number'
import { openBillEdit, saveBillEdit } from '../bill-edit'
import type { VendorBillLineRecord, VendorBillRecord } from '../expense-bill/reads'
import { buildEntryForVendorBill, vendorBillEntryKey } from '../post-vendor-bill'

const ORG = 'org_1'
const USER = 'user_1'
const BILL_ID = 'ei_bill_1'

/** What the live posting's stored `built` envelope says, per test. */
let storedBuilt: unknown = null

/** The entry the REAL builder makes of the current fixture - what "unchanged" means. */
function currentEntry() {
  return buildEntryForVendorBill({
    bill: h.bill as unknown as VendorBillRecord,
    lines: h.lines as unknown as VendorBillLineRecord[],
    billedAt: '2026-09-01',
  }).entry
}

/** Move the bill's figures so the rebuilt entry differs from the live one. */
function raiseTheBill() {
  h.bill = { ...h.bill, totalMinor: 275_000, subtotalMinor: 275_000 }
  h.lines = [{ ...(h.lines[0] as object), lineTotalMinor: 275_000 }]
}

/** The entry the poster was handed on the Nth call. */
function postedEntry(call = 0) {
  return h.postVendorBillEntry.mock.calls[call]?.[1]?.entry?.entry as {
    periodKey: string
  }
}

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
  h.ledgerState = { draftGlPostingId: null, generation: 1 }
  h.postings = [
    {
      glPostingId: 'gp_1',
      docNumber: 'AUXX-BIL-BILL0007',
      status: 'posted',
      postingType: 'vendor_bill',
    },
  ]
  storedBuilt = { entry: currentEntry() }
  h.reverseEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_2' })
  h.discardDraftPosting.mockResolvedValue({ isErr: () => false, error: undefined })
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
    raiseTheBill()

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
    storedBuilt = { entry: { ...currentEntry(), txnDate: '2026-08-01' } }

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
    h.lines = [
      {
        ...(h.lines[0] as object),
        purchaseOrderLineId: 'pol_1',
        quantityBilled: 4,
        unitPriceExpectedMinor: 5_000,
        glAccountId: null,
      },
    ]
    storedBuilt = { entry: currentEntry() }

    const result = await saveBillEdit(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })
    expect(result.outcome).toBe('unchanged')
    expect(h.clearBillEditOpen).toHaveBeenCalled()
  })

  it('leaves everything alone when the reversal is refused', async () => {
    raiseTheBill()
    h.reverseEntry.mockResolvedValue({ status: 'period_closed', error: 'September is locked' })

    await expect(
      saveBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/September is locked/)
    expect(h.postVendorBillEntry).not.toHaveBeenCalled()
    expect(h.clearBillEditOpen).not.toHaveBeenCalled()
  })

  it('leaves everything alone when the re-post is refused', async () => {
    raiseTheBill()
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

// Defect 2. `buildDocNumber` is deterministic on `(postingType, periodKey,
// revision)`, so a repost keyed on the internal number mints the number the
// reversed original still holds - and `GlPosting_org_docNumber_key` is unique
// per org. In auto-post mode that threw inside the transaction and made Save
// permanently impossible; in draft mode the outbox hit it on approve.
describe('the repost generation', () => {
  it('keys the repost on a NEW document number, and leaves room for its own reversal', async () => {
    h.bill = { ...h.bill, internalNumber: 'BILL-0002' }
    h.postings = [
      {
        glPostingId: 'gp_1',
        docNumber: 'AUXX-BIL-BILL0002',
        status: 'posted',
        postingType: 'vendor_bill',
      },
    ]
    storedBuilt = { entry: currentEntry() }
    raiseTheBill()

    await saveBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })

    const key = postedEntry().periodKey
    expect(key).toBe('0002G2')
    const docNumber = buildDocNumber({ postingType: 'vendor_bill', periodKey: key })
    expect(docNumber).toBe('AUXX-BIL-0002G2')
    expect(docNumber).not.toBe('AUXX-BIL-BILL0002')
    expect(
      buildDocNumber({ postingType: 'vendor_bill', periodKey: key, revision: 1 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
    expect(h.writeBillLedgerGeneration).toHaveBeenCalledWith(db, ORG, BILL_ID, 2)
  })

  // `BIL-123456` and not `BILL-123456`: the latter compacts to 10 and is over
  // the cap at generation 1 already, so it never posts in the first place.
  it('fits a six-digit internal number with its reversal suffix', async () => {
    h.bill = { ...h.bill, internalNumber: 'BIL-123456' }
    storedBuilt = { entry: currentEntry() }
    raiseTheBill()

    await saveBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })

    const key = postedEntry().periodKey
    expect(key).toBe('123456G2')
    expect(
      buildDocNumber({ postingType: 'vendor_bill', periodKey: key, revision: 1 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('claims generation 3 when a second Save reverses the repost', async () => {
    h.bill = { ...h.bill, internalNumber: 'BILL-0002' }
    h.ledgerState = { draftGlPostingId: null, generation: 2 }
    h.postings = [
      {
        glPostingId: 'gp_3',
        docNumber: 'AUXX-BIL-0002G2',
        status: 'posted',
        postingType: 'vendor_bill',
      },
    ]
    storedBuilt = { entry: currentEntry() }
    raiseTheBill()

    await saveBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })

    expect(postedEntry().periodKey).toBe('0002G3')
    expect(h.writeBillLedgerGeneration).toHaveBeenCalledWith(db, ORG, BILL_ID, 3)
  })

  it('falls back to a hashed key when the internal number carries no digits', () => {
    const key = vendorBillEntryKey('BILL', 2)
    expect(key).toMatch(/^BGN-[0-9a-z]{6}$/i)
    expect(
      buildDocNumber({ postingType: 'vendor_bill', periodKey: key!, revision: 1 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('leaves the FIRST post keyed on the internal number', () => {
    expect(vendorBillEntryKey('BILL-0002', 1)).toBeUndefined()
  })
})

// Defect 1. With auto-post off the live entry is a DRAFT: it holds no claim and
// no document number, so it is thrown away and re-drafted rather than reversed.
describe('saving against a drafted entry', () => {
  beforeEach(() => {
    h.ledgerState = { draftGlPostingId: 'gp_draft', generation: 1 }
    h.postings = [
      { glPostingId: 'gp_draft', docNumber: '', status: 'draft', postingType: 'vendor_bill' },
    ]
    h.postVendorBillEntry.mockResolvedValue({ status: 'drafted', glPostingId: 'gp_draft_2' })
  })

  it('discards the draft and drafts again, on the same generation', async () => {
    storedBuilt = { entry: currentEntry() }
    raiseTheBill()

    const result = await saveBillEdit(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(h.discardDraftPosting).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      glPostingId: 'gp_draft',
    })
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(postedEntry().periodKey).toBe('BILL-0007')
    expect(h.writeBillLedgerGeneration).not.toHaveBeenCalled()
    expect(result.outcome).toBe('reposted')
    expect(h.clearBillEditOpen).toHaveBeenCalled()
  })

  // The stale-draft bug this closes: the pointer was invisible, so Save read
  // `not_posted`, cleared the flag and left the draft standing in the outbox.
  it('no longer reads a drafted bill as not posted', async () => {
    storedBuilt = { entry: currentEntry() }
    raiseTheBill()

    const result = await saveBillEdit(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })

    expect(result.outcome).not.toBe('not_posted')
  })

  it('leaves everything alone when the draft cannot be discarded', async () => {
    storedBuilt = { entry: currentEntry() }
    raiseTheBill()
    h.discardDraftPosting.mockResolvedValue({
      isErr: () => true,
      error: new Error('it is posted, not draft'),
    })

    await expect(
      saveBillEdit(db, { organizationId: ORG, userId: USER, vendorBillInstanceId: BILL_ID })
    ).rejects.toThrow(/could not be discarded/)
    expect(h.postVendorBillEntry).not.toHaveBeenCalled()
    expect(h.clearBillEditOpen).not.toHaveBeenCalled()
  })
})
