// packages/lib/src/accounting/journals/entries/__tests__/writes.test.ts
//
// The manual journal as a document (91 D5): the record and its `journal_entry_line`
// children are written by create/update, Post builds the entry from the lines and
// stamps the pointer, Void reverses, a recurring journal posts on materialise, and
// the opening flow finds its journal without a draft posting. Collaborators are
// stubbed at the module boundary; `postEntry` and `reverseEntry` have their own suites.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Rec = Record<string, unknown> & { id: string; lines: Array<Record<string, unknown>> }

const h = vi.hoisted(() => ({
  records: new Map<string, Rec>(),
  nextId: 1,
  postResult: { status: 'posted', glPostingId: 'post_1', docNumber: 'JNL-0007' } as Record<
    string,
    unknown
  >,
  posted: [] as Array<Record<string, unknown>>,
  reversed: [] as Array<Record<string, unknown>>,
  creates: [] as Array<{ defId: string; values: Record<string, unknown> }>,
  lineCreates: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ recordId: string; values: Record<string, unknown> }>,
  lineDeletes: [] as string[],
  deletes: [] as string[],
  editStamp: null as { openedAt: string; byUserId: string } | null,
  cursor: [] as Array<Date>,
  generated: new Map<string, string>(),
}))

/** What `reads.ts` would hydrate: lines from the children, status from the stamped pointer. */
function toLine(values: Record<string, unknown>, id: string): Record<string, unknown> {
  return {
    id,
    glAccountId: values.journal_entry_line_gl_account ?? '',
    direction: values.journal_entry_line_side,
    amountMinor: values.journal_entry_line_amount,
    ...(values.journal_entry_line_memo ? { memo: values.journal_entry_line_memo } : {}),
  }
}

vi.mock('../../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(defId: string, values: Record<string, unknown>) {
      h.creates.push({ defId, values })
      const id = `je_${h.nextId++}`
      h.records.set(id, {
        id,
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
      })
      return { instance: { id } }
    }
    async update(recordId: string, values: Record<string, unknown>) {
      h.updates.push({ recordId, values })
      const [, id] = recordId.split(':')
      const record = h.records.get(id!)
      if (record && typeof values.journal_entry_gl_posting_id === 'string') {
        record.glPostingId = values.journal_entry_gl_posting_id
        record.status = 'posted'
      }
    }
    async bulkCreate(_defId: string, items: Record<string, unknown>[]) {
      for (const values of items) {
        h.lineCreates.push(values)
        const parent = String(values.journal_entry_line_journal_entry).split(':')[1]!
        h.records.get(parent)?.lines.push(toLine(values, `line_${h.nextId++}`))
      }
      return { created: [], errors: [] }
    }
    async bulkDelete(recordIds: string[]) {
      h.lineDeletes.push(...recordIds)
      return { count: recordIds.length, errors: [] }
    }
    async delete(recordId: string) {
      h.deletes.push(recordId)
      h.records.delete(recordId.split(':')[1]!)
    }
  },
}))

vi.mock('../../../ledger/post/post-entry', () => ({
  postEntry: async (_db: unknown, options: Record<string, unknown>) => {
    h.posted.push(options)
    return h.postResult
  },
  previewEntry: async (_db: unknown, options: Record<string, unknown>) => ({
    postingType: (options.entry as { postingType: string }).postingType,
    lines: [],
    totalMinor: 0,
    docNumber: 'JNL-0007',
    periodKey: 'JNL-0007',
    txnDate: '2026-08-31',
  }),
}))

vi.mock('../../../ledger/post/reverse-entry', () => ({
  reverseEntry: async (_db: unknown, options: Record<string, unknown>) => {
    h.reversed.push(options)
    return { status: 'posted', glPostingId: 'post_rev' }
  },
}))

vi.mock('../../../ledger/reads/read-posting', () => ({
  readPostingLineSourceIds: async () => ok([]),
}))

vi.mock('../../../../entity-instances/edit-snapshot', () => ({
  readEditStamp: async () => h.editStamp,
}))

