// packages/lib/src/accounting/documents/edit-in-place/__tests__/journal-entry.test.ts
//
// The lane's doors through the `journal_entry` spec row (91 D5), mirroring
// `credit-memo.test.ts`. The builder is real; only the poster and the reads are
// stubbed, so the repost's key comes from the real `documentEntryKey`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  entry: {} as Record<string, unknown>,
  editStamp: null as { openedAt: string; byUserId: string } | null,
  storedBuilt: null as unknown,
  reverseEntry: vi.fn(),
  postBuiltJournalEntry: vi.fn(),
  captureRecordSnapshot: vi.fn(),
  restoreRecordSnapshot: vi.fn(),
  deleteEditSnapshot: vi.fn(),
  publishRecordEditStamp: vi.fn(),
  ledgerState: { generation: 1 },
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
vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../ledger/reads/read-posting', () => ({
  readPostingHeader: async (_db: unknown, _org: string, id: string) => ({
    id,
    docNumber: 'JNL0007',
    status: 'posted',
    postingType: 'manual_journal',
  }),
  readPostingHeaders: async () =>
    new Map(h.storedBuilt ? [['gp_1', { id: 'gp_1', built: h.storedBuilt }]] : []),
}))
vi.mock('../../../../cache', () => ({ getCachedEntityDefId: async () => 'def_je' }))
vi.mock('../../../../entity-instances/edit-snapshot', () => ({
  readEditStamp: async () => h.editStamp,
  captureRecordSnapshot: h.captureRecordSnapshot,
  restoreRecordSnapshot: h.restoreRecordSnapshot,
  deleteEditSnapshot: h.deleteEditSnapshot,
  publishRecordEditStamp: h.publishRecordEditStamp,
}))
vi.mock('../../document-ledger-state', () => ({
  readDocumentLedgerState: async () => h.ledgerState,
  writeDocumentLedgerGeneration: h.writeDocumentLedgerGeneration,
}))
vi.mock('../../../journals/entries/reads', () => ({
  requireJournalEntry: async () => structuredClone(h.entry),
}))
// Partial: the builder is the real one - see the header.
vi.mock('../../../journals/entries/writes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../journals/entries/writes')>()),
  postBuiltJournalEntry: h.postBuiltJournalEntry,
}))

import type { Database } from '@auxx/database'
import { BadRequestError, UnprocessableEntityError } from '../../../../errors'
import { buildEntryForJournalEntry } from '../../../journals/entries/writes'
import { cancelDocumentEdit } from '../cancel'
import { openDocumentEdit } from '../open'
import { saveDocumentEdit } from '../save'

const ORG = 'org_1'
const USER = 'user_1'
const ENTRY_ID = 'je_1'
const target = {
  organizationId: ORG,
  userId: USER,
  family: 'journal_entry' as const,
  entityInstanceId: ENTRY_ID,
}

const db = {
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
} as unknown as Database

function entryLines(amountMinor: number) {
  return [
    { id: 'l1', glAccountId: 'acct_6200', direction: 'debit', amountMinor },
    { id: 'l2', glAccountId: 'acct_2100', direction: 'credit', amountMinor },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.entry = {
    id: ENTRY_ID,
    number: 'JNL-0007',
    date: '2026-08-31',
    memo: 'Accrue August rent',
    status: 'posted',
    kind: 'manual',
    lines: entryLines(50_000),
    glPostingId: 'gp_1',
    recurrenceRuleId: null,
    occurrenceDate: null,
    createdAt: '2026-08-31T00:00:00.000Z',
  }
  h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: USER }
  h.ledgerState = { generation: 1 }
  h.storedBuilt = { entry: buildEntryForJournalEntry(h.entry as never).entry }
  h.captureRecordSnapshot.mockResolvedValue({
    openedAt: '2026-09-18T00:00:00.000Z',
    byUserId: USER,
  })
  h.deleteEditSnapshot.mockResolvedValue(true)
  h.reverseEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gp_2' })
  h.postBuiltJournalEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gp_3',
    docNumber: 'JNL0007-G2',
  })
})

