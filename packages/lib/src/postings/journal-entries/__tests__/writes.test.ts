// packages/lib/src/postings/journal-entries/__tests__/writes.test.ts
//
// The pointer is the only record in the accounting module a person types line
// by line, and every rule here is about what its companion draft may become:
//
//  1. **A posted entry is corrected by REVERSAL, never by edit.** `GlPostingLine`
//     has no update path, so editing the draft's lines after posting would
//     leave two documents claiming to be the same entry.
//  2. **The accounting date is a DATE.** Stored as midnight UTC, because
//     anything else pushes a month-end entry into the previous month for any
//     reader west of UTC.
//  3. **The record needs a balanced draft to exist at all** (TARGET §1): there
//     is no `journal_entry_lines` field to hold a half-typed entry, so
//     `createJournalEntry` refuses fewer than two lines or an imbalance the
//     same way `buildManualEntry` always has - just earlier.
//
// The collaborators are stubbed at the module boundary rather than through a
// fake database: `postEntry`, `postDraft` and `reverseEntry` have their own
// exhaustive suites, and re-driving them through a second fake here would test
// the fake.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** The one record every read returns, or null for "not found". */
  record: null as Record<string, unknown> | null,
  /** What `postEntry` (the companion-draft write) answers with. */
  draftResult: { status: 'drafted', glPostingId: 'post_1' } as Record<string, unknown>,
  /** What `postDraft` / `reverseEntry` answer with. */
  postResult: { status: 'posted', glPostingId: 'post_1' } as Record<string, unknown>,
  /** Every `postEntry` call, in order. */
  posted: [] as Array<Record<string, unknown>>,
  /** Every `postDraft` call, in order. */
  draftsPosted: [] as Array<Record<string, unknown>>,
  reversed: [] as Array<Record<string, unknown>>,
  draftLinesUpdated: [] as Array<Record<string, unknown>>,
  draftsDiscarded: [] as Array<Record<string, unknown>>,
  creates: [] as Array<{ defId: string; values: Record<string, unknown> }>,
  updates: [] as Array<{ recordId: string; values: Record<string, unknown> }>,
  archives: [] as string[],
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(defId: string, values: Record<string, unknown>) {
      h.creates.push({ defId, values })
      // Mirrors the round trip `createJournalEntry` makes: it re-reads the
      // record it just created before building the companion draft, so the
      // fixture has to reflect what was actually written rather than a fixed
      // fixture.
      h.record = {
        id: 'je_1',
        number: 'JNL-0007',
        date:
          typeof values.journal_entry_date === 'string'
            ? values.journal_entry_date.slice(0, 10)
            : null,
        memo: (values.journal_entry_memo as string | undefined) ?? null,
        status: 'draft',
        kind: (values.journal_entry_kind as string | undefined) ?? 'manual',
        lines: [],
        glPostingId: null,
        recurrenceRuleId: (values.journal_entry_recurrence_rule_id as string | undefined) ?? null,
        occurrenceDate: (values.journal_entry_occurrence_date as string | undefined) ?? null,
        createdAt: '2026-08-31T00:00:00.000Z',
      }
      return { instance: { id: 'je_1' } }
    }
    async update(recordId: string, values: Record<string, unknown>) {
      h.updates.push({ recordId, values })
      if (h.record && typeof values.journal_entry_gl_posting_id === 'string') {
        h.record.glPostingId = values.journal_entry_gl_posting_id
      }
    }
    async archive(recordId: string) {
      h.archives.push(recordId)
      // Mirrors what `archivedAt` actually does to every read in this module:
      // `getJournalEntry` and `listJournalEntries` both filter
      // `archivedAt IS NULL`, so an archived row is gone as far as `reads.ts` is
      // concerned.
      h.record = null
    }
  },
}))

vi.mock('../../post-entry', () => ({
  postEntry: async (_db: unknown, options: Record<string, unknown>) => {
    h.posted.push(options)
    return h.draftResult
  },
  postDraft: async (_db: unknown, options: Record<string, unknown>) => {
    h.draftsPosted.push(options)
    return h.postResult
  },
  previewEntry: async (_db: unknown, options: Record<string, unknown>) => ({
    postingType: (options.entry as { postingType: string }).postingType,
    lines: [],
    totalMinor: 0,
    docNumber: 'AUXX-JNL-JNL0007',
    periodKey: 'JNL-0007',
    txnDate: '2026-08-31',
  }),
}))

vi.mock('../../reverse-entry', () => ({
  reverseEntry: async (_db: unknown, options: Record<string, unknown>) => {
    h.reversed.push(options)
    return h.postResult
  },
}))

