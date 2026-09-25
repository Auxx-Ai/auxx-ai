// packages/lib/src/accounting/journals/recurring/__tests__/recurring-journal-idempotency.test.ts

/**
 * 🛑 **This is the test that stands between a working scheduler and a doubled
 * ledger** (task 21 §9).
 *
 * A generated entry posts under the rule's occurrence (`recurring_journal`, the
 * rule id, the slot) with the deterministic `RJE-<fold>` period key. What is
 * pinned here is what happens ON TOP of that: `already_posted` is BELIEVED only
 * after checking that the posting holding the claim fills the same SLOT
 * (`findRecurringKeyCollision`), and the check is by SLOT and not by record id,
 * so two records raised for one occurrence converge rather than collide.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  record: null as Record<string, unknown> | null,
  postResult: { status: 'posted', glPostingId: 'post_1' } as Record<string, unknown>,
  /** Every `postEntry` call, in order. */
  posted: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ recordId: string; values: Record<string, unknown> }>,
  creates: [] as Array<{ defId: string; values: Record<string, unknown> }>,
  /** What the winning posting's journal-entry lines name. */
  winningSourceIds: [] as string[],
  /** Those records' recurrence identities. */
  identities: new Map<string, { recurrenceRuleId: string; occurrenceDate: string }>(),
}))

vi.mock('../../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(defId: string, values: Record<string, unknown>) {
      h.creates.push({ defId, values })
      return { instance: { id: 'je_generated' } }
    }
    async update(recordId: string, values: Record<string, unknown>) {
      h.updates.push({ recordId, values })
    }
    async bulkCreate() {
      return { created: [], errors: [] }
    }
  },
}))

vi.mock('../../../ledger/post/post-entry', () => ({
  postEntry: async (_db: unknown, options: Record<string, unknown>) => {
    h.posted.push(options)
    return h.postResult
  },
  previewEntry: async () => ({}),
}))

vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: async () => h.postResult }))

vi.mock('../../../ledger/reads/read-posting', () => ({
  readPostingLineSourceIds: async () => okResult(h.winningSourceIds),
}))

vi.mock('../../../../entity-instances/edit-snapshot', () => ({ readEditStamp: async () => null }))

vi.mock('../../entries/fields', () => ({
  requireJournalEntryFieldContext: async () => ({ defId: 'def_je', fields: {} }),
  requireJournalEntryLineFieldContext: async () => ({ defId: 'def_line', fields: {} }),
}))

vi.mock('../../entries/reads', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../entries/reads')
  return {
    ...actual,
    requireJournalEntry: async () => {
      if (!h.record) throw new Error('Journal entry not found')
      return h.record
    },
    readRecurrenceIdentities: async (_db: unknown, _org: string, ids: string[]) =>
      new Map([...h.identities].filter(([id]) => ids.includes(id))),
  }
})

import { ok as okResult } from 'neverthrow'
import type { JournalEntryRecord } from '../../entries/client'
import { createJournalEntry, postJournalEntry } from '../../entries/writes'
import { recurringJournalPeriodKey, recurringJournalSourceId } from '../client'

const ORG = 'org_1'
const USER = 'user_1'
const DB = {} as never

const RULE_ID = 'rule_depreciation'
const MARCH = '2026-03-31'

/** An unposted entry the sweep generated for March, as `reads.ts` would return it. */
function generatedEntry(overrides: Partial<JournalEntryRecord> = {}): Record<string, unknown> {
  return {
    id: 'je_march_a',
    number: 'JNL-0042',
    date: MARCH,
    memo: 'Monthly depreciation',
    status: 'draft',
    kind: 'recurring',
    lines: [
      { id: 'l1', glAccountId: 'acct_6600', direction: 'debit', amountMinor: 25_000 },
      { id: 'l2', glAccountId: 'acct_1590', direction: 'credit', amountMinor: 25_000 },
    ],
    glPostingId: null,
    recurrenceRuleId: RULE_ID,
    occurrenceDate: MARCH,
    createdAt: '2026-03-31T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  h.record = generatedEntry()
  h.postResult = { status: 'posted', glPostingId: 'post_1' }
  h.posted = []
  h.updates = []
  h.creates = []
  h.winningSourceIds = []
  h.identities = new Map()
})

describe('the keyspace', () => {
  it('folds the rule and the slot together, not either alone', () => {
    const march = recurringJournalPeriodKey({ recurrenceRuleId: RULE_ID, occurrenceDate: MARCH })
    const april = recurringJournalPeriodKey({
      recurrenceRuleId: RULE_ID,
      occurrenceDate: '2026-04-30',
    })
    const otherRule = recurringJournalPeriodKey({
      recurrenceRuleId: 'rule_rent_accrual',
      occurrenceDate: MARCH,
    })

    expect(march).not.toEqual(april)
    // Depreciation beside an accrual reversal on the same month-end is the ordinary case.
    expect(march).not.toEqual(otherRule)
  })

  it('is deterministic, which is what makes a re-post converge', () => {
    const a = recurringJournalPeriodKey({ recurrenceRuleId: RULE_ID, occurrenceDate: MARCH })
    const b = recurringJournalPeriodKey({ recurrenceRuleId: RULE_ID, occurrenceDate: MARCH })
    expect(a).toEqual(b)
    expect(recurringJournalSourceId({ recurrenceRuleId: RULE_ID, occurrenceDate: MARCH })).toBe(
      `${RULE_ID}:${MARCH}`
    )
  })

  it("posts under the rule's occurrence, keyed on the fold", async () => {
    await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    expect(h.posted[0]?.sources).toEqual([
      {
        sourceKind: 'recurring_journal',
        sourceId: RULE_ID,
        occurrence: MARCH,
        linkRole: 'subject',
      },
    ])
    expect((h.posted[0]?.entry as { periodKey: string }).periodKey).toBe(
      recurringJournalPeriodKey({ recurrenceRuleId: RULE_ID, occurrenceDate: MARCH })
    )
  })
})