describe('openDocumentEdit', () => {
  it('captures the snapshot with the lines on a posted entry', async () => {
    h.editStamp = null
    await openDocumentEdit(db, target)
    expect(h.captureRecordSnapshot).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ children: ['lines'], entityInstanceId: ENTRY_ID })
    )
  })

  it('refuses an unposted entry - it is already editable', async () => {
    h.entry = { ...h.entry, status: 'draft', glPostingId: null }
    await expect(openDocumentEdit(db, target)).rejects.toThrow(BadRequestError)
    expect(h.captureRecordSnapshot).not.toHaveBeenCalled()
  })

  it('refuses a reversed entry', async () => {
    h.entry = { ...h.entry, status: 'reversed' }
    await expect(openDocumentEdit(db, target)).rejects.toThrow(/reversed/)
  })

  it.each([
    ['opening_balance', /opening balances page/],
    ['recurring', /template for the next occurrence/],
  ])('refuses a %s entry', async (kind, message) => {
    h.entry = { ...h.entry, kind }
    await expect(openDocumentEdit(db, target)).rejects.toThrow(UnprocessableEntityError)
    await expect(openDocumentEdit(db, target)).rejects.toThrow(message)
  })
})

describe('cancelDocumentEdit', () => {
  it('restores with no derived totals - a journal has none', async () => {
    await cancelDocumentEdit(db, target)
    expect(h.restoreRecordSnapshot).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ entityInstanceId: ENTRY_ID, derivedTotalAttrs: [] })
    )
  })
})

describe('saveDocumentEdit', () => {
  it('posts nothing when the lines are what the live posting holds', async () => {
    const result = await saveDocumentEdit(db, target)
    expect(result.outcome).toBe('unchanged')
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.postBuiltJournalEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).toHaveBeenCalled()
  })

  it('reverses the live posting and reposts the edited lines at the next generation', async () => {
    h.entry = { ...h.entry, lines: entryLines(60_000) }

    const result = await saveDocumentEdit(db, target)

    expect(result.outcome).toBe('reposted')
    expect(h.reverseEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ glPostingId: 'gp_1' })
    )
    const posted = h.postBuiltJournalEntry.mock.calls[0]?.[1] as {
      entry: { id: string }
      built: { entry: { periodKey: string; lines: Array<{ amount: number }> } }
    }
    expect(posted.entry.id).toBe(ENTRY_ID)
    expect(posted.built.entry.periodKey).toBe('JNL-0007-G2')
    expect(posted.built.entry.lines.map((line) => line.amount)).toEqual([60_000, 60_000])
    expect(h.reverseEntry.mock.invocationCallOrder[0]!).toBeLessThan(
      h.postBuiltJournalEntry.mock.invocationCallOrder[0]!
    )
    expect(h.writeDocumentLedgerGeneration).toHaveBeenCalledWith(db, ORG, ENTRY_ID, 2)
  })

  it('refuses the edit before the ledger when the edited lines do not balance', async () => {
    h.entry = {
      ...h.entry,
      lines: [
        { id: 'l1', glAccountId: 'acct_6200', direction: 'debit', amountMinor: 60_000 },
        { id: 'l2', glAccountId: 'acct_2100', direction: 'credit', amountMinor: 50_000 },
      ],
    }
    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/does not balance/)
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })

  it('leaves everything alone when the repost is refused', async () => {
    h.entry = { ...h.entry, lines: entryLines(60_000) }
    h.postBuiltJournalEntry.mockResolvedValue({
      status: 'unbalanced',
      error: 'The entry does not balance',
    })
    await expect(saveDocumentEdit(db, target)).rejects.toThrow(/The entry does not balance/)
    expect(h.deleteEditSnapshot).not.toHaveBeenCalled()
  })
})
