// packages/lib/src/postings/recurring-journals/__tests__/recurring-journal-idempotency.test.ts

/**
 * 🛑 **This is the test that stands between a working scheduler and a doubled
 * ledger** (task 21 §9).
 *
 * `postJournalEntry` no longer rebuilds the entry at post time - `postDraft`
 * posts the lines already resolved onto the draft's own `GlPosting`, which
 * `createJournalEntry` wrote with the deterministic `RJE-<fold>` period key
 * (`recurringJournalPeriodKey`). What is pinned here is what happens ON TOP of
 * that: `already_posted` is BELIEVED only after checking that the posting
 * holding the claim fills the same SLOT (`findRecurringKeyCollision`), and the
 * check is by SLOT and not by record id, so the ordinary duplicate-draft race
 * - two records, one occurrence - is NOT reported as a collision.
 *
 * The collaborators are stubbed at the module boundary rather than through a
 * fake database, for the reason `journal-entries/__tests__/writes.test.ts`
 * gives: `postDraft` has its own exhaustive suite and re-driving it through a
 * second fake here would test the fake.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  record: null as Record<string, unknown> | null,
  postResult: { status: 'posted', glPostingId: 'post_1' } as Record<string, unknown>,
  /** Every `postDraft` call, in order. */
  posted: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ recordId: string; values: Record<string, unknown> }>,
  creates: [] as Array<{ defId: string; values: Record<string, unknown> }>,
  /** What the winning posting's journal-entry lines name. */
  winningSourceIds: [] as string[],
  /** Those records' recurrence identities. */
  identities: new Map<string, { recurrenceRuleId: string; occurrenceDate: string }>(),
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(defId: string, values: Record<string, unknown>) {
      h.creates.push({ defId, values })
      return { instance: { id: 'je_generated' } }
    }
    async update(recordId: string, values: Record<string, unknown>) {
      h.updates.push({ recordId, values })
    }
    async archive() {}
  },
}))

vi.mock('../../post-entry', () => ({
  postEntry: async () => ({ status: 'drafted', glPostingId: 'draft_generated' }),
  postDraft: async (_db: unknown, options: Record<string, unknown>) => {
    h.posted.push(options)
    return h.postResult
  },
  previewEntry: async () => ({}),
}))

vi.mock('../../reverse-entry', () => ({ reverseEntry: async () => h.postResult }))

vi.mock('../../draft-lines', () => ({
  updateDraftLines: async () => ({ isErr: () => false }),
  discardDraftPosting: async () => ({ isErr: () => false }),
}))

vi.mock('../../period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))

vi.mock('../../read-posting', () => ({
  readPostingLineSourceIds: async () => okResult(h.winningSourceIds),
}))

vi.mock('../../journal-entries/reads', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../journal-entries/reads')
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
        journal_entry_recurrence_rule_id: { id: 'f_rule' },
        journal_entry_occurrence_date: { id: 'f_slot' },
      },
    }),
    requireJournalEntry: async () => {
      if (!h.record) throw new Error('Journal entry not found')
      return h.record
    },
    readRecurrenceIdentities: async (_db: unknown, _org: string, ids: string[]) =>
      new Map([...h.identities].filter(([id]) => ids.includes(id))),
  }
})

import { ok as okResult } from 'neverthrow'
import type { JournalEntryRecord } from '../../journal-entries/client'
import { createJournalEntry, postJournalEntry } from '../../journal-entries/writes'
import { recurringJournalPeriodKey, recurringJournalSourceId } from '../client'

const ORG = 'org_1'
const USER = 'user_1'
const DB = {} as never

const RULE_ID = 'rule_depreciation'
const MARCH = '2026-03-31'

