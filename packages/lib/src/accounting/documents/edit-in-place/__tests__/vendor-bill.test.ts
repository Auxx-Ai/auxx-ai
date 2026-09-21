// packages/lib/src/accounting/documents/edit-in-place/__tests__/vendor-bill.test.ts
//
// The lane's four doors through the `vendor_bill` spec row (73 D4, 74 §1.3):
//
//  1. **Edit is refused on anything in `editRefusedIn`** — a draft is already
//     editable and a void bill is corrected by raising a new one.
//  2. **Save posts NOTHING when the entry has not moved.** Re-posting an
//     identical entry would leave a reversal and its twin in the books for
//     every Save that only fixed a description.
//  3. **A change reverses, then re-posts** at the next generation, and the
//     snapshot row is dropped only after both.
//  4. **A refusal leaves the entry, the values AND the row untouched.**
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
  editStamp: null as { openedAt: string; byUserId: string } | null,
  readEditStamp: vi.fn(),
  postings: [] as unknown[],
  reverseEntry: vi.fn(),
  discardDraftPosting: vi.fn(),
  postVendorBillEntry: vi.fn(),
  captureRecordSnapshot: vi.fn(),
  restoreRecordSnapshot: vi.fn(),
  deleteEditSnapshot: vi.fn(),
  publishRecordEditStamp: vi.fn(),
  ledgerState: { draftGlPostingId: null as string | null, generation: 1 },
  writeDocumentLedgerGeneration: vi.fn(),
  syncVendorBillPaymentState: vi.fn(async () => undefined),
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../../database/src/db/schema/index')
  const enums = await import('../../../../../../database/src/enums')
  return {
    schema,
    ...enums,
    database: {},
    withAccountingCommitLock: vi.fn(async () => {}),
  }
})
vi.mock('../../../ledger/periods/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))
vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../ledger/post/draft-lines', () => ({ discardDraftPosting: h.discardDraftPosting }))
vi.mock('../../../ledger/setup/book-time-zone', () => ({
  todayInBookTimeZone: async () => '2026-09-18',
}))
vi.mock('../../../../cache', () => ({ getCachedEntityDefId: async () => 'def_bill' }))
vi.mock('../../../../entity-instances/edit-snapshot', () => ({
  readEditStamp: h.readEditStamp,
  captureRecordSnapshot: h.captureRecordSnapshot,
  restoreRecordSnapshot: h.restoreRecordSnapshot,
  deleteEditSnapshot: h.deleteEditSnapshot,
  publishRecordEditStamp: h.publishRecordEditStamp,
}))
vi.mock('../../../purchasing/expense-bill/reads', () => ({
  requireVendorBill: async () => h.bill,
  loadVendorBillLines: async () => h.lines,
}))
vi.mock('../../../purchasing/expense-bill/writes', () => ({
  listVendorBillPostings: async () => h.postings,
}))
vi.mock('../../../money/vendor-payments/payment-state', () => ({
  syncVendorBillPaymentState: h.syncVendorBillPaymentState,
}))
vi.mock('../../../purchasing/landed-cost/reads', () => ({
  readLandedAccrualRemaining: async () => new Map(),
}))
vi.mock('../../document-ledger-state', () => ({
  readDocumentLedgerState: async () => h.ledgerState,
  writeDocumentLedgerGeneration: h.writeDocumentLedgerGeneration,
  writeDocumentDraftPosting: vi.fn(),
}))
// Partial: the builder and the key scheme are the real ones - see the header.
vi.mock('../../../purchasing/post-vendor-bill', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../purchasing/post-vendor-bill')>()),
  readAllocationBasis: async () => 'value' as const,
  postVendorBillEntry: h.postVendorBillEntry,
}))

import type { Database } from '@auxx/database'
import { BadRequestError, ConflictError } from '../../../../errors'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH } from '../../../ledger/builders/doc-number'
import type { VendorBillLineRecord, VendorBillRecord } from '../../../purchasing/expense-bill/reads'
import { buildEntryForVendorBill } from '../../../purchasing/post-vendor-bill'
import { cancelDocumentEdit } from '../cancel'
import { openDocumentEdit } from '../open'
import { saveDocumentEdit } from '../save'