vi.mock('../fields', () => ({
  requireJournalEntryFieldContext: async () => ({ defId: 'def_je', fields: {} }),
  requireJournalEntryLineFieldContext: async () => ({ defId: 'def_line', fields: {} }),
}))

vi.mock('../reads', () => ({
  requireJournalEntry: async (_db: unknown, _org: string, id: string) => {
    const record = h.records.get(id)
    if (!record) throw new NotFoundError('Journal entry not found')
    return structuredClone(record)
  },
  listJournalEntries: async (_db: unknown, _org: string, filters: { kinds?: string[] }) =>
    ok(
      [...h.records.values()]
        .filter((record) => !filters.kinds || filters.kinds.includes(String(record.kind)))
        .reverse()
    ),
  readRecurrenceIdentities: async () => new Map(),
}))

vi.mock('../../../../recurrence', () => ({
  advanceRecurrenceCursor: async (_db: unknown, _org: string, _rule: string, cursor: Date) => {
    h.cursor.push(cursor)
  },
}))

vi.mock('../../recurring/reads', () => ({
  planForRule: () => ({
    due: [{ occurrenceDate: '2026-03-31', start: new Date('2026-03-31T05:00:00Z') }],
    held: null,
    cursor: new Date('2026-04-01T05:00:00Z'),
  }),
  findGeneratedEntryIds: async () => h.generated,
}))

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ get: async () => 'user_system' }),
}))

import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../../../errors'
import { findOpeningTrialBalanceEntry } from '../../../opening/reads'
import { materializeRecurringJournals } from '../../recurring/materialize'
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

/** An unposted manual entry `je_1` with two lines. */
function seedEntry(overrides: Partial<Rec> = {}): Rec {
  const record: Rec = {
    id: 'je_1',
    number: 'JNL-0007',
    date: '2026-08-31',
    memo: 'Accrue August rent',
    status: 'draft',
    kind: 'manual',
    lines: [
      { id: 'line_a', ...BALANCED_LINES[0] },
      { id: 'line_b', ...BALANCED_LINES[1] },
    ],
    glPostingId: null,
    recurrenceRuleId: null,
    occurrenceDate: null,
    createdAt: '2026-08-31T00:00:00.000Z',
    ...overrides,
  }
  h.records.set(record.id, record)
  return record
}

beforeEach(() => {
  h.records = new Map()
  h.nextId = 100
  h.postResult = { status: 'posted', glPostingId: 'post_1', docNumber: 'JNL-0007' }
  h.posted = []
  h.reversed = []
  h.creates = []
  h.lineCreates = []
  h.updates = []
  h.lineDeletes = []
  h.deletes = []
  h.editStamp = null
  h.cursor = []
  h.generated = new Map()
})

describe('createJournalEntry', () => {
  it('writes the record and its lines as children, and touches no ledger', async () => {
    const result = await createJournalEntry(DB, ORG, USER, {
      date: '2026-08-31',
      lines: BALANCED_LINES,
    })

    expect(result.isOk()).toBe(true)
    // Midnight UTC: a local midnight renders a month-end entry as the previous month.
    expect(h.creates[0]?.values.journal_entry_date).toBe('2026-08-31T00:00:00.000Z')
    expect(h.lineCreates).toEqual([
      {
        journal_entry_line_journal_entry: 'def_je:je_100',
        journal_entry_line_gl_account: 'acct_6200',
        journal_entry_line_side: 'debit',
        journal_entry_line_amount: 50_000,
        journal_entry_line_sort_order: 0,
      },
      {
        journal_entry_line_journal_entry: 'def_je:je_100',
        journal_entry_line_gl_account: 'acct_2100',
        journal_entry_line_side: 'credit',
        journal_entry_line_amount: 50_000,
        journal_entry_line_sort_order: 1,
      },
    ])
    expect(result._unsafeUnwrap().status).toBe('draft')
    expect(h.posted).toHaveLength(0)
  })

  it('saves an unbalanced or one-line entry - balance is checked at Post', async () => {
    const result = await createJournalEntry(DB, ORG, USER, {
      date: '2026-08-31',
      lines: [{ glAccountId: 'acct_6200', direction: 'debit', amountMinor: 50_000 }],
    })
    expect(result.isOk()).toBe(true)
  })

  it('writes a counterparty only as a pair, and ignores keys the line does not declare', async () => {
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
        {
          glAccountId: 'acct_2100',
          direction: 'credit',
          amountMinor: 50_000,
          counterpartyType: 'vendor',
        },
      ],
    })
    expect(h.lineCreates[0]).not.toHaveProperty('rowId')
    expect(h.lineCreates[0]?.journal_entry_line_counterparty_type).toBe('customer')
    expect(h.lineCreates[0]?.journal_entry_line_counterparty).toBe('contact_1')
    expect(h.lineCreates[1]).not.toHaveProperty('journal_entry_line_counterparty_type')
  })

  it('refuses a line whose amount is not whole cents', async () => {
    const result = await createJournalEntry(DB, ORG, USER, {
      date: '2026-08-31',
      lines: [{ glAccountId: 'acct_6200', direction: 'debit', amountMinor: 12.5 }],
    })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(h.creates).toHaveLength(0)
  })

  it('refuses a date that is not YYYY-MM-DD', async () => {
    const result = await createJournalEntry(DB, ORG, USER, { date: '31/08/2026' })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })
})