vi.mock('../../draft-lines', () => ({
  updateDraftLines: async (_db: unknown, options: Record<string, unknown>) => {
    h.draftLinesUpdated.push(options)
    return { isErr: () => false }
  },
  discardDraftPosting: async (_db: unknown, options: Record<string, unknown>) => {
    h.draftsDiscarded.push(options)
    return { isErr: () => false }
  },
}))

vi.mock('../../period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))

vi.mock('../reads', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../reads')
  return {
    ...actual,
    requireJournalEntryFieldContext: async () => ({
      journalEntryDefId: 'def_je',
      fields: {
        journal_entry_number: { id: 'f_number' },
        journal_entry_date: { id: 'f_date' },
        journal_entry_memo: { id: 'f_memo' },
        journal_entry_kind: { id: 'f_kind' },
        journal_entry_gl_posting_id: { id: 'f_posting' },
      },
    }),
    requireJournalEntry: async () => {
      // The real one throws `NotFoundError` for an id that does not exist, is
      // archived, or belongs to another org - all three are deliberately
      // indistinguishable, because "this id exists but is not yours" is itself
      // a disclosure.
      if (!h.record) throw new NotFoundError('Journal entry not found')
      return h.record
    },
  }
})

import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import {
  createJournalEntry,
  discardJournalEntry,
  postJournalEntry,
  previewJournalEntry,
  reverseJournalEntry,
  updateJournalEntry,
} from '../writes'

const ORG = 'org_1'
const USER = 'user_1'
const DB = {} as never

const BALANCED_LINES = [
  { glAccountId: 'acct_6200', direction: 'debit' as const, amountMinor: 50_000 },
  { glAccountId: 'acct_2100', direction: 'credit' as const, amountMinor: 50_000 },
]

const DRAFT = {
  id: 'je_1',
  number: 'JNL-0007',
  date: '2026-08-31',
  memo: 'Accrue August rent',
  status: 'draft',
  kind: 'manual',
  lines: BALANCED_LINES,
  // Every successfully created entry carries its companion draft posting from
  // the start (TARGET §1) - there is no `glPostingId: null` state for a record
  // this far along.
  glPostingId: 'post_1',
  createdAt: '2026-08-31T00:00:00.000Z',
}

beforeEach(() => {
  h.record = { ...DRAFT }
  h.draftResult = { status: 'drafted', glPostingId: 'post_1' }
  h.postResult = { status: 'posted', glPostingId: 'post_1' }
  h.posted = []
  h.draftsPosted = []
  h.reversed = []
  h.draftLinesUpdated = []
  h.draftsDiscarded = []
  h.creates = []
  h.updates = []
  h.archives = []
})

