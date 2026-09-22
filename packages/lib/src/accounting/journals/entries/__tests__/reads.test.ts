// packages/lib/src/accounting/journals/entries/__tests__/reads.test.ts
//
// Lines are `journal_entry_line` children (91 D5), read tolerantly: a row missing
// its account or amount still renders, and `buildManualEntry` refuses it by row
// number at Post. The status filter reads `draft` as "no live posting".

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ lineRows: [] as Array<Record<string, unknown>> }))

vi.mock('../../../../cache', () => ({ getCachedEntityDefId: vi.fn(), getOrgCache: vi.fn() }))
vi.mock('../../../../resources/system-records', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../resources/system-records')>()),
  readSystemRecords: vi.fn(async () =>
    h.lineRows.map((values) => ({
      id: values.id,
      text: (attr: string) => (values[attr] as string | undefined) ?? null,
      number: (attr: string) => (values[attr] as number | undefined) ?? null,
      option: (attr: string) => (values[attr] as string | undefined) ?? null,
      related: (attr: string) => (values[attr] as string | undefined) ?? null,
    }))
  ),
}))

import { getCachedEntityDefId, getOrgCache } from '../../../../cache'
import { listJournalEntries, readJournalEntryLines } from '../reads'

const LINE_FIELDS = {
  journal_entry_line_journal_entry: { id: 'f_parent' },
  journal_entry_line_gl_account: { id: 'f_account' },
  journal_entry_line_side: { id: 'f_side' },
  journal_entry_line_amount: { id: 'f_amount' },
  journal_entry_line_memo: { id: 'f_memo' },
  journal_entry_line_counterparty_type: { id: 'f_cpt' },
  journal_entry_line_counterparty: { id: 'f_cp' },
  journal_entry_line_sort_order: { id: 'f_sort' },
}

function line(values: Record<string, unknown>): Record<string, unknown> {
  return {
    journal_entry_line_journal_entry: 'je_1',
    journal_entry_line_side: 'debit',
    ...values,
  }
}

describe('readJournalEntryLines', () => {
  beforeEach(() => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue('def_line')
    vi.mocked(getOrgCache).mockReturnValue({
      from: () => ({ bySystemAttributes: async () => LINE_FIELDS }),
    } as unknown as ReturnType<typeof getOrgCache>)
  })

  it('groups lines under their entry in sort order, carrying each line id', async () => {
    h.lineRows = [
      line({
        id: 'l2',
        journal_entry_line_gl_account: 'acct_2100',
        journal_entry_line_side: 'credit',
        journal_entry_line_amount: 50_000,
        journal_entry_line_sort_order: 1,
      }),
      line({
        id: 'l1',
        journal_entry_line_gl_account: 'acct_6200',
        journal_entry_line_amount: 50_000,
        journal_entry_line_memo: 'Rent',
        journal_entry_line_sort_order: 0,
      }),
      line({
        id: 'l3',
        journal_entry_line_journal_entry: 'je_2',
        journal_entry_line_gl_account: 'acct_1100',
        journal_entry_line_amount: 5_000,
        journal_entry_line_counterparty_type: 'customer',
        journal_entry_line_counterparty: 'contact_1',
      }),
    ]
    const lines = await readJournalEntryLines({} as Database, 'org_1', ['je_1', 'je_2'])
    expect(lines.get('je_1')).toEqual([
      { id: 'l1', glAccountId: 'acct_6200', direction: 'debit', amountMinor: 50_000, memo: 'Rent' },
      { id: 'l2', glAccountId: 'acct_2100', direction: 'credit', amountMinor: 50_000 },
    ])
    expect(lines.get('je_2')).toEqual([
      {
        id: 'l3',
        glAccountId: 'acct_1100',
        direction: 'debit',
        amountMinor: 5_000,
        counterpartyType: 'customer',
        counterpartyId: 'contact_1',
      },
    ])
  })

  it('keeps an uncoded, zero row so the builder can refuse it by row number', async () => {
    h.lineRows = [line({ id: 'l1' })]
    const lines = await readJournalEntryLines({} as Database, 'org_1', ['je_1'])
    expect(lines.get('je_1')).toEqual([
      { id: 'l1', glAccountId: '', direction: 'debit', amountMinor: 0 },
    ])
  })

  it('drops a counterparty type with no id', async () => {
    h.lineRows = [
      line({
        id: 'l1',
        journal_entry_line_gl_account: 'acct_1100',
        journal_entry_line_amount: 1,
        journal_entry_line_counterparty_type: 'vendor',
      }),
    ]
    const [only] = (await readJournalEntryLines({} as Database, 'org_1', ['je_1'])).get('je_1')!
    expect(only).not.toHaveProperty('counterpartyType')
  })

  it('reads nothing on an org short of migration 187', async () => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue(undefined)
    h.lineRows = [line({ id: 'l1' })]
    expect((await readJournalEntryLines({} as Database, 'org_1', ['je_1'])).size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The `status` filter: LEFT joins through the pointer, so `draft` can match the
// absence of a posting as well as a pointer to one that is gone.
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

  it('LEFT joins through the posting pointer for every status', async () => {
    for (const status of ['draft', 'posted', 'reversed'] as const) {
      const { db, joins } = joinSpyDb()
      await listJournalEntries(db, 'org_1', { status })
      expect(joins).toEqual(['left', 'left'])
    }
  })

  it('joins nothing at all when no status is asked for', async () => {
    const { db, joins } = joinSpyDb()
    await listJournalEntries(db, 'org_1', {})
    expect(joins).toEqual([])
  })
})
