// packages/lib/src/accounting/documents/edit-in-place/__tests__/invoice.test.ts
//
// The lane's doors through the `invoice` spec row (74 §1.3), the shape
// `vendor-bill.test.ts` established one family over:
//
//  1. Edit is refused on `draft`, `void` and `written_off`.
//  2. Save posts NOTHING when the issuance entry has not moved.
//  3. A change reverses, then re-posts at the next generation.
//  4. A floor refusal leaves the entry, the values AND the row untouched.
//
// 🛑 The BUILDER is real here, only the poster is stubbed — the issuance entry
// keys its document number on the invoice NUMBER, which the reversed original
// still carries, so a repost that did not re-key would collide on
// `GlPosting_org_docNumber_key`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  invoice: {} as Record<string, unknown>,
  issuance: {} as Record<string, unknown>,
  editStamp: null as { openedAt: string; byUserId: string } | null,
  postings: [] as unknown[],
  reverseEntry: vi.fn(),
  discardDraftPosting: vi.fn(),
  postInvoiceIssuanceBuiltEntry: vi.fn(),
  captureRecordSnapshot: vi.fn(),
  restoreRecordSnapshot: vi.fn(),
  deleteEditSnapshot: vi.fn(),
  publishRecordEditStamp: vi.fn(),
  ledgerState: { draftGlPostingId: null as string | null, generation: 1 },
  writeDocumentLedgerGeneration: vi.fn(),
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
vi.mock('../../../../cache', () => ({ getCachedEntityDefId: async () => 'def_invoice' }))
vi.mock('../../../../entity-instances/edit-snapshot', () => ({
  readEditStamp: async () => h.editStamp,
  captureRecordSnapshot: h.captureRecordSnapshot,
  restoreRecordSnapshot: h.restoreRecordSnapshot,
  deleteEditSnapshot: h.deleteEditSnapshot,
  publishRecordEditStamp: h.publishRecordEditStamp,
}))
vi.mock('../../../sales/invoices/edit-reads', () => ({
  loadInvoiceForEdit: async () => h.invoice,
}))
vi.mock('../../../sales/invoices/issuance-reads', () => ({
  loadInvoiceForIssuance: async () => h.issuance,
}))
vi.mock('../../../sales/invoices/post-invoice', () => ({
  listInvoiceEditPostings: async () => h.postings,
}))
vi.mock('../../document-ledger-state', () => ({
  readDocumentLedgerState: async () => h.ledgerState,
  writeDocumentLedgerGeneration: h.writeDocumentLedgerGeneration,
  writeDocumentDraftPosting: vi.fn(),
  foldDraftPosting: async (_db: unknown, _o: string, _i: string, rows: unknown[]) => rows,
}))
// Partial: the builder and the key scheme are the real ones - see the header.
vi.mock('../../../sales/invoices/issuance-accounting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../sales/invoices/issuance-accounting')>()),
  postInvoiceIssuanceBuiltEntry: h.postInvoiceIssuanceBuiltEntry,
}))

import type { Database } from '@auxx/database'
import { BadRequestError, ConflictError } from '../../../../errors'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH } from '../../../ledger/builders/doc-number'
import { buildEntryForInvoiceIssuance } from '../../../sales/invoices/issuance-accounting'
import type { InvoiceForIssuance } from '../../../sales/invoices/issuance-reads'
import { cancelDocumentEdit } from '../cancel'
import { openDocumentEdit } from '../open'
import { saveDocumentEdit } from '../save'

const ORG = 'org_1'
const USER = 'user_1'
const INVOICE_ID = 'ei_invoice_1'
const target = {
  organizationId: ORG,
  userId: USER,
  family: 'invoice' as const,
  entityInstanceId: INVOICE_ID,
}

/** What the live posting's stored `built` envelope says, per test. */
let storedBuilt: unknown = null

/** The entry the REAL builder makes of the current fixture - what "unchanged" means. */
function currentEntry() {
  return buildEntryForInvoiceIssuance({
    invoiceId: INVOICE_ID,
    invoice: h.issuance as unknown as InvoiceForIssuance,
    issuedAt: '2026-09-01',
  }).entry
}

/** Move the invoice's figures so the rebuilt entry differs from the live one. */
function raiseTheInvoice() {
  h.issuance = { ...h.issuance, totalMinor: 275_000, subtotalMinor: 275_000 }
  h.invoice = { ...h.invoice, totalMinor: 275_000 }
}

/** The entry the poster was handed on the Nth call. */
function postedEntry(call = 0) {
  return h.postInvoiceIssuanceBuiltEntry.mock.calls[call]?.[1]?.entry?.entry as {
    periodKey: string
  }
}

/** A fake `db` that answers the one `GlPosting.built` read Save makes. */
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
  h.invoice = {
    id: INVOICE_ID,
    status: 'sent',
    number: 'INV-0007',
    totalMinor: 250_000,
    amountPaidMinor: 0,
    amountCreditedMinor: 0,
  }
  h.issuance = {
    number: 'INV-0007',
    issuedAt: '2026-09-01',
    subtotalMinor: 250_000,
    taxTotalMinor: 0,
    totalMinor: 250_000,
    contactInstanceId: 'ei_contact_1',
  }
  h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: USER }
  h.ledgerState = { draftGlPostingId: null, generation: 1 }
  h.postings = [
    {
      glPostingId: 'gp_1',
      docNumber: 'AUXX-INI-INV0007',
      status: 'posted',
      postingType: 'invoice_issued',
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
  h.postInvoiceIssuanceBuiltEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gp_3',
    docNumber: 'AUXX-INI-0007G2',
  })
})

