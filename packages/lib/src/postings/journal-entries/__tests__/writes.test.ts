// packages/lib/src/postings/journal-entries/__tests__/writes.test.ts
//
// The draft is the only record in the accounting module a person types line by
// line, and every rule here is about what a draft may become:
//
//  1. **A posted entry is corrected by REVERSAL, never by edit.** `GlPostingLine`
//     has no update path, so editing this record's JSON after posting would
//     leave two documents claiming to be the same entry - and the one a
//     bookkeeper reads would be the wrong one.
//  2. **The record is stamped only when a posting was actually written.** A
//     refusal leaves the draft alone, which is exactly what "fix it and press
//     Post again" needs.
//  3. **The accounting date is a DATE.** Stored as midnight UTC, because
//     anything else pushes a month-end entry into the previous month for any
//     reader west of UTC.
//
// The collaborators are stubbed at the module boundary rather than through a
// fake database: `postEntry` and `reverseEntry` have their own exhaustive
// suites, and re-driving them through a second fake here would test the fake.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** The one record every read returns, or null for "not found". */
  record: null as Record<string, unknown> | null,
  /** What `postEntry` / `reverseEntry` answer with. */
  postResult: { status: 'posted', glPostingId: 'post_1' } as Record<string, unknown>,
  /** Every `UnifiedCrudHandler` call, in order. */
  creates: [] as Array<{ defId: string; values: Record<string, unknown> }>,
  updates: [] as Array<{ recordId: string; values: Record<string, unknown> }>,
  posted: [] as Array<Record<string, unknown>>,
  reversed: [] as Array<Record<string, unknown>>,
  archives: [] as string[],
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(defId: string, values: Record<string, unknown>) {
      h.creates.push({ defId, values })
      return { instance: { id: 'je_1' } }
    }
    async update(recordId: string, values: Record<string, unknown>) {
      h.updates.push({ recordId, values })
    }
    async archive(recordId: string) {
      h.archives.push(recordId)
      // Mirrors what `archivedAt` actually does to every read in this module:
      // `getJournalEntry` and `listJournalEntries` both filter
      // `archivedAt IS NULL`, so an archived row is gone as far as `reads.ts` is
      // concerned. Dropping it here is what lets the second-discard test below
      // be about the real behaviour rather than about the double.
      h.record = null
    }
  },
}))

