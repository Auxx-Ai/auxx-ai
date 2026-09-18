// packages/lib/src/postings/journal-entries/__tests__/reads.test.ts
//
// `linesFromBuilt` is the seam between a posting's jsonb `built` envelope and
// arithmetic that decides what a journal entry says, so its contract is worth
// stating on its own.
//
// 🛑 It is TOLERANT on read - a malformed row means the JSON was written by
// something else or by an older shape, and the honest response is to render
// what IS readable rather than to throw and make the entry unopenable.
// `buildManualEntry` refuses the entry a second time before it can post, so a
// dropped line cannot become a silently unbalanced posting - it becomes a
// visible imbalance the person can see and fix.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({ getCachedEntityDefId: vi.fn(), getOrgCache: vi.fn() }))

import { getCachedEntityDefId, getOrgCache } from '../../../cache'
import { linesFromBuilt, listJournalEntries } from '../reads'

/** A `GlPosting.built` envelope carrying only what `linesFromBuilt` reads. */
function built(resolvedLines: unknown): unknown {
  return { v: 1, resolvedLines }
}

describe('linesFromBuilt', () => {
  it('reads well-formed resolved lines back as journal-entry lines', () => {
    expect(
      linesFromBuilt(
        built([
          { glAccountId: 'acct_6200', direction: 'debit', amount: 50_000, memo: 'Rent' },
          { glAccountId: 'acct_2100', direction: 'credit', amount: 50_000 },
        ])
      )
    ).toEqual([
      { glAccountId: 'acct_6200', direction: 'debit', amountMinor: 50_000, memo: 'Rent' },
      { glAccountId: 'acct_2100', direction: 'credit', amountMinor: 50_000 },
    ])
  })

  it('reads an absent, non-object, or shapeless value as no lines', () => {
    expect(linesFromBuilt(undefined)).toEqual([])
    expect(linesFromBuilt(null)).toEqual([])
    expect(linesFromBuilt({})).toEqual([])
    expect(linesFromBuilt(built('nope'))).toEqual([])
  })

  it('drops a row with no account id', () => {
    expect(linesFromBuilt(built([{ direction: 'debit', amount: 1 }]))).toEqual([])
  })

  it('drops a row whose direction is not one of the two sides', () => {
    expect(
      linesFromBuilt(built([{ glAccountId: 'acct_6200', direction: 'left', amount: 1 }]))
    ).toEqual([])
  })

  it('drops a row with a non-numeric amount', () => {
    expect(
      linesFromBuilt(built([{ glAccountId: 'acct_6200', direction: 'debit', amount: '50' }]))
    ).toEqual([])
  })

  it('keeps the readable rows and drops only the broken ones', () => {
    const lines = linesFromBuilt(
      built([
        { glAccountId: 'acct_6200', direction: 'debit', amount: 50_000 },
        { glAccountId: 'acct_2100', direction: 'sideways', amount: 50_000 },
        null,
        { glAccountId: 'acct_2100', direction: 'credit', amount: 50_000 },
      ])
    )
    expect(lines.map((line) => line.glAccountId)).toEqual(['acct_6200', 'acct_2100'])
  })

  it('keeps a zero amount so the builder can refuse it by row number', () => {
    expect(
      linesFromBuilt(built([{ glAccountId: 'acct_6200', direction: 'debit', amount: 0 }]))
    ).toEqual([{ glAccountId: 'acct_6200', direction: 'debit', amountMinor: 0 }])
  })

  it('omits an empty memo rather than storing a blank string', () => {
    const [line] = linesFromBuilt(
      built([{ glAccountId: 'acct_6200', direction: 'debit', amount: 1, memo: '' }])
    )
    expect(line).not.toHaveProperty('memo')
  })

  // Brief 13 §1.4: a manual line coded to a receivable or payable account may
  // carry an optional counterparty. Well-formed means BOTH fields present.
  it('reads a well-formed counterparty back verbatim', () => {
    expect(
      linesFromBuilt(
        built([
          {
            glAccountId: 'acct_1100',
            direction: 'debit',
            amount: 5_000,
            counterpartyType: 'customer',
            counterpartyId: 'contact_1',
          },
        ])
      )
    ).toEqual([
      {
        glAccountId: 'acct_1100',
        direction: 'debit',
        amountMinor: 5_000,
        counterpartyType: 'customer',
        counterpartyId: 'contact_1',
      },
    ])
  })

  it('drops both counterparty fields when the type is not customer or vendor', () => {
    const [line] = linesFromBuilt(
      built([
        {
          glAccountId: 'acct_1100',
          direction: 'debit',
          amount: 5_000,
          counterpartyType: 'employee',
          counterpartyId: 'contact_1',
        },
      ])
    )
    expect(line).not.toHaveProperty('counterpartyType')
    expect(line).not.toHaveProperty('counterpartyId')
  })

  it('drops a lone counterpartyType with no id', () => {
    const [line] = linesFromBuilt(
      built([
        {
          glAccountId: 'acct_1100',
          direction: 'debit',
          amount: 5_000,
          counterpartyType: 'customer',
        },
      ])
    )
    expect(line).not.toHaveProperty('counterpartyType')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The `status` filter
//
// 🛑 Every journal entry carries its companion posting from the moment
// `createJournalEntry` raises it (TARGET §1), so the filter is a plain INNER
// join through `journal_entry_gl_posting_id` to `GlPosting.status` - there is
// no more default-value fallback to branch on, unlike `kind` below it.
// ─────────────────────────────────────────────────────────────────────────────

/** Records which join the query builder was asked for, then returns no rows. */
function joinSpyDb() {
  const joins: string[] = []
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    innerJoin: () => {
      joins.push('inner')
      return chain
    },
    leftJoin: () => {
      joins.push('left')
      return chain
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: async () => [],
  })
  const db = {
    select: () => ({ from: () => ({ $dynamic: () => chain }) }),
  } as unknown as Database
  return { db, joins }
}

const FIELD_CONTEXT = {
  journalEntryDefId: 'def_je',
  fields: {
    journal_entry_number: { id: 'f_number' },
    journal_entry_date: { id: 'f_date' },
    journal_entry_memo: { id: 'f_memo' },
    journal_entry_kind: { id: 'f_kind' },
    journal_entry_gl_posting_id: { id: 'f_posting' },
  },
}

describe('listJournalEntries status filter', () => {
  beforeEach(() => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue('def_je')
    vi.mocked(getOrgCache).mockReturnValue({
      from: () => ({ bySystemAttributes: async () => FIELD_CONTEXT.fields }),
    } as unknown as ReturnType<typeof getOrgCache>)
  })

  it('INNER joins through the posting pointer for every status', async () => {
    for (const status of ['draft', 'posted', 'reversed'] as const) {
      const { db, joins } = joinSpyDb()
      await listJournalEntries(db, 'org_1', { status })
      expect(joins).toEqual(['inner', 'inner'])
    }
  })

  it('joins nothing at all when no status is asked for', async () => {
    const { db, joins } = joinSpyDb()
    await listJournalEntries(db, 'org_1', {})
    expect(joins).toEqual([])
  })
})