describe('updateJournalEntry', () => {
  it('keeps named lines, creates unnamed ones, deletes the rest', async () => {
    seedEntry()
    await updateJournalEntry(DB, ORG, USER, {
      journalEntryId: 'je_1',
      lines: [
        { id: 'line_a', glAccountId: 'acct_6300', direction: 'debit', amountMinor: 50_000 },
        { glAccountId: 'acct_2100', direction: 'credit', amountMinor: 50_000 },
      ],
    })

    expect(h.updates).toEqual([
      {
        recordId: 'def_line:line_a',
        values: expect.objectContaining({
          journal_entry_line_gl_account: 'acct_6300',
          journal_entry_line_memo: null,
          journal_entry_line_sort_order: 0,
        }),
      },
    ])
    expect(h.lineDeletes).toEqual(['def_line:line_b'])
    expect(h.lineCreates).toEqual([
      expect.objectContaining({
        journal_entry_line_side: 'credit',
        journal_entry_line_sort_order: 1,
      }),
    ])
  })

  it('writes nothing for a line that did not change', async () => {
    seedEntry()
    await updateJournalEntry(DB, ORG, USER, {
      journalEntryId: 'je_1',
      lines: [
        { id: 'line_a', ...BALANCED_LINES[0]! },
        { id: 'line_b', ...BALANCED_LINES[1]! },
      ],
    })
    expect(h.updates).toEqual([])
    expect(h.lineDeletes).toEqual([])
    expect(h.lineCreates).toEqual([])
  })

  it('clears the memo on an empty string and leaves lines alone when omitted', async () => {
    seedEntry()
    await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1', memo: '' })
    expect(h.updates).toEqual([{ recordId: 'def_je:je_1', values: { journal_entry_memo: null } }])
    expect(h.lineDeletes).toEqual([])
  })

  it('refuses a posted entry, naming reversal', async () => {
    seedEntry({ status: 'posted', glPostingId: 'post_1' })
    const result = await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1', memo: 'x' })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(result._unsafeUnwrapErr().message).toMatch(/reversing it/i)
    expect(h.updates).toHaveLength(0)
  })

  it('edits a posted entry while edit-in-place holds it open', async () => {
    seedEntry({ status: 'posted', glPostingId: 'post_1' })
    h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: USER }
    const result = await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1', memo: 'x' })
    expect(result.isOk()).toBe(true)
  })

  it('refuses a reversed entry even with an edit open', async () => {
    seedEntry({ status: 'reversed', glPostingId: 'post_1' })
    h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: USER }
    const result = await updateJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1', memo: 'x' })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
  })
})