const ORG = 'org_1'
const USER = 'user_1'
const BILL_ID = 'ei_bill_1'
const target = {
  organizationId: ORG,
  userId: USER,
  family: 'vendor_bill' as const,
  entityInstanceId: BILL_ID,
}

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
  return h.postVendorBillEntry.mock.calls[call]?.[1]?.entry?.entry as { periodKey: string }
}

/** A fake `db` that answers the one `GlPosting.built` read Save makes. */
const db = {
  select: () => ({
    from: () => ({
      where: () => {
        const rows = storedBuilt ? [{ id: 'gp_read', built: storedBuilt }] : []
        return Object.assign(Promise.resolve(rows), { limit: async () => rows })
      },
    }),
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
} as unknown as Database

beforeEach(() => {
  vi.clearAllMocks()
  h.readEditStamp.mockImplementation(async () => h.editStamp)
  h.bill = {
    id: BILL_ID,
    number: 'INV-77',
    internalNumber: 'BILL-0007',
    status: 'posted',
    paymentStatus: 'unpaid',
    amountPaidMinor: 0,
    amountCreditedMinor: 0,
    amountDiscountedMinor: 0,
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
  h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: USER }
  h.ledgerState = { draftGlPostingId: null, generation: 1 }
  h.postings = [
    {
      glPostingId: 'gp_1',
      docNumber: 'BILL-0007',
      status: 'posted',
      postingType: 'vendor_bill',
    },
  ]
  storedBuilt = { entry: currentEntry() }
  h.captureRecordSnapshot.mockResolvedValue({
    openedAt: '2026-09-18T00:00:00.000Z',
    byUserId: USER,
  })
  h.restoreRecordSnapshot.mockResolvedValue(undefined)
  h.deleteEditSnapshot.mockResolvedValue(true)
  h.reverseEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_2' })
  h.discardDraftPosting.mockResolvedValue({ isErr: () => false, error: undefined })
  h.postVendorBillEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gp_3',
    docNumber: 'BILL-0007-R1',
  })
})

describe('openDocumentEdit', () => {
  it('captures the snapshot on a posted bill and publishes the stamp', async () => {
    h.editStamp = null
    const edit = await openDocumentEdit(db, target)

    expect(edit.byUserId).toBe(USER)
    expect(h.captureRecordSnapshot).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ children: ['lines'], entityInstanceId: BILL_ID })
    )
    expect(h.publishRecordEditStamp).toHaveBeenCalledWith(expect.objectContaining({ edit }))
  })

  it('refuses a void bill', async () => {
    h.bill = { ...h.bill, status: 'void' }
    await expect(openDocumentEdit(db, target)).rejects.toThrow(/void/)
    expect(h.captureRecordSnapshot).not.toHaveBeenCalled()
  })

  it('refuses a draft bill — there is nothing to unlock', async () => {
    h.bill = { ...h.bill, status: 'draft' }
    await expect(openDocumentEdit(db, target)).rejects.toThrow(BadRequestError)
    expect(h.captureRecordSnapshot).not.toHaveBeenCalled()
  })
})

describe('cancelDocumentEdit', () => {
  it('restores the snapshot and clears the stamp', async () => {
    const result = await cancelDocumentEdit(db, target)

    expect(result.edit).toBeNull()
    expect(h.restoreRecordSnapshot).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ entityInstanceId: BILL_ID, actorUserId: USER })
    )
  })

  // 75-D4. A bill's total, subtotal and tax are transcribed and `updatable`, so
  // the balance is the only figure Cancel has to put back by hand.
  it('hands the restore the family’s derived totals', async () => {
    await cancelDocumentEdit(db, target)

    expect(h.restoreRecordSnapshot).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ derivedTotalAttrs: ['vendor_bill_balance'] })
    )
    expect(h.publishRecordEditStamp).toHaveBeenCalledWith(expect.objectContaining({ edit: null }))
  })

  it('refuses by name when no edit is open', async () => {
    h.editStamp = null
    await expect(cancelDocumentEdit(db, target)).rejects.toThrow(/not open for editing/)
    expect(h.restoreRecordSnapshot).not.toHaveBeenCalled()
  })
})

