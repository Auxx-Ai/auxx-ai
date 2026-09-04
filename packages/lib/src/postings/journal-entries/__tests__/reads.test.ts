// packages/lib/src/postings/journal-entries/__tests__/reads.test.ts
//
// `parseLines` is the seam between a jsonb column and arithmetic that decides
// what a journal entry says, so its contract is worth stating on its own.
//
// 🛑 It is TOLERANT on read and `writes.ts` is STRICT on write, deliberately.
// A malformed row here means the JSON was written by something else or by an
// older shape, and the honest response is to render what IS readable rather
// than to throw and make the entry unopenable. `buildManualEntry` refuses the
// entry a second time before it can post, so a dropped line cannot become a
// silently unbalanced posting - it becomes a visible imbalance the person can
// see and fix.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({ getCachedEntityDefId: vi.fn(), getOrgCache: vi.fn() }))

import { getCachedEntityDefId, getOrgCache } from '../../../cache'
import { listJournalEntries, parseLines } from '../reads'

describe('parseLines', () => {
  it('reads a well-formed line array back verbatim', () => {
    expect(
      parseLines([
        { accountCode: '6200', direction: 'debit', amountMinor: 50_000, memo: 'Rent' },
        { accountCode: '2100', direction: 'credit', amountMinor: 50_000 },
      ])
    ).toEqual([
      { accountCode: '6200', direction: 'debit', amountMinor: 50_000, memo: 'Rent' },
      { accountCode: '2100', direction: 'credit', amountMinor: 50_000 },
    ])
  })

  // A field that has never been written has no `FieldValue` row at all, and an
  // org short of migration 125 has no field either. Both must read as "no
  // lines", never as `undefined` in a money column.
  it('reads an absent or non-array value as no lines', () => {
    expect(parseLines(undefined)).toEqual([])
    expect(parseLines(null)).toEqual([])
    expect(parseLines({})).toEqual([])
    expect(parseLines('[]')).toEqual([])
  })

  it('drops a row with no account code', () => {
    expect(parseLines([{ direction: 'debit', amountMinor: 1 }])).toEqual([])
  })

  it('drops a row whose direction is not one of the two sides', () => {
    expect(parseLines([{ accountCode: '6200', direction: 'left', amountMinor: 1 }])).toEqual([])
  })

  it('drops a row with a non-numeric amount', () => {
    expect(parseLines([{ accountCode: '6200', direction: 'debit', amountMinor: '50' }])).toEqual([])
  })

  it('keeps the readable rows and drops only the broken ones', () => {
    const lines = parseLines([
      { accountCode: '6200', direction: 'debit', amountMinor: 50_000 },
      { accountCode: '2100', direction: 'sideways', amountMinor: 50_000 },
      null,
      { accountCode: '2100', direction: 'credit', amountMinor: 50_000 },
    ])
    expect(lines.map((line) => line.accountCode)).toEqual(['6200', '2100'])
  })

  // 🛑 A zero amount survives the READ and is refused by `buildManualEntry` at
  // post time, naming the row. Dropping it here would make the entry silently
  // shorter than the person typed, and the imbalance would name the wrong side.
  it('keeps a zero amount so the builder can refuse it by row number', () => {
    expect(parseLines([{ accountCode: '6200', direction: 'debit', amountMinor: 0 }])).toEqual([
      { accountCode: '6200', direction: 'debit', amountMinor: 0 },
    ])
  })

  it('omits an empty memo rather than storing a blank string', () => {
    const [line] = parseLines([
      { accountCode: '6200', direction: 'debit', amountMinor: 1, memo: '' },
    ])
    expect(line).not.toHaveProperty('memo')
  })
})

// 🛑 The column holds `{ v, lines }`, not the bare array - a `FieldValue` write
// reads a top-level array as a MULTI-VALUE write, one row per element, and
// `journal_entry_lines` is single-value. Handing it `[a, b]` fails with
// "single-value; received 2 values", which `UnifiedCrudHandler.setFieldValues`
// logs and swallows, leaving the update reporting success over an entry with no
// lines. Found by driving the path against a real org.
describe('parseLines - the stored envelope', () => {
  it('unwraps the { lines } object the column holds', () => {
    expect(
      parseLines({ lines: [{ accountCode: '6200', direction: 'debit', amountMinor: 50_000 }] })
    ).toEqual([{ accountCode: '6200', direction: 'debit', amountMinor: 50_000 }])
  })

  // The field-value layer wraps every stored JSON in its own `{ v, meta }`
  // envelope, so what comes off the column is `{ v: { lines: [...] } }`.
  it('unwraps the field-value layer envelope as well as ours', () => {
    expect(
      parseLines({
        v: { lines: [{ accountCode: '6200', direction: 'debit', amountMinor: 50_000 }] },
        meta: {},
      })
    ).toEqual([{ accountCode: '6200', direction: 'debit', amountMinor: 50_000 }])
  })

  it('still reads a bare array, for a hand-written or older row', () => {
    expect(parseLines([{ accountCode: '6200', direction: 'debit', amountMinor: 1 }])).toHaveLength(
      1
    )
  })

  it('reads an envelope whose lines key is not an array as no lines', () => {
    expect(parseLines({ lines: 'nope' })).toEqual([])
    expect(parseLines({ v: { lines: 'nope' } })).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The `status` filter, and the one status that is absent-by-default
//
// 🛑 `toRecord` reads a MISSING `journal_entry_status` row as `'draft'`: the
// field carries `defaultValue: 'draft'`, and a row written before the field
// existed has no `FieldValue` at all. So an INNER join on `optionId = 'draft'`
// answered a strictly smaller set than the reader calls drafts - the list hid
// entries the drawer would happily open. The filter has to agree with the read.
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
    journal_entry_status: { id: 'f_status' },
    journal_entry_kind: { id: 'f_kind' },
    journal_entry_lines: { id: 'f_lines' },
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

  it('LEFT joins for draft, so an entry with no status row is still a draft', async () => {
    const { db, joins } = joinSpyDb()
    await listJournalEntries(db, 'org_1', { status: 'draft' })
    expect(joins).toEqual(['left'])
  })

  it('INNER joins for every other status, which cannot be absent-by-default', async () => {
    for (const status of ['posted', 'reversed'] as const) {
      const { db, joins } = joinSpyDb()
      await listJournalEntries(db, 'org_1', { status })
      expect(joins).toEqual(['inner'])
    }
  })

  it('joins nothing at all when no status is asked for', async () => {
    const { db, joins } = joinSpyDb()
    await listJournalEntries(db, 'org_1', {})
    expect(joins).toEqual([])
  })
})