describe('createJournalEntry', () => {
  it('lands draft, manual, with the date stored as midnight UTC, and stamps the companion posting', async () => {
    const result = await createJournalEntry(DB, ORG, USER, {
      date: '2026-08-31',
      lines: BALANCED_LINES,
    })

    expect(result.isOk()).toBe(true)
    // 🛑 Midnight UTC and nothing else. A local midnight renders a month-end
    // entry as the previous month for any reader west of UTC.
    expect(h.creates[0]?.values.journal_entry_date).toBe('2026-08-31T00:00:00.000Z')
    expect(h.posted[0]?.mode).toBe('draft')
    expect(h.posted[0]?.sources).toEqual([
      { sourceKind: 'journal_entry', sourceId: 'je_1', linkRole: 'subject' },
    ])
    expect(h.updates[0]?.values).toEqual({ journal_entry_gl_posting_id: 'post_1' })
  })

  it('refuses fewer than two lines - there is nowhere else for a half-typed entry to live', async () => {
    const result = await createJournalEntry(DB, ORG, USER, {
      date: '2026-08-31',
      lines: [{ glAccountId: 'acct_6200', direction: 'debit', amountMinor: 50_000 }],
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(h.updates).toHaveLength(0)
  })

  it('refuses an unbalanced draft', async () => {
    const result = await createJournalEntry(DB, ORG, USER, {
      date: '2026-08-31',
      lines: [
        { glAccountId: 'acct_6200', direction: 'debit', amountMinor: 50_000 },
        { glAccountId: 'acct_2100', direction: 'credit', amountMinor: 40_000 },
      ],
    })
    expect(result.isErr()).toBe(true)
  })

  it('carries the requested kind through to the posting type', async () => {
    await createJournalEntry(DB, ORG, USER, {
      date: '2025-12-31',
      kind: 'opening_balance',
      lines: BALANCED_LINES,
    })
    expect(h.creates[0]?.values.journal_entry_kind).toBe('opening_balance')
    expect((h.posted[0]?.entry as { postingType: string }).postingType).toBe('opening_balance')
  })

  // A React row id or a stray `amount` in dollars beside `amountMinor` never
  // reaches the built entry - `buildManualEntry` only reads the fields it
  // declares.
  it('ignores keys the line shape does not declare, and carries a counterparty through', async () => {
    await createJournalEntry(DB, ORG, USER, {
      date: '2026-08-31',
      lines: [
        {
          glAccountId: 'acct_1100',
          direction: 'debit',
          amountMinor: 50_000,
          rowId: 'react-key-3',
          counterpartyType: 'customer',
          counterpartyId: 'contact_1',
        } as never,
        { glAccountId: 'acct_2100', direction: 'credit', amountMinor: 50_000 },
      ],
    })
    const lines = (h.posted[0]?.entry as { lines: Record<string, unknown>[] }).lines
    expect(lines[0]).not.toHaveProperty('rowId')
    expect(lines[0]?.counterpartyType).toBe('customer')
    expect(lines[0]?.counterpartyId).toBe('contact_1')
  })

  it('refuses a date that is not YYYY-MM-DD', async () => {
    const result = await createJournalEntry(DB, ORG, USER, {
      date: '31/08/2026',
      lines: BALANCED_LINES,
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })
})

describe('updateJournalEntry', () => {
  it('rebuilds the draft posting when lines change', async () => {
    await updateJournalEntry(DB, ORG, USER, {
      journalEntryId: 'je_1',
      lines: [
        { glAccountId: 'acct_6300', direction: 'debit', amountMinor: 1 },
        { glAccountId: 'acct_2100', direction: 'credit', amountMinor: 1 },
      ],
    })
    expect(h.draftLinesUpdated[0]?.glPostingId).toBe('post_1')
    const lines = (h.draftLinesUpdated[0]?.entry as { lines: Record<string, unknown>[] }).lines
    expect(lines.map((line) => line.glAccountId)).toEqual(['acct_6300', 'acct_2100'])
  })

  it('clears the memo on an empty string and leaves it alone when omitted', async () => {
    await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1', memo: '' })
    expect(h.updates[0]?.values.journal_entry_memo).toBeNull()

    h.updates = []
    h.draftLinesUpdated = []
    await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1', date: '2026-09-01' })
    expect(h.updates[0]?.values).not.toHaveProperty('journal_entry_memo')
    expect(h.draftLinesUpdated).toHaveLength(1)
  })

  it('writes nothing at all when nothing was sent', async () => {
    const result = await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isOk()).toBe(true)
    expect(h.updates).toHaveLength(0)
    expect(h.draftLinesUpdated).toHaveLength(0)
  })

  // 🛑 The rule the whole module is arranged around.
  it('refuses to edit a posted entry, naming reversal as the remedy', async () => {
    h.record = { ...DRAFT, status: 'posted' }
    const result = await updateJournalEntry(DB, ORG, USER, {
      journalEntryId: 'je_1',
      memo: 'second thoughts',
    })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.message).toMatch(/reversing it/i)
    expect(h.updates).toHaveLength(0)
    expect(h.draftLinesUpdated).toHaveLength(0)
  })

  it('refuses to edit a reversed entry', async () => {
    h.record = { ...DRAFT, status: 'reversed' }
    const result = await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1', memo: 'x' })
    expect(result.isErr()).toBe(true)
  })
})

describe('previewJournalEntry', () => {
  it('previews the stored draft without writing anything', async () => {
    const result = await previewJournalEntry(DB, ORG, { journalEntryId: 'je_1' })
    expect(result.isOk()).toBe(true)
    expect(h.updates).toHaveLength(0)
    expect(h.draftsPosted).toHaveLength(0)
  })

  it('applies overrides for the preview and does NOT persist them', async () => {
    const result = await previewJournalEntry(DB, ORG, {
      journalEntryId: 'je_1',
      lines: [
        { glAccountId: 'acct_6300', direction: 'debit', amountMinor: 100 },
        { glAccountId: 'acct_2100', direction: 'credit', amountMinor: 100 },
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(h.updates).toHaveLength(0)
  })

  // The arithmetic throws rather than blocking, because there is no entry to
  // preview at all - and the message names the difference.
  it('refuses an unbalanced draft, naming the difference', async () => {
    h.record = {
      ...DRAFT,
      lines: [
        { glAccountId: 'acct_6200', direction: 'debit', amountMinor: 50_000 },
        { glAccountId: 'acct_2100', direction: 'credit', amountMinor: 40_000 },
      ],
    }
    const result = await previewJournalEntry(DB, ORG, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/off by 10000/)
  })
})

describe('postJournalEntry', () => {
  it('posts the existing draft posting, without rebuilding it', async () => {
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isOk()).toBe(true)
    expect(h.draftsPosted[0]?.glPostingId).toBe('post_1')
  })

  it('REFUSES an opening_balance draft, naming the route that keys it correctly', async () => {
    h.record = { ...DRAFT, kind: 'opening_balance' }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/cutover date/)
    expect(result._unsafeUnwrapErr().message).toMatch(/ledgerOpening\.post/)
    expect(h.draftsPosted).toHaveLength(0)
  })

  it('refuses an opening_balance draft on PREVIEW too, so the drawer says so before Post', async () => {
    h.record = { ...DRAFT, kind: 'opening_balance' }
    const result = await previewJournalEntry(DB, ORG, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/opening trial balance/i)
  })

  // 🛑 A refusal leaves the record alone. `postDraft` never flips the row out
  // of `draft`, so "fix it and press Post again" needs nothing cleared first.
  it('leaves the record untouched on a refusal', async () => {
    h.postResult = { status: 'period_closed', error: 'August is locked' }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('period_closed')
  })

  it('refuses to post an entry that is already posted', async () => {
    h.record = { ...DRAFT, status: 'posted' }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(h.draftsPosted).toHaveLength(0)
  })

  it('refuses to post a recurring template, saying what to do instead', async () => {
    h.record = { ...DRAFT, kind: 'recurring_template' }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/stencil/i)
    expect(h.draftsPosted).toHaveLength(0)
  })

  it('refuses to post an entry with no number', async () => {
    h.record = { ...DRAFT, number: null }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/no number/i)
  })

  it('refuses to post an entry with no date', async () => {
    h.record = { ...DRAFT, date: null }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/no date/i)
  })
})