describe('saveDocumentEdit', () => {
  it('refuses when the bill is not open for editing', async () => {
    h.editStamp = null
    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/not open for editing/)
    expect(h.reverseEntry).not.toHaveBeenCalled()
  })

  it('posts nothing when the rebuilt entry equals the live one, and drops the row', async () => {
    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('unchanged')
    expect(result.edit).toBeNull()
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.postVendorBillEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
  })

  it('reverses then re-posts when a line moved, and drops the row', async () => {
    raiseTheBill()

    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('reposted')
    expect(h.reverseEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ glPostingId: 'gp_1' })
    )
    expect(h.postVendorBillEntry).toHaveBeenCalled()
    expect(h.reverseEntry.mock.invocationCallOrder[0]!).toBeLessThan(
      h.postVendorBillEntry.mock.invocationCallOrder[0]!
    )
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
    expect(h.publishRecordEditStamp).toHaveBeenCalledWith(expect.objectContaining({ edit: null }))
  })

  it('treats a moved accounting date as a change', async () => {
    storedBuilt = { entry: { ...currentEntry(), txnDate: '2026-08-01' } }

    const result = await saveDocumentEdit(db, target)
    expect(result.outcome).toBe('reposted')
  })

  // The floor, and what it protects: A/P driven negative on a bill the vendor
  // has already been paid for.
  it('refuses when the new total is below what has been settled', async () => {
    h.bill = { ...h.bill, totalMinor: 100_000, amountPaidMinor: 150_000 }

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(ConflictError)
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.postVendorBillEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
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

    const result = await saveDocumentEdit(db, target)
    expect(result.outcome).toBe('unchanged')
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
  })

  it('leaves everything alone when the reversal is refused', async () => {
    raiseTheBill()
    h.reverseEntry.mockResolvedValue({ status: 'period_closed', error: 'September is locked' })

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/September is locked/)
    expect(h.postVendorBillEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })

  it('leaves everything alone when the re-post is refused', async () => {
    raiseTheBill()
    h.postVendorBillEntry.mockResolvedValue({ status: 'account_unmapped', error: 'no ppv account' })

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/no ppv account/)
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })

  it('reads not_posted only when accounting is off', async () => {
    h.postings = []
    h.postVendorBillEntry.mockResolvedValue(null)

    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('not_posted')
    expect(result.docNumber).toBeNull()
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
  })

  // Two concurrent Saves both clear the pre-lock precondition. The one that
  // loses the commit lock finds no snapshot row left and must write nothing -
  // reversing here would back out the entry the winner just posted.
  it('writes nothing when another Save closed the edit before the lock was taken', async () => {
    raiseTheBill()
    h.readEditStamp.mockResolvedValueOnce(h.editStamp).mockResolvedValueOnce(null)

    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('unchanged')
    expect(result.docNumber).toBe('BILL-0007')
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.postVendorBillEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })

  it('refuses a bill that is no longer posted', async () => {
    h.bill = { ...h.bill, status: 'void' }
    await expect(saveDocumentEdit(db, target)).rejects.toThrow(BadRequestError)
  })
})

// 75-D5. Moving the total moves what is still owed, and the projection is the
// only writer of the status that gates Record payment.
describe('the post-Save re-projection', () => {
  it('re-projects payment state after the repost, never before it', async () => {
    raiseTheBill()

    await saveDocumentEdit(db, target)

    expect(h.syncVendorBillPaymentState).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      userId: USER,
      vendorBillInstanceId: BILL_ID,
    })
    expect(h.postVendorBillEntry.mock.invocationCallOrder[0]!).toBeLessThan(
      h.syncVendorBillPaymentState.mock.invocationCallOrder[0]!
    )
  })

  it('re-projects nothing when the Save had no consequence', async () => {
    await saveDocumentEdit(db, target)

    expect(h.syncVendorBillPaymentState).not.toHaveBeenCalled()
  })

  it('re-projects nothing when a refusal left the edit open', async () => {
    raiseTheBill()
    h.reverseEntry.mockResolvedValue({ status: 'period_closed', error: 'September is locked' })

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/September is locked/)
    expect(h.syncVendorBillPaymentState).not.toHaveBeenCalled()
  })

  it('re-projects even with accounting off, because the status is not a ledger fact', async () => {
    h.postings = []
    h.postVendorBillEntry.mockResolvedValue(null)

    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('not_posted')
    expect(h.syncVendorBillPaymentState).toHaveBeenCalled()
  })
})