/** A draft the sweep generated for March, as `reads.ts` would return it. */
function generatedDraft(overrides: Partial<JournalEntryRecord> = {}): Record<string, unknown> {
  return {
    id: 'je_march_a',
    number: 'JNL-0042',
    date: MARCH,
    memo: 'Monthly depreciation',
    status: 'draft',
    kind: 'recurring',
    lines: [
      { glAccountId: 'acct_6600', direction: 'debit', amountMinor: 25_000 },
      { glAccountId: 'acct_1590', direction: 'credit', amountMinor: 25_000 },
    ],
    // A generated draft always carries its companion posting from the moment
    // `createJournalEntry` raised it (TARGET §1) - there is no longer a
    // `glPostingId: null` state for a record this far along.
    glPostingId: 'post_march_a',
    recurrenceRuleId: RULE_ID,
    occurrenceDate: MARCH,
    createdAt: '2026-03-31T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  h.record = generatedDraft()
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
    // Two templates that both fire on the last day of the month is the
    // ordinary case - depreciation beside an accrual reversal - so keying on
    // the date alone would merge them.
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
})

describe('a race on the SAME draft converges without a stamp update', () => {
  it('does NOT report a collision when the winner fills the same slot', async () => {
    // The narrow race `postDraft`'s claim can actually produce now: two
    // concurrent `postJournalEntry` calls on the SAME record/glPostingId. The
    // loser's `already_posted` names its own posting, whose journal-entry
    // line names this same record - trivially the same slot.
    h.postResult = { status: 'already_posted', glPostingId: 'post_march_a' }
    h.winningSourceIds = ['je_march_a']
    h.identities = new Map([['je_march_a', { recurrenceRuleId: RULE_ID, occurrenceDate: MARCH }]])

    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('already_posted')
    // Converged: nothing on the record needs stamping any more, since its
    // status is read back off the posting rather than written here.
    expect(h.updates).toEqual([])
  })
})

describe('the sourceId check catches a hash collision rather than trusting already_posted', () => {
  beforeEach(() => {
    h.postResult = {
      status: 'already_posted',
      glPostingId: 'post_other',
      docNumber: 'AUXX-RJE-RJEZZZZZZ',
    }
  })

  it('refuses when the winning posting belongs to a different occurrence', async () => {
    h.winningSourceIds = ['je_april']
    h.identities = new Map([
      ['je_april', { recurrenceRuleId: RULE_ID, occurrenceDate: '2026-04-30' }],
    ])

    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.status).toBe('error')
    expect(value.failureClass).toBe('data')
    expect(value.retryable).toBe(false)
    expect(value.error).toContain('collision')
  })

  it('refuses when the winning posting belongs to a different RULE on the same date', async () => {
    h.winningSourceIds = ['je_rent']
    h.identities = new Map([
      ['je_rent', { recurrenceRuleId: 'rule_rent_accrual', occurrenceDate: MARCH }],
    ])

    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    expect(result._unsafeUnwrap().status).toBe('error')
  })

  it('leaves the record a DRAFT on a collision - nothing was written for it', async () => {
    h.winningSourceIds = ['je_april']
    h.identities = new Map([
      ['je_april', { recurrenceRuleId: RULE_ID, occurrenceDate: '2026-04-30' }],
    ])

    await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })

    // 🛑 The whole point of running the check BEFORE trusting the result: the
    // record's status is read off the posting, so nothing here needs undoing -
    // but the collision itself must still be reported rather than swallowed.
    expect(h.updates).toEqual([])
  })

  it('refuses when the winner is a hand-authored entry with no identity at all', async () => {
    h.winningSourceIds = ['je_manual']
    h.identities = new Map()

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
    h.record = {
      ...generatedDraft(),
      kind: 'manual',
      recurrenceRuleId: null,
      occurrenceDate: null,
    }
    h.winningSourceIds = ['je_someone_else']
    h.identities = new Map()

    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    // A manual entry keys on its own number, so `already_posted` there really
    // is a re-post of the same record and there is nothing to disambiguate.
    expect(result._unsafeUnwrap().status).toBe('already_posted')
  })
})

describe('a generated entry has to name both halves of its identity', () => {
  it('refuses to post one carrying only the rule', async () => {
    h.record = generatedDraft({ occurrenceDate: null })
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('rule and the occurrence')
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
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('may not carry a recurrence rule')
  })

  it('still refuses to post the TEMPLATE itself', async () => {
    h.record = generatedDraft({
      kind: 'recurring_template',
      recurrenceRuleId: null,
      occurrenceDate: null,
    })
    const result = await postJournalEntry(DB, ORG, USER, { journalEntryId: 'je_march_a' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('stencil')
  })
})
