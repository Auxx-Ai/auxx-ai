// packages/lib/src/accounting/documents/edit-in-place/__tests__/credit-memo.test.ts
//
// The lane's doors through the `credit_memo` spec row (74 §1.3), mirroring
// `vendor-bill.test.ts`. The BUILDER is real here, only the poster is stubbed:
// the repost's document-number collision lives in the key, not in the poster.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  memo: {} as Record<string, unknown>,
  lines: [] as unknown[],
  applied: 0,
  refunded: 0,
  editStamp: null as { openedAt: string; byUserId: string } | null,
  postings: [] as unknown[],
  reverseEntry: vi.fn(),
  postCreditMemoEntry: vi.fn(),
  captureRecordSnapshot: vi.fn(),
  restoreRecordSnapshot: vi.fn(),
  deleteEditSnapshot: vi.fn(),
  publishRecordEditStamp: vi.fn(),
  ledgerState: { generation: 1 },
  writeDocumentLedgerGeneration: vi.fn(),
  settleCreditMemo: vi.fn(async () => ({})),
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
vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../ledger/setup/book-time-zone', () => ({
  todayInBookTimeZone: async () => '2026-09-18',
}))
vi.mock('../../../../cache', () => ({ getCachedEntityDefId: async () => 'def_memo' }))
vi.mock('../../../../entity-instances/edit-snapshot', () => ({
  readEditStamp: async () => h.editStamp,
  captureRecordSnapshot: h.captureRecordSnapshot,
  restoreRecordSnapshot: h.restoreRecordSnapshot,
  deleteEditSnapshot: h.deleteEditSnapshot,
  publishRecordEditStamp: h.publishRecordEditStamp,
}))
vi.mock('../../../sales/credit-memos/settle', () => ({
  settleCreditMemo: h.settleCreditMemo,
}))
vi.mock('../../../sales/credit-memos/reads', () => ({
  requireCreditMemo: async () => h.memo,
  loadCreditMemoLines: async () => h.lines,
  sumCreditMemoApplications: async () => h.applied,
  sumReservedCreditMemoRefunds: async () => h.refunded,
  readShippedMemoLineIds: async (
    _db: unknown,
    _org: string,
    _memo: unknown,
    lines: Array<{ id: string }>
  ) => new Set(lines.map((line) => line.id)),
}))
vi.mock('../../document-ledger-state', () => ({
  readDocumentLedgerState: async () => h.ledgerState,
  writeDocumentLedgerGeneration: h.writeDocumentLedgerGeneration,
  writeDocumentDraftPosting: vi.fn(),
  foldDraftPosting: async (_db: unknown, _org: string, _id: string, claimed: unknown[]) => claimed,
}))
// Partial: the builder and the key scheme are the real ones - see the header.
vi.mock('../../../sales/credit-memos/accounting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../sales/credit-memos/accounting')>()),
  organizationCurrency: async () => 'USD',
  listCreditMemoPostings: async () => h.postings,
  postCreditMemoEntry: h.postCreditMemoEntry,
}))

import type { Database } from '@auxx/database'
import { BadRequestError, ConflictError } from '../../../../errors'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH } from '../../../ledger/builders/doc-number'
import { buildEntryForCreditMemo } from '../../../sales/credit-memos/accounting'
import type { CreditMemoLineRecord, CreditMemoRecord } from '../../../sales/credit-memos/reads'
import { cancelDocumentEdit } from '../cancel'
import { openDocumentEdit } from '../open'
import { saveDocumentEdit } from '../save'

const ORG = 'org_1'
const USER = 'user_1'
const MEMO_ID = 'ei_memo_1'
const target = {
  organizationId: ORG,
  userId: USER,
  family: 'credit_memo' as const,
  entityInstanceId: MEMO_ID,
}

/** What the live posting's stored `built` envelope says, per test. */
let storedBuilt: unknown = null

/** The entry the REAL builder makes of the current fixture - what "unchanged" means. */
function currentEntry() {
  return buildEntryForCreditMemo({
    memo: h.memo as unknown as CreditMemoRecord,
    lines: h.lines as unknown as CreditMemoLineRecord[],
    issuedAt: '2026-09-01',
    currency: 'USD',
    shippedLineIds: new Set((h.lines as Array<{ id: string }>).map((line) => line.id)),
  })!.entry
}

/** Move the memo's figures so the rebuilt entry differs from the live one. */
function raiseTheMemo() {
  h.lines = [{ ...(h.lines[0] as object), subtotalMinor: 30_000 }]
  h.memo = { ...h.memo, subtotalMinor: 30_000, totalMinor: 30_000 }
}

/** The entry the poster was handed on the Nth call. */
function postedEntry(call = 0) {
  return h.postCreditMemoEntry.mock.calls[call]?.[1]?.entry as { periodKey: string }
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
  h.memo = {
    id: MEMO_ID,
    number: 'CM-0007',
    status: 'issued',
    source: 'native',
    issuedAt: '2026-09-01',
    contactInstanceId: 'ei_contact_1',
    invoiceInstanceId: 'ei_invoice_1',
    orderInstanceId: null,
    subtotalMinor: 25_000,
    taxTotalMinor: 0,
    totalMinor: 25_000,
    amountAppliedMinor: 0,
    amountRefundedMinor: 0,
    balanceMinor: 25_000,
    lineIds: ['cml1'],
  }
  h.lines = [
    {
      id: 'cml1',
      description: 'Returned motors',
      qty: 5,
      unitPriceMinor: 5_000,
      subtotalMinor: 25_000,
      taxTotalMinor: 0,
      sortOrder: 0,
    },
  ]
  h.applied = 0
  h.refunded = 0
  h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: USER }
  h.ledgerState = { generation: 1 }
  h.postings = [
    {
      glPostingId: 'gp_1',
      docNumber: 'CM-0007',
      status: 'posted',
      postingType: 'credit_memo',
    },
  ]
  storedBuilt = { entry: currentEntry() }
  h.captureRecordSnapshot.mockResolvedValue({
    openedAt: '2026-09-18T00:00:00.000Z',
    byUserId: USER,
  })
  h.deleteEditSnapshot.mockResolvedValue(true)
  h.reverseEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_2' })
  h.postCreditMemoEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gp_3',
    docNumber: 'CM-0007-G2',
  })
})