// Defect 2. `buildDocNumber` is deterministic on `(postingType, periodKey,
// revision)`, so a repost keyed on the internal number mints the number the
// reversed original still holds - and `GlPosting_org_docNumber_key` is unique
// per org.
describe('the repost generation', () => {
  it('keys the repost on a NEW document number, and leaves room for its own reversal', async () => {
    h.bill = { ...h.bill, internalNumber: 'BILL-0002' }
    h.postings = [
      {
        glPostingId: 'gp_1',
        docNumber: 'BILL-0002',
        status: 'posted',
        postingType: 'vendor_bill',
      },
    ]
    storedBuilt = { entry: currentEntry() }
    raiseTheBill()

    await saveDocumentEdit(db, target)

    const key = postedEntry().periodKey
    expect(key).toBe('BILL-0002-G2')
    const docNumber = buildDocNumber({ postingType: 'vendor_bill', periodKey: key })
    expect(docNumber).toBe('BILL-0002-G2')
    expect(docNumber).not.toBe('BILL-0002')
    expect(
      buildDocNumber({ postingType: 'vendor_bill', periodKey: key, revision: 1 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
    expect(h.writeDocumentLedgerGeneration).toHaveBeenCalledWith(db, ORG, BILL_ID, 2)
  })

  it('claims generation 3 when a second Save reverses the repost', async () => {
    h.bill = { ...h.bill, internalNumber: 'BILL-0002' }
    h.ledgerState = { draftGlPostingId: null, generation: 2 }
    h.postings = [
      {
        glPostingId: 'gp_3',
        docNumber: 'BILL-0002-G2',
        status: 'posted',
        postingType: 'vendor_bill',
      },
    ]
    storedBuilt = { entry: currentEntry() }
    raiseTheBill()

    await saveDocumentEdit(db, target)

    expect(postedEntry().periodKey).toBe('BILL-0002-G3')
    expect(h.writeDocumentLedgerGeneration).toHaveBeenCalledWith(db, ORG, BILL_ID, 3)
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

    const result = await saveDocumentEdit(db, target)

    expect(h.discardDraftPosting).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      glPostingId: 'gp_draft',
    })
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(postedEntry().periodKey).toBe('BILL-0007')
    expect(h.writeDocumentLedgerGeneration).not.toHaveBeenCalled()
    expect(result.outcome).toBe('reposted')
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
  })

  // The stranding this closes: the bill is `posted` from the moment Post ran,
  // so Post refuses it, and before this Save read `not_posted` and cleared the
  // flag - leaving a bill in the books' lifecycle with no entry and no door.
  it('posts again on the same generation when the draft was discarded in the outbox', async () => {
    h.ledgerState = { draftGlPostingId: null, generation: 1 }
    h.postings = []

    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('reposted')
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.discardDraftPosting).not.toHaveBeenCalled()
    expect(postedEntry().periodKey).toBe('BILL-0007')
    expect(h.writeDocumentLedgerGeneration).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
  })

  // posted -> Save reversed it and bumped to 2 -> that repost's DRAFT was
  // discarded. Generation 2's document number was never minted, so the repost
  // keys on 2 again; bumping to 3 here would burn a generation per discard.
  it('keys on the already-bumped generation without bumping it again', async () => {
    h.bill = { ...h.bill, internalNumber: 'BILL-0002' }
    h.ledgerState = { draftGlPostingId: null, generation: 2 }
    h.postings = [
      {
        glPostingId: 'gp_1',
        docNumber: 'BILL-0002',
        status: 'reversed',
        postingType: 'vendor_bill',
      },
    ]

    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('reposted')
    expect(postedEntry().periodKey).toBe('BILL-0002-G2')
    expect(h.writeDocumentLedgerGeneration).not.toHaveBeenCalled()
    expect(h.reverseEntry).not.toHaveBeenCalled()
  })

  it('leaves the row standing when the re-post of a discarded entry is refused', async () => {
    h.postings = []
    h.postVendorBillEntry.mockResolvedValue({
      status: 'period_closed',
      error: 'September is locked',
    })

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/September is locked/)
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })

  it('leaves everything alone when the draft cannot be discarded', async () => {
    storedBuilt = { entry: currentEntry() }
    raiseTheBill()
    h.discardDraftPosting.mockResolvedValue({
      isErr: () => true,
      error: new Error('it is posted, not draft'),
    })

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/could not be discarded/)
    expect(h.postVendorBillEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })
})