describe('reverseJournalEntry', () => {
  beforeEach(() => {
    h.record = { ...DRAFT, status: 'posted' }
  })

  it('reverses the posting the record names', async () => {
    const result = await reverseJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isOk()).toBe(true)
    expect(h.reversed[0]?.glPostingId).toBe('post_1')
    // Nothing left to stamp: status is read back off the posting.
    expect(h.updates).toHaveLength(0)
  })

  it('refuses to reverse a draft - a draft is simply edited', async () => {
    h.record = { ...DRAFT }
    const result = await reverseJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(h.reversed).toHaveLength(0)
  })

  it('refuses to reverse twice', async () => {
    h.record = { ...DRAFT, status: 'reversed' }
    const result = await reverseJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(h.reversed).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// discardJournalEntry (plans/accounting/tasks/done/09-discard-a-draft-entry.md §4)
//
// 🛑 The RECORD is archived, never deleted - `journal_entry_number` is issued
// by `RecordSequence` on CREATE, so an abandoned `JNL-0006` leaves a permanent
// hole in a gapless sequence. The draft POSTING is deleted outright: it holds
// no claim and nothing has read it.
// ─────────────────────────────────────────────────────────────────────────────
describe('discardJournalEntry', () => {
  it('deletes the draft posting and archives the record', async () => {
    const result = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isOk()).toBe(true)
    expect(h.draftsDiscarded[0]?.glPostingId).toBe('post_1')
    expect(h.archives).toEqual(['def_je:je_1'])
  })

  it('leaves the entry unreadable afterwards, so a second discard is NotFound', async () => {
    expect((await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })).isOk()).toBe(true)

    const second = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(second.isErr()).toBe(true)
    expect(second._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(h.archives).toHaveLength(1)
  })

  it('refuses a posted entry, naming it and pointing at reversal', async () => {
    h.record = { ...DRAFT, status: 'posted' }
    const result = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.message).toContain('JNL-0007')
    expect(error.message).toMatch(/cannot be discarded/)
    expect(error.message).toMatch(/reversing it/i)
    expect(h.archives).toHaveLength(0)
    expect(h.draftsDiscarded).toHaveLength(0)
  })

  it('refuses a reversed entry the same way', async () => {
    h.record = { ...DRAFT, status: 'reversed' }
    const result = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(result._unsafeUnwrapErr().message).toMatch(/reversed and cannot be discarded/)
    expect(h.archives).toHaveLength(0)
  })

  // `requireJournalEntry` is org-scoped, and another org's id is deliberately
  // indistinguishable from one that never existed.
  it("is NotFound for another org's entry, and archives nothing", async () => {
    h.record = null
    const result = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_other_org' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(h.archives).toHaveLength(0)
  })
})