vi.mock('../../post-entry', () => ({
  postEntry: async (_db: unknown, options: Record<string, unknown>) => {
    h.posted.push(options)
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
        journal_entry_status: { id: 'f_status' },
        journal_entry_kind: { id: 'f_kind' },
        journal_entry_lines: { id: 'f_lines' },
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
import type { JournalEntryLine } from '../client'
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

const DRAFT = {
  id: 'je_1',
  number: 'JNL-0007',
  date: '2026-08-31',
  memo: 'Accrue August rent',
  status: 'draft',
  kind: 'manual',
  lines: [
    { accountCode: '6200', direction: 'debit', amountMinor: 50_000 },
    { accountCode: '2100', direction: 'credit', amountMinor: 50_000 },
  ],
  glPostingId: null,
  createdAt: '2026-08-31T00:00:00.000Z',
}

beforeEach(() => {
  h.record = { ...DRAFT }
  h.postResult = { status: 'posted', glPostingId: 'post_1' }
  h.creates = []
  h.updates = []
  h.posted = []
  h.reversed = []
  h.archives = []
})

describe('createJournalEntry', () => {
  it('lands draft, manual, with the date stored as midnight UTC', async () => {
    const result = await createJournalEntry(DB, ORG, USER, { date: '2026-08-31' })

    expect(result.isOk()).toBe(true)
    const values = h.creates[0]?.values
    expect(values?.journal_entry_status).toBe('draft')
    expect(values?.journal_entry_kind).toBe('manual')
    // 🛑 Midnight UTC and nothing else. A local midnight renders a month-end
    // entry as the previous month for any reader west of UTC.
    expect(values?.journal_entry_date).toBe('2026-08-31T00:00:00.000Z')
  })

  it('accepts an empty draft, so the drawer can save before it balances', async () => {
    const result = await createJournalEntry(DB, ORG, USER, { date: '2026-08-31' })
    expect(result.isOk()).toBe(true)
    // 🛑 The envelope, not a bare array: a `FieldValue` write reads a top-level
    // array as a MULTI-VALUE write and this field is single-value.
    expect(h.creates[0]?.values.journal_entry_lines).toEqual({ lines: [] })
  })

  it('carries the requested kind through', async () => {
    await createJournalEntry(DB, ORG, USER, { date: '2025-12-31', kind: 'opening_balance' })
    expect(h.creates[0]?.values.journal_entry_kind).toBe('opening_balance')
  })

  // A React row id or a stray `amount` in dollars beside `amountMinor` is
  // exactly the ambiguity ground rule 2 exists to remove.
  it('strips keys the line shape does not declare', async () => {
    await createJournalEntry(DB, ORG, USER, {
      date: '2026-08-31',
      lines: [
        // A React row id and a stray dollar `amount` beside `amountMinor`:
        // what a sloppy client actually sends.
        {
          accountCode: '6200',
          direction: 'debit',
          amountMinor: 50_000,
          rowId: 'react-key-3',
          amount: 500,
        } as unknown as JournalEntryLine,
      ],
    })
    expect(h.creates[0]?.values.journal_entry_lines).toEqual({
      lines: [{ accountCode: '6200', direction: 'debit', amountMinor: 50_000 }],
    })
  })

  it('refuses a date that is not YYYY-MM-DD', async () => {
    const result = await createJournalEntry(DB, ORG, USER, { date: '31/08/2026' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })
})

describe('updateJournalEntry', () => {
  it('replaces the lines wholesale', async () => {
    await updateJournalEntry(DB, ORG, USER, {
      journalEntryId: 'je_1',
      lines: [{ accountCode: '6300', direction: 'debit', amountMinor: 1 }],
    })
    expect(h.updates[0]?.values.journal_entry_lines).toEqual({
      lines: [{ accountCode: '6300', direction: 'debit', amountMinor: 1 }],
    })
  })

  it('clears the memo on an empty string and leaves it alone when omitted', async () => {
    await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1', memo: '' })
    expect(h.updates[0]?.values.journal_entry_memo).toBeNull()

    h.updates = []
    await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1', date: '2026-09-01' })
    expect(h.updates[0]?.values).not.toHaveProperty('journal_entry_memo')
  })

  it('writes nothing at all when nothing was sent', async () => {
    const result = await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isOk()).toBe(true)
    expect(h.updates).toHaveLength(0)
  })

  // 🛑 The rule the whole module is arranged around.
  it('refuses to edit a posted entry, naming reversal as the remedy', async () => {
    h.record = { ...DRAFT, status: 'posted', glPostingId: 'post_1' }
    const result = await updateJournalEntry(DB, ORG, USER, {
      journalEntryId: 'je_1',
      memo: 'second thoughts',
    })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.message).toMatch(/reversing it/i)
    expect(h.updates).toHaveLength(0)
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
    expect(h.posted).toHaveLength(0)
  })

  it('applies overrides for the preview and does NOT persist them', async () => {
    const result = await previewJournalEntry(DB, ORG, {
      journalEntryId: 'je_1',
      lines: [
        { accountCode: '6300', direction: 'debit', amountMinor: 100 },
        { accountCode: '2100', direction: 'credit', amountMinor: 100 },
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(h.updates).toHaveLength(0)
  })

  // The arithmetic throws rather than blocking, because there is no entry to
  // preview at all - and the message names the row.
  it('refuses an unbalanced draft, naming the difference', async () => {
    h.record = {
      ...DRAFT,
      lines: [
        { accountCode: '6200', direction: 'debit', amountMinor: 50_000 },
        { accountCode: '2100', direction: 'credit', amountMinor: 40_000 },
      ],
    }
    const result = await previewJournalEntry(DB, ORG, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/off by 10000/)
  })
})

describe('postJournalEntry', () => {
  it('posts the draft as a manual_journal keyed on its number', async () => {
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isOk()).toBe(true)
    const entry = h.posted[0]?.entry as { postingType: string; periodKey: string }
    expect(entry.postingType).toBe('manual_journal')
    expect(entry.periodKey).toBe('JNL-0007')
  })

  it('REFUSES an opening_balance draft, naming the route that keys it correctly', async () => {
    // 🛑 An opening entry keys on the CUTOVER DATE (`doc-number.ts`), and this
    // path keys on the record's number. Posting one here would mint
    // `AUXX-OPB-JNL0007` instead of `AUXX-OPB-20251231`, so a SECOND opening
    // trial balance would claim cleanly on
    // `(organizationId, postingType, periodKey, revision)` - the exact double
    // that the cutover-date key exists to make unrepresentable.
    h.record = { ...DRAFT, kind: 'opening_balance', number: 'JNL-0007' }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/cutover date/)
    expect(result._unsafeUnwrapErr().message).toMatch(/ledgerOpening\.post/)
    expect(h.posted).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
  })

  it('refuses an opening_balance draft on PREVIEW too, so the drawer says so before Post', async () => {
    h.record = { ...DRAFT, kind: 'opening_balance', number: 'JNL-0007' }
    const result = await previewJournalEntry(DB, ORG, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/opening trial balance/i)
  })

  it('stamps the posting id and the status once a posting was written', async () => {
    await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(h.updates[0]?.values).toEqual({
      journal_entry_status: 'posted',
      journal_entry_gl_posting_id: 'post_1',
    })
  })

  // 🛑 A refusal leaves the record alone. That is what "fix it and press Post
  // again" needs - a `failed` status would have to be cleared by hand first.
  it('leaves the record untouched on a refusal', async () => {
    h.postResult = { status: 'period_closed', error: 'August is locked' }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('period_closed')
    expect(h.updates).toHaveLength(0)
  })

  // `not_connected` DOES write a posting - `postEntry` marks the row `posted`,
  // because an org with no accounting system has nothing in flight - so the
  // record must follow it.
  it('stamps the record on not_connected, which did write a posting', async () => {
    h.postResult = { status: 'not_connected', glPostingId: 'post_9' }
    await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(h.updates[0]?.values.journal_entry_gl_posting_id).toBe('post_9')
  })

  it('refuses to post an entry that is already posted', async () => {
    h.record = { ...DRAFT, status: 'posted', glPostingId: 'post_1' }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(h.posted).toHaveLength(0)
  })

  it('refuses to post a recurring template, saying what to do instead', async () => {
    h.record = { ...DRAFT, kind: 'recurring_template' }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/stencil/i)
    expect(h.posted).toHaveLength(0)
  })

  // The number IS the posting's periodKey, so an entry without one would mint
  // `AUXX-JNL-` with nothing after it.
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
    h.record = { ...DRAFT, status: 'posted', glPostingId: 'post_1' }
  })

  it('reverses the posting the record names and flips it to reversed', async () => {
    const result = await reverseJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isOk()).toBe(true)
    expect(h.reversed[0]?.glPostingId).toBe('post_1')
    expect(h.updates[0]?.values).toEqual({ journal_entry_status: 'reversed' })
  })

  it('leaves the record posted when the reversal was refused', async () => {
    h.postResult = { status: 'period_closed', error: 'August is locked' }
    await reverseJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(h.updates).toHaveLength(0)
  })

  // A converged re-run, not a failure: the reversal was already there.
  it('flips the record on already_posted', async () => {
    h.postResult = { status: 'already_posted', glPostingId: 'post_2' }
    await reverseJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(h.updates[0]?.values.journal_entry_status).toBe('reversed')
  })

  it('refuses to reverse a draft - a draft is simply edited', async () => {
    h.record = { ...DRAFT }
    const result = await reverseJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(h.reversed).toHaveLength(0)
  })

  it('refuses to reverse twice', async () => {
    h.record = { ...DRAFT, status: 'reversed', glPostingId: 'post_1' }
    const result = await reverseJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isErr()).toBe(true)
    expect(h.reversed).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// discardJournalEntry (plans/accounting/tasks/09-discard-a-draft-entry.md §4)
//
// 🛑 ARCHIVE, never delete. `journal_entry_number` is issued by `RecordSequence`
// on CREATE, so an abandoned `JNL-0006` leaves a permanent hole in a gapless
// sequence - and a bookkeeper who reads `JNL-0005` then `JNL-0007` has to be
// able to find out what happened in between. A hard delete makes that
// unanswerable; `archivedAt` keeps the row and takes it out of every read.
// ─────────────────────────────────────────────────────────────────────────────
describe('discardJournalEntry', () => {
  it('archives the draft rather than deleting it', async () => {
    const result = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isOk()).toBe(true)
    expect(h.archives).toEqual(['def_je:je_1'])
    // Nothing was edited on the way out: no `discarded` status, no cleared
    // fields. The entity layer answers "is this record gone", and a fourth
    // status would have to be handled by every switch that renders one.
    expect(h.updates).toHaveLength(0)
  })

  // `listJournalEntries` and `getJournalEntry` both filter `archivedAt IS NULL`
  // (`reads.ts`), which the double above mirrors - so the discarded entry has
  // left every read path, and asking again says so.
  it('leaves the entry unreadable afterwards, so a second discard is NotFound', async () => {
    expect((await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })).isOk()).toBe(true)

    const second = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(second.isErr()).toBe(true)
    expect(second._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    // Once, not twice.
    expect(h.archives).toHaveLength(1)
  })

  it('refuses a posted entry, naming it and pointing at reversal', async () => {
    h.record = { ...DRAFT, status: 'posted', glPostingId: 'post_1' }
    const result = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.message).toContain('JNL-0007')
    expect(error.message).toMatch(/cannot be discarded/)
    expect(error.message).toMatch(/reversing it/i)
    expect(h.archives).toHaveLength(0)
  })

  it('refuses a reversed entry the same way', async () => {
    h.record = { ...DRAFT, status: 'reversed', glPostingId: 'post_1' }
    const result = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(result._unsafeUnwrapErr().message).toMatch(/reversed and cannot be discarded/)
    expect(h.archives).toHaveLength(0)
  })

  // 🛑 The dangerous row, and the reason the status check alone is not enough.
  // `postJournalEntry` claims the posting FIRST and stamps the record SECOND, so
  // a run that dies in between leaves exactly this: status `draft`, posting id
  // set. Archiving it would orphan a `GlPosting` whose `sourceId` no read path
  // resolves, which A/R aging then carries under "Unapplied and adjustments"
  // forever.
  it('refuses a draft that already carries a posting id', async () => {
    h.record = { ...DRAFT, status: 'draft', glPostingId: 'post_1' }
    const result = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(result._unsafeUnwrapErr().message).toMatch(/already has a posting/)
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