describe('two records raised for one occurrence converge', () => {
  it('believes already_posted when the winner is this record', async () => {
    h.postResult = { status: 'already_posted', glPostingId: 'post_march_a' }
    h.winningSourceIds = ['je_march_a']
    h.identities = new Map([['je_march_a', { recurrenceRuleId: RULE_ID, occurrenceDate: MARCH }]])

    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })

    expect(result._unsafeUnwrap().status).toBe('already_posted')
    expect(h.updates).toEqual([
      { recordId: 'def_je:je_march_a', values: { journal_entry_gl_posting_id: 'post_march_a' } },
    ])
  })

  it('believes already_posted when the winner is a different record for the same slot', async () => {
    h.postResult = { status: 'already_posted', glPostingId: 'post_march_b' }
    h.winningSourceIds = ['je_march_b']
    h.identities = new Map([['je_march_b', { recurrenceRuleId: RULE_ID, occurrenceDate: MARCH }]])

    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })

    expect(result._unsafeUnwrap().status).toBe('already_posted')
    // The slot is in the books; this record points at the posting that holds it.
    expect(h.updates[0]?.values).toEqual({ journal_entry_gl_posting_id: 'post_march_b' })
  })
})

describe('the sourceId check catches a hash collision rather than trusting already_posted', () => {
  beforeEach(() => {
    h.postResult = {
      status: 'already_posted',
      glPostingId: 'post_other',
      docNumber: 'RJE-ZZZZZZ',
    }
  })

  it('refuses when the winning posting belongs to a different occurrence, and stamps nothing', async () => {
    h.winningSourceIds = ['je_april']
    h.identities = new Map([
      ['je_april', { recurrenceRuleId: RULE_ID, occurrenceDate: '2026-04-30' }],
    ])

    const value = (
      await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    )._unsafeUnwrap()
    expect(value.status).toBe('error')
    expect(value.failureClass).toBe('data')
    expect(value.retryable).toBe(false)
    expect(value.error).toContain('collision')
    expect(h.updates).toEqual([])
  })

  it('refuses when the winning posting belongs to a different RULE on the same date', async () => {
    h.winningSourceIds = ['je_rent']
    h.identities = new Map([
      ['je_rent', { recurrenceRuleId: 'rule_rent_accrual', occurrenceDate: MARCH }],
    ])
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    expect(result._unsafeUnwrap().status).toBe('error')
  })

  it('refuses when the winner is a hand-authored entry with no identity at all', async () => {
    h.winningSourceIds = ['je_manual']
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    expect(result._unsafeUnwrap().status).toBe('error')
  })

  it('leaves an ordinary posted status alone', async () => {
    h.postResult = { status: 'posted', glPostingId: 'post_1' }
    h.winningSourceIds = ['je_april']
    h.identities = new Map([
      ['je_april', { recurrenceRuleId: RULE_ID, occurrenceDate: '2026-04-30' }],
    ])
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    expect(result._unsafeUnwrap().status).toBe('posted')
  })

  it('does not run the check on a hand-authored entry', async () => {
    h.record = generatedEntry({ kind: 'manual', recurrenceRuleId: null, occurrenceDate: null })
    h.winningSourceIds = ['je_someone_else']
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    // A manual entry keys on its own number, so `already_posted` is a re-post of this record.
    expect(result._unsafeUnwrap().status).toBe('already_posted')
  })
})

describe('a generated entry has to name both halves of its identity', () => {
  it('refuses to post one carrying only the rule', async () => {
    h.record = generatedEntry({ occurrenceDate: null })
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    expect(result._unsafeUnwrapErr().message).toContain('rule and the occurrence')
    expect(h.posted).toHaveLength(0)
  })

  it('refuses to create one carrying only the slot', async () => {
    const result = await createJournalEntry(DB, ORG, USER, {
      kind: 'recurring',
      date: MARCH,
      occurrenceDate: MARCH,
    })
    expect(result.isErr()).toBe(true)
  })

  it('refuses to create a manual entry carrying a rule', async () => {
    const result = await createJournalEntry(DB, ORG, USER, {
      kind: 'manual',
      date: MARCH,
      recurrenceRuleId: RULE_ID,
      occurrenceDate: MARCH,
    })
    expect(result._unsafeUnwrapErr().message).toContain('may not carry a recurrence rule')
  })

  it('still refuses to post the TEMPLATE itself', async () => {
    h.record = generatedEntry({
      kind: 'recurring_template',
      recurrenceRuleId: null,
      occurrenceDate: null,
    })
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    expect(result._unsafeUnwrapErr().message).toContain('stencil')
  })
})