describe('openDocumentEdit', () => {
  it('captures the snapshot on an issued invoice and publishes the stamp', async () => {
    h.editStamp = null
    const edit = await openDocumentEdit(db, target)

    expect(edit.byUserId).toBe(USER)
    expect(h.captureRecordSnapshot).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ children: ['lineItems'], entityInstanceId: INVOICE_ID })
    )
    expect(h.publishRecordEditStamp).toHaveBeenCalledWith(expect.objectContaining({ edit }))
  })

  it.each(['draft', 'void', 'written_off'])('refuses a %s invoice', async (status) => {
    h.invoice = { ...h.invoice, status }
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
      expect.objectContaining({ entityInstanceId: INVOICE_ID, actorUserId: USER })
    )
  })
})

describe('saveDocumentEdit', () => {
  it('posts nothing when the rebuilt entry equals the live one, and drops the row', async () => {
    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('unchanged')
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.postInvoiceIssuanceBuiltEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
  })

  it('reverses then re-posts when the total moved, and drops the row', async () => {
    raiseTheInvoice()

    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('reposted')
    expect(h.reverseEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ glPostingId: 'gp_1' })
    )
    expect(h.reverseEntry.mock.invocationCallOrder[0]!).toBeLessThan(
      h.postInvoiceIssuanceBuiltEntry.mock.invocationCallOrder[0]!
    )
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
    expect(h.publishRecordEditStamp).toHaveBeenCalledWith(expect.objectContaining({ edit: null }))
  })

  // The floor, and what it protects: a receivable driven below what the customer
  // has already paid or been credited.
  it('refuses when the new total is below what has been settled', async () => {
    h.invoice = { ...h.invoice, totalMinor: 100_000, amountPaidMinor: 90_000 }
    h.invoice = { ...h.invoice, amountCreditedMinor: 60_000 }

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(ConflictError)
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.postInvoiceIssuanceBuiltEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })

  it('refuses a written-off invoice', async () => {
    h.invoice = { ...h.invoice, status: 'written_off' }
    await expect(saveDocumentEdit(db, target)).rejects.toThrow(BadRequestError)
  })

  it('leaves everything alone when the re-post is refused', async () => {
    raiseTheInvoice()
    h.postInvoiceIssuanceBuiltEntry.mockResolvedValue({
      status: 'period_closed',
      error: 'September is locked',
    })

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/September is locked/)
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })

  it('reads not_posted only when accounting is off', async () => {
    h.postings = []
    h.postInvoiceIssuanceBuiltEntry.mockResolvedValue(null)

    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('not_posted')
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
  })
})

// The issuance entry keys on the invoice number, which the reversed original
// still holds; `GlPosting_org_docNumber_key` is unique per org.
describe('the repost generation', () => {
  it('keeps generation 1 on the invoice number, byte for byte', async () => {
    h.postings = []
    h.postInvoiceIssuanceBuiltEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_9' })

    await saveDocumentEdit(db, target)

    expect(postedEntry().periodKey).toBe('INV-0007')
    expect(buildDocNumber({ postingType: 'invoice_issued', periodKey: 'INV-0007' })).toBe(
      'AUXX-INI-INV0007'
    )
    expect(h.writeDocumentLedgerGeneration).not.toHaveBeenCalled()
  })

  it('keys the repost on a NEW document number, and leaves room for its own reversal', async () => {
    raiseTheInvoice()

    await saveDocumentEdit(db, target)

    const key = postedEntry().periodKey
    expect(key).toBe('0007G2')
    const docNumber = buildDocNumber({ postingType: 'invoice_issued', periodKey: key })
    expect(docNumber).toBe('AUXX-INI-0007G2')
    expect(docNumber).not.toBe('AUXX-INI-INV0007')
    expect(
      buildDocNumber({ postingType: 'invoice_issued', periodKey: key, revision: 1 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
    expect(h.writeDocumentLedgerGeneration).toHaveBeenCalledWith(db, ORG, INVOICE_ID, 2)
  })
})

// With auto-post off — the default — the live entry is a DRAFT: it holds no
// claim and no document number, so it is thrown away and re-drafted.
describe('saving against a drafted entry', () => {
  it('discards the draft and drafts again, on the same generation', async () => {
    h.ledgerState = { draftGlPostingId: 'gp_draft', generation: 1 }
    h.postings = [
      { glPostingId: 'gp_draft', docNumber: '', status: 'draft', postingType: 'invoice_issued' },
    ]
    h.postInvoiceIssuanceBuiltEntry.mockResolvedValue({
      status: 'drafted',
      glPostingId: 'gp_draft_2',
    })
    raiseTheInvoice()

    const result = await saveDocumentEdit(db, target)

    expect(h.discardDraftPosting).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      glPostingId: 'gp_draft',
    })
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(postedEntry().periodKey).toBe('INV-0007')
    expect(h.writeDocumentLedgerGeneration).not.toHaveBeenCalled()
    expect(result.outcome).toBe('reposted')
  })
})