describe('previewJournalEntry', () => {
  it('previews overrides without writing', async () => {
    seedEntry()
    const result = await previewJournalEntry(DB, ORG, {
      journalEntryId: 'je_1',
      lines: [
        { glAccountId: 'acct_6300', direction: 'debit', amountMinor: 100 },
        { glAccountId: 'acct_2100', direction: 'credit', amountMinor: 100 },
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(h.updates).toHaveLength(0)
    expect(h.posted).toHaveLength(0)
  })

  it('refuses an unbalanced entry, naming the difference', async () => {
    seedEntry({
      lines: [
        { id: 'a', glAccountId: 'acct_6200', direction: 'debit', amountMinor: 50_000 },
        { id: 'b', glAccountId: 'acct_2100', direction: 'credit', amountMinor: 40_000 },
      ],
    })
    const result = await previewJournalEntry(DB, ORG, { journalEntryId: 'je_1' })
    expect(result._unsafeUnwrapErr().message).toMatch(/off by 10000/)
  })

  it('refuses an opening_balance entry, naming its own route', async () => {
    seedEntry({ kind: 'opening_balance' })
    const result = await previewJournalEntry(DB, ORG, { journalEntryId: 'je_1' })
    expect(result._unsafeUnwrapErr().message).toMatch(/opening trial balance/i)
  })
})

describe('a journal with lines posts at Post and reverses at Void', () => {
  it('builds from the lines, claims the record, and stamps the pointer', async () => {
    seedEntry()
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })

    expect(result._unsafeUnwrap().status).toBe('posted')
    const call = h.posted[0]!
    expect(call).not.toHaveProperty('mode')
    expect(call.sources).toEqual([
      { sourceKind: 'journal_entry', sourceId: 'je_1', linkRole: 'subject' },
    ])
    const entry = call.entry as { periodKey: string; lines: Array<Record<string, unknown>> }
    expect(entry.periodKey).toBe('JNL-0007')
    expect(entry.lines.map((line) => [line.glAccountId, line.direction, line.amount])).toEqual([
      ['acct_6200', 'debit', 50_000],
      ['acct_2100', 'credit', 50_000],
    ])
    expect(h.updates).toEqual([
      { recordId: 'def_je:je_1', values: { journal_entry_gl_posting_id: 'post_1' } },
    ])

    const voided = await reverseJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(voided.isOk()).toBe(true)
    expect(h.reversed[0]?.glPostingId).toBe('post_1')
  })

  it('leaves the record unposted on a ledger refusal', async () => {
    seedEntry()
    h.postResult = { status: 'unbalanced', error: 'The entry does not balance' }
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result._unsafeUnwrap().status).toBe('unbalanced')
    expect(h.updates).toHaveLength(0)
  })

  it('refuses an unbalanced entry before the ledger is asked', async () => {
    seedEntry({ lines: [{ id: 'a', ...BALANCED_LINES[0] }] })
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result._unsafeUnwrapErr().message).toMatch(/at least two lines/)
    expect(h.posted).toHaveLength(0)
  })

  it.each([
    [{ status: 'posted', glPostingId: 'post_1' }, /cannot be posted/],
    [{ kind: 'recurring_template' }, /stencil/i],
    [{ kind: 'opening_balance' }, /ledgerOpening\.post/],
    [{ number: null }, /no number/i],
    [{ date: null }, /no date/i],
  ])('refuses %o', async (overrides, message) => {
    seedEntry(overrides as Partial<Rec>)
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result._unsafeUnwrapErr().message).toMatch(message)
    expect(h.posted).toHaveLength(0)
  })

  it('refuses to reverse an unposted entry', async () => {
    seedEntry()
    const result = await reverseJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(h.reversed).toHaveLength(0)
  })
})