describe('openDocumentEdit', () => {
  it('captures the snapshot on an issued memo and publishes the stamp', async () => {
    h.editStamp = null
    const edit = await openDocumentEdit(db, target)

    expect(edit.byUserId).toBe(USER)
    expect(h.captureRecordSnapshot).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ children: ['lines'], entityInstanceId: MEMO_ID })
    )
    expect(h.publishRecordEditStamp).toHaveBeenCalledWith(expect.objectContaining({ edit }))
  })

  it('refuses a void memo', async () => {
    h.memo = { ...h.memo, status: 'void' }
    await expect(openDocumentEdit(db, target)).rejects.toThrow(/void/)
    expect(h.captureRecordSnapshot).not.toHaveBeenCalled()
  })

  it('refuses a draft memo — there is nothing to unlock', async () => {
    h.memo = { ...h.memo, status: 'draft' }
    await expect(openDocumentEdit(db, target)).rejects.toThrow(BadRequestError)
    expect(h.captureRecordSnapshot).not.toHaveBeenCalled()
  })
})

// 75-D4. The memo's totals are `updatable: false` and the line hook will not
// recompute them once the edit row is gone, so Cancel puts them back itself.
describe('cancelDocumentEdit', () => {
  it('hands the restore the family\u2019s derived totals', async () => {
    await cancelDocumentEdit(db, target)

    expect(h.restoreRecordSnapshot).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        entityInstanceId: MEMO_ID,
        actorUserId: USER,
        derivedTotalAttrs: [
          'credit_memo_subtotal',
          'credit_memo_tax_total',
          'credit_memo_total',
          'credit_memo_balance',
        ],
      })
    )
  })
})

// 75-D5. An edit that moves the total moves the memo's remaining balance.
describe('the post-Save re-projection', () => {
  it('settles the memo again after the repost, never before it', async () => {
    raiseTheMemo()

    await saveDocumentEdit(db, target)

    expect(h.settleCreditMemo).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })
    expect(h.postCreditMemoEntry.mock.invocationCallOrder[0]!).toBeLessThan(
      h.settleCreditMemo.mock.invocationCallOrder[0]!
    )
  })

  it('re-projects nothing when the Save had no consequence', async () => {
    await saveDocumentEdit(db, target)

    expect(h.settleCreditMemo).not.toHaveBeenCalled()
  })
})

describe('saveDocumentEdit', () => {
  it('posts nothing when the rebuilt entry equals the live one, and drops the row', async () => {
    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('unchanged')
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.postCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
  })

  it('reverses then re-posts when a line moved, and drops the row', async () => {
    raiseTheMemo()

    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('reposted')
    expect(h.reverseEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ glPostingId: 'gp_1' })
    )
    expect(h.reverseEntry.mock.invocationCallOrder[0]!).toBeLessThan(
      h.postCreditMemoEntry.mock.invocationCallOrder[0]!
    )
    expect(h.writeDocumentLedgerGeneration).toHaveBeenCalledWith(db, ORG, MEMO_ID, 2)
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
  })

  // The floor, and what it protects: a credit drawn below what has already been
  // taken out of it. `voidCreditMemo` reads exactly these two sums.
  it('refuses when the new total is below what has been applied', async () => {
    h.applied = 20_000
    h.memo = { ...h.memo, totalMinor: 10_000 }

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(ConflictError)
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.postCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })

  it('counts a pending refund in the floor', async () => {
    h.refunded = 25_000
    h.memo = { ...h.memo, totalMinor: 10_000 }

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/Unapply or cancel the refund/)
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })

  it('refuses a memo that is no longer issued', async () => {
    h.memo = { ...h.memo, status: 'void' }
    await expect(saveDocumentEdit(db, target)).rejects.toThrow(BadRequestError)
  })

  it('leaves everything alone when the re-post is refused', async () => {
    raiseTheMemo()
    h.postCreditMemoEntry.mockResolvedValue({
      status: 'account_unmapped',
      error: 'no returns account',
    })

    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/no returns account/)
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })
})

describe('the repost generation', () => {
  it('keys generation 1 on the memo number, unchanged', () => {
    expect(currentEntry().periodKey).toBe('CM-0007')
    expect(buildDocNumber({ postingType: 'credit_memo', periodKey: 'CM-0007' })).toBe('CM-0007')
  })

  it('keys the repost on a NEW document number, and leaves room for its own reversal', async () => {
    raiseTheMemo()

    await saveDocumentEdit(db, target)

    const key = postedEntry().periodKey
    expect(key).toBe('CM-0007-G2')
    const docNumber = buildDocNumber({ postingType: 'credit_memo', periodKey: key })
    expect(docNumber).toBe('CM-0007-G2')
    expect(docNumber).not.toBe('CM-0007')
    expect(
      buildDocNumber({ postingType: 'credit_memo', periodKey: key, revision: 1 }).length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })
})