describe('discardJournalEntry', () => {
  it('deletes the record, its lines going with it through the cascade', async () => {
    seedEntry()
    const result = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result.isOk()).toBe(true)
    expect(h.deletes).toEqual(['def_je:je_1'])

    const second = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(second._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('refuses a posted entry, naming reversal', async () => {
    seedEntry({ status: 'posted', glPostingId: 'post_1' })
    const result = await discardJournalEntry(DB, ORG, USER, { journalEntryId: 'je_1' })
    expect(result._unsafeUnwrapErr().message).toMatch(/cannot be discarded/)
    expect(h.deletes).toHaveLength(0)
  })
})

describe('a recurring journal posts on materialise', () => {
  const RULE = {
    id: 'rule_dep',
    organizationId: ORG,
    subjectId: 'tpl_1',
  } as never

  beforeEach(() => {
    seedEntry({
      id: 'tpl_1',
      kind: 'recurring_template',
      memo: 'Monthly depreciation',
      lines: [
        { id: 'tl_1', glAccountId: 'acct_6600', direction: 'debit', amountMinor: 25_000 },
        { id: 'tl_2', glAccountId: 'acct_1590', direction: 'credit', amountMinor: 25_000 },
      ],
    })
  })

  it('creates the occurrence from the template lines and posts it under the rule occurrence', async () => {
    h.postResult = { status: 'posted', glPostingId: 'post_rje', docNumber: 'RJE-ABC123' }
    const result = await materializeRecurringJournals(DB, RULE)
    const outcome = result._unsafeUnwrap()

    expect(outcome.generated).toHaveLength(1)
    expect(outcome.posted).toEqual(outcome.generated)
    expect(h.lineCreates.map((line) => line.journal_entry_line_gl_account)).toEqual([
      'acct_6600',
      'acct_1590',
    ])
    expect(h.posted[0]?.sources).toEqual([
      {
        sourceKind: 'recurring_journal',
        sourceId: 'rule_dep',
        occurrence: '2026-03-31',
        linkRole: 'subject',
      },
    ])
    expect((h.posted[0]?.entry as { periodKey: string }).periodKey).toMatch(/^RJE-/)
    expect(h.records.get(outcome.generated[0]!)?.status).toBe('posted')
    expect(h.cursor.at(-1)).toEqual(new Date('2026-04-01T05:00:00Z'))
  })

  it('posts an occurrence an earlier pass raised but did not post, rather than raising another', async () => {
    seedEntry({
      id: 'je_left',
      kind: 'recurring',
      recurrenceRuleId: 'rule_dep',
      occurrenceDate: '2026-03-31',
      date: '2026-03-31',
    })
    h.generated = new Map([['2026-03-31', 'je_left']])
    const outcome = (await materializeRecurringJournals(DB, RULE))._unsafeUnwrap()

    expect(outcome.generated).toEqual([])
    expect(outcome.posted).toEqual(['je_left'])
    expect(h.creates).toHaveLength(0)
  })

  it('counts a posted occurrence as present', async () => {
    seedEntry({
      id: 'je_done',
      kind: 'recurring',
      status: 'posted',
      glPostingId: 'post_done',
      recurrenceRuleId: 'rule_dep',
      occurrenceDate: '2026-03-31',
    })
    h.generated = new Map([['2026-03-31', 'je_done']])
    const outcome = (await materializeRecurringJournals(DB, RULE))._unsafeUnwrap()
    expect(outcome.alreadyPresent).toBe(1)
    expect(h.posted).toHaveLength(0)
  })

  it('holds the cursor on an occurrence the ledger refused', async () => {
    h.postResult = { status: 'account_invalid', error: 'acct_1590 is archived' }
    const outcome = (await materializeRecurringJournals(DB, RULE))._unsafeUnwrap()
    expect(outcome.posted).toEqual([])
    expect(outcome.cursor).toEqual(new Date('2026-03-31T05:00:00Z'))
  })
})

describe('the opening flow finds its journal without a draft status', () => {
  it('opens the unposted opening record over a posted one', async () => {
    seedEntry({ id: 'je_old', kind: 'opening_balance', status: 'reversed', glPostingId: 'p_old' })
    seedEntry({ id: 'je_new', kind: 'opening_balance' })
    expect((await findOpeningTrialBalanceEntry(DB, ORG))?.id).toBe('je_new')
  })

  it('falls back to the newest when every opening record is posted', async () => {
    seedEntry({ id: 'je_posted', kind: 'opening_balance', status: 'posted', glPostingId: 'p_1' })
    seedEntry({ id: 'je_manual' })
    expect((await findOpeningTrialBalanceEntry(DB, ORG))?.id).toBe('je_posted')
  })
})
