// packages/lib/src/accounting/opening/__tests__/opening-trial-balance.test.ts
//
// The reads and writes over the one `opening_balance` journal entry.
//
// Everything this module touches a table through is somebody else's tested
// function - `listJournalEntries`, `listChartAccounts`, `loadRoleAccountCodes`,
// `postEntry`, `UnifiedCrudHandler` - so the doubles are at THOSE seams rather
// than at a fake Postgres. What is actually under test is the assembly: which
// entry wins, what the freeze refuses,
// and that the posted entry is keyed on the cutover date rather than on the
// record number.
//
// `hasStandingEntry` is doubled at the `settled-periods` seam beside the freeze
// it backs, so the two can never disagree about what a standing entry is.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  entries: [] as unknown[],
  chart: [] as unknown[],
  roleAccounts: new Map<string, { glAccountId: string; code: string | null; name: string }>(),
  standingPostings: 0,
  postResult: { status: 'posted', glPostingId: 'glp_1' } as Record<string, unknown>,
  crudUpdate: vi.fn(),
  created: [] as unknown[],
  updated: [] as unknown[],
}))

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings.get(key) ?? null,
}))

vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async (_organizationId: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, h.settings.get(key) ?? null])),
}))

vi.mock('../../journals/entries/reads', () => ({
  listJournalEntries: async () => ({ isErr: () => false, value: h.entries }),
}))

vi.mock('../../journals/entries/fields', () => ({
  requireJournalEntryFieldContext: async () => ({ defId: 'def_je', fields: {} }),
}))

vi.mock('../../journals/entries/writes', () => ({
  createJournalEntry: async (
    _db: unknown,
    _org: string,
    _user: string,
    input: Record<string, unknown>
  ) => {
    h.created.push(input)
    const record = {
      id: 'je_new',
      number: 'JNL-0001',
      status: 'draft',
      kind: 'opening_balance',
      ...input,
    }
    return { isErr: () => false, value: record }
  },
  updateJournalEntry: async (
    _db: unknown,
    _org: string,
    _user: string,
    input: Record<string, unknown>
  ) => {
    h.updated.push(input)
    return { isErr: () => false, value: { ...(h.entries[0] as object), ...input } }
  },
}))

vi.mock('../../ledger/roles/role-map', () => ({
  listChartAccounts: async () => ({ isErr: () => false, value: h.chart }),
}))

vi.mock('../../ledger/roles/resolve-roles', () => ({
  loadRoleAccountCodes: async () => h.roleAccounts,
}))

vi.mock('../../ledger/reads/read-posting', () => ({
  getPosting: async (_db: unknown, _org: string, id: string) => ({
    isErr: () => false,
    value: {
      id,
      docNumber: 'OPB-20261231',
      txnDate: '2026-12-31',
      status: 'posted',
      totalMinor: 500_00,
    },
  }),
}))

vi.mock('../../ledger/periods/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))

// ⚠️ `assertAccountingSetupUnfrozen` reaches the module-level `database` pool
// rather than the `db` this module threads through, so it cannot be driven by
// the `db` double below. It is slot 0D's function with its own tests; what is
// under test here is that this module CALLS it and stops when it refuses, so
// the double reproduces its refusal verbatim, including the reversal sentence.
vi.mock('../../ledger/periods/settled-periods', () => ({
  hasStandingEntry: async () => h.standingPostings > 0,
  assertAccountingSetupUnfrozen: async (_org: string, keys: readonly string[]) => {
    if (h.standingPostings === 0) return
    const { ConflictError } = await import('../../../errors')
    throw new ConflictError(
      `${keys.join(', ')} cannot change once the ledger holds an entry. To change it, reverse ` +
        'the standing entries from the ledger page first.',
      { keys: keys.join(',') }
    )
  },
}))

const postEntry = vi.fn(async () => h.postResult)
vi.mock('../../ledger/post/post-entry', () => ({
  postEntry: (...args: unknown[]) => postEntry(...(args as [])),
  previewEntry: async (
    _db: unknown,
    options: { entry: { periodKey: string; txnDate: string } }
  ) => ({
    postingType: 'opening_balance',
    periodKey: options.entry.periodKey,
    txnDate: options.entry.txnDate,
    docNumber: 'OPB-20261231',
    lines: [],
    totalMinor: 500_00,
  }),
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = h.crudUpdate
  },
}))

vi.mock('../../../resources/resource-id', () => ({
  toRecordId: (a: string, b: string) => `${a}:${b}`,
}))

import { readOpeningTrialBalance } from '../reads'
import {
  postOpeningTrialBalance,
  previewOpeningTrialBalance,
  saveOpeningTrialBalance,
} from '../writes'

const ORG = 'org_1'
const USER = 'usr_1'

/** Unused now that `hasStandingEntry` is doubled; kept as the handle callers pass. */
const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (h.standingPostings > 0 ? [{ id: 'glp_existing' }] : []),
      }),
    }),
  }),
} as never

function account(id: string, code: string, name: string, accountType: string) {
  return { id, code, name, accountType, isActive: true }
}

beforeEach(() => {
  h.settings = new Map<string, unknown>([
    ['accounting.cutoffPeriod', '2026-12'],
    ['accounting.bookTimeZone', 'America/New_York'],
    ['accounting.setupState', 'draft'],
    ['organization.currency', 'USD'],
  ])
  h.entries = []
  h.chart = [
    account('a5', '5000', 'Cost of Goods Sold', 'expense'),
    account('a2', '2000', 'Accounts Payable', 'liability'),
    account('a1', '1000', 'Cash', 'asset'),
    account('a3', '1310', 'Raw Materials', 'asset'),
    account('a4', '3900', 'Opening Balance Equity', 'equity'),
  ]
  h.roleAccounts = new Map([
    ['inventory_raw_materials', { glAccountId: 'a3', code: '1310', name: 'Raw Materials' }],
  ])
  h.standingPostings = 0
  h.postResult = { status: 'posted', glPostingId: 'glp_1' }
  h.crudUpdate = vi.fn()
  h.created = []
  h.updated = []
  postEntry.mockClear()
})

function draft(lines: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    id: 'je_1',
    number: 'JNL-0001',
    date: '2026-12-31',
    memo: null,
    status: 'draft',
    kind: 'opening_balance',
    lines,
    glPostingId: null,
    createdAt: '2026-09-04T00:00:00.000Z',
    ...overrides,
  }
}

describe('readOpeningTrialBalance', () => {
  it('derives the cutover date from the cutoff month', async () => {
    const view = await readOpeningTrialBalance(db, ORG)
    expect(view.isErr()).toBe(false)
    expect(view._unsafeUnwrap().cutoverDate).toBe('2026-12-31')
  })

  it('returns the whole chart in STATEMENT order, not by code', async () => {
    const { rows } = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    // assets, liabilities, equity, revenue, expense - and by code inside a type.
    expect(rows.map((r) => r.accountCode)).toEqual(['1000', '1310', '2000', '3900', '5000'])
  })

  it('does not take the screen down on a malformed cutoff - that is what is being fixed', async () => {
    h.settings.set('accounting.cutoffPeriod', 'not-a-month')
    const view = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    expect(view.cutoverDate).toBeNull()
    expect(view.rows).toHaveLength(5)
  })

  it('reads the inventory row from the stored draft like any other row - no settings own it', async () => {
    h.entries = [draft([{ glAccountId: 'a3', direction: 'debit', amountMinor: 999_99 }])]
    const { rows } = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    const inventory = rows.find((r) => r.accountCode === '1310')
    expect(inventory).not.toHaveProperty('lockedByRole')
    expect(inventory?.debitMinor).toBe(999_99)
    expect(inventory?.creditMinor).toBeNull()
  })

  it('fills rows from the stored draft, both sides', async () => {
    h.entries = [
      draft([
        { glAccountId: 'a1', direction: 'debit', amountMinor: 500_00 },
        { glAccountId: 'a3', direction: 'debit', amountMinor: 100_00 },
        { glAccountId: 'a4', direction: 'credit', amountMinor: 600_00 },
      ]),
    ]
    const { rows, summary } = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    expect(rows.find((r) => r.accountCode === '1000')?.debitMinor).toBe(500_00)
    expect(rows.find((r) => r.accountCode === '3900')?.creditMinor).toBe(600_00)
    expect(summary).toEqual({
      debitMinor: 600_00,
      creditMinor: 600_00,
      rows: 3,
      differenceMinor: 0,
    })
  })

  it('prefers a DRAFT over a posted entry, so a re-entry after a reversal opens', async () => {
    h.entries = [
      draft([], { id: 'je_posted', status: 'reversed' }),
      draft([], { id: 'je_draft', status: 'draft' }),
    ]
    expect((await readOpeningTrialBalance(db, ORG))._unsafeUnwrap().entry?.id).toBe('je_draft')
  })

  it('falls back to the newest posted entry when there is no draft', async () => {
    h.entries = [draft([], { id: 'je_posted', status: 'posted', glPostingId: 'glp_9' })]
    const view = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    expect(view.entry?.id).toBe('je_posted')
    expect(view.posting?.docNumber).toBe('OPB-20261231')
  })

  it('has no posting while the entry is a draft', async () => {
    h.entries = [draft([])]
    expect((await readOpeningTrialBalance(db, ORG))._unsafeUnwrap().posting).toBeNull()
  })

  it('reports frozen once the ledger holds a standing entry', async () => {
    expect((await readOpeningTrialBalance(db, ORG))._unsafeUnwrap().frozen).toBe(false)
    h.standingPostings = 1
    expect((await readOpeningTrialBalance(db, ORG))._unsafeUnwrap().frozen).toBe(true)
  })

  it('reports finalized off accounting.setupState', async () => {
    h.settings.set('accounting.setupState', 'finalized')
    const view = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    expect(view.finalized).toBe(true)
    expect(view.setupState).toBe('finalized')
  })
})

describe('saveOpeningTrialBalance', () => {
  it('creates the draft dated the cutover date when there is none', async () => {
    const result = await saveOpeningTrialBalance(db, ORG, USER, {
      lines: [{ glAccountId: 'a1', direction: 'debit', amountMinor: 500_00 }],
    })
    expect(result.isErr()).toBe(false)
    expect(h.created).toEqual([
      {
        kind: 'opening_balance',
        date: '2026-12-31',
        memo: undefined,
        lines: [{ glAccountId: 'a1', direction: 'debit', amountMinor: 500_00 }],
      },
    ])
  })

  it('replaces an existing draft wholesale, re-deriving the date', async () => {
    h.entries = [draft([{ glAccountId: 'a1', direction: 'debit', amountMinor: 1 }])]
    await saveOpeningTrialBalance(db, ORG, USER, { lines: [] })
    expect(h.created).toEqual([])
    expect(h.updated).toEqual([{ journalEntryId: 'je_1', date: '2026-12-31', lines: [] }])
  })

  it('follows a corrected cutoff rather than keeping the old date', async () => {
    h.entries = [draft([])]
    h.settings.set('accounting.cutoffPeriod', '2027-02')
    await saveOpeningTrialBalance(db, ORG, USER, { lines: [] })
    expect((h.updated[0] as { date: string }).date).toBe('2027-02-28')
  })

  it('refuses once the ledger holds a standing entry, naming the reversal path', async () => {
    // The freeze is `assertAccountingSetupUnfrozen`, the SAME guard
    // `setting.batchUpdate` runs over `accounting.opening*`. This module is not
    // a second door onto a frozen baseline.
    h.standingPostings = 1
    const result = await saveOpeningTrialBalance(db, ORG, USER, { lines: [] })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/reverse the standing/)
    expect(h.created).toEqual([])
    expect(h.updated).toEqual([])
  })

  it('refuses when the cutoff or the timezone is unset - the entry has no date', async () => {
    h.settings.delete('accounting.bookTimeZone')
    const result = await saveOpeningTrialBalance(db, ORG, USER, { lines: [] })
    expect(result._unsafeUnwrapErr().message).toMatch(/book\s+timezone/i)
    expect(h.created).toEqual([])
  })
})

describe('previewOpeningTrialBalance', () => {
  it('previews the STORED lines, keyed and dated on the cutover date', async () => {
    h.entries = [
      draft([
        { glAccountId: 'a1', direction: 'debit', amountMinor: 500_00 },
        { glAccountId: 'a3', direction: 'debit', amountMinor: 100_00 },
        { glAccountId: 'a4', direction: 'credit', amountMinor: 600_00 },
      ]),
    ]
    const preview = (await previewOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    expect(preview.periodKey).toBe('2026-12-31')
    expect(preview.txnDate).toBe('2026-12-31')
  })

  it('previews overrides without persisting them', async () => {
    h.entries = [draft([])]
    const preview = await previewOpeningTrialBalance(db, ORG, {
      lines: [
        { glAccountId: 'a1', direction: 'debit', amountMinor: 1 },
        { glAccountId: 'a3', direction: 'debit', amountMinor: 100_00 },
        { glAccountId: 'a4', direction: 'credit', amountMinor: 100_01 },
      ],
    })
    expect(preview.isErr()).toBe(false)
    expect(h.updated).toEqual([])
  })

  it('refuses with the empty-trial-balance message when nothing has been entered', async () => {
    h.entries = [draft([])]
    expect((await previewOpeningTrialBalance(db, ORG))._unsafeUnwrapErr().message).toMatch(
      /opening trial balance is empty/i
    )
  })

  it('refuses when no opening entry has been started at all', async () => {
    expect((await previewOpeningTrialBalance(db, ORG))._unsafeUnwrapErr().message).toMatch(
      /no opening trial balance yet/i
    )
  })
})

describe('postOpeningTrialBalance', () => {
  const balanced = [
    { glAccountId: 'a1', direction: 'debit' as const, amountMinor: 500_00 },
    { glAccountId: 'a3', direction: 'debit' as const, amountMinor: 100_00 },
    { glAccountId: 'a4', direction: 'credit' as const, amountMinor: 600_00 },
  ]

  it('posts an entry keyed on the CUTOVER DATE, not on the record number', async () => {
    // 🛑 The reason this module exists beside `postJournalEntry`. An org has one
    // opening entry, so keying on the date makes a double post unrepresentable
    // at the claim's unique index; `postJournalEntry` would key it `JNL-0001`.
    h.entries = [draft(balanced)]
    await postOpeningTrialBalance(db, ORG, USER)
    const [[, options]] = postEntry.mock.calls as unknown as [
      [unknown, { entry: { periodKey: string; txnDate: string; postingType: string } }],
    ]
    expect(options.entry.postingType).toBe('opening_balance')
    expect(options.entry.periodKey).toBe('2026-12-31')
    expect(options.entry.txnDate).toBe('2026-12-31')
  })

  it('posts under its own subject, keyed on the cutover date - never the draft record', async () => {
    h.entries = [draft(balanced)]
    await postOpeningTrialBalance(db, ORG, USER)
    const [[, options]] = postEntry.mock.calls as unknown as [
      [unknown, { sources: Array<Record<string, unknown>> }],
    ]
    expect(options).not.toHaveProperty('mode')
    expect(options.sources).toEqual([
      {
        sourceKind: 'opening_balance',
        sourceId: ORG,
        occurrence: '2026-12-31',
        linkRole: 'subject',
      },
    ])
  })

  it('stamps the record with its posting id - there is no status field to write any more', async () => {
    h.entries = [draft(balanced)]
    const result = await postOpeningTrialBalance(db, ORG, USER)
    expect(result._unsafeUnwrap()).toEqual({ status: 'posted', glPostingId: 'glp_1' })
    expect(h.crudUpdate).toHaveBeenCalledWith('def_je:je_1', {
      journal_entry_gl_posting_id: 'glp_1',
    })
  })

  it('leaves the record a draft when the post was refused', async () => {
    // "Fix it and press Finalize again" needs the draft still to be a draft.
    h.entries = [draft(balanced)]
    h.postResult = { status: 'period_closed', glPostingId: null, error: 'locked' }
    const result = await postOpeningTrialBalance(db, ORG, USER)
    expect(result._unsafeUnwrap()).toMatchObject({ status: 'period_closed' })
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('stamps on already_posted, a converged re-run', async () => {
    h.entries = [draft(balanced)]
    h.postResult = { status: 'already_posted', glPostingId: 'glp_2' }
    await postOpeningTrialBalance(db, ORG, USER)
    expect(h.crudUpdate).toHaveBeenCalledWith('def_je:je_1', {
      journal_entry_gl_posting_id: 'glp_2',
    })
  })

  it('does not stamp an error that still names a posting id', async () => {
    h.entries = [draft(balanced)]
    h.postResult = { status: 'error', glPostingId: 'glp_3', error: 'boom' }
    await postOpeningTrialBalance(db, ORG, USER)
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('refuses a second post, naming the reversal path', async () => {
    h.entries = [draft(balanced, { status: 'posted', glPostingId: 'glp_1' })]
    const result = await postOpeningTrialBalance(db, ORG, USER)
    expect(result._unsafeUnwrapErr().message).toMatch(/already posted/i)
    expect(result._unsafeUnwrapErr().message).toMatch(/reversing the entry/)
    expect(postEntry).not.toHaveBeenCalled()
  })

  it('refuses an unbalanced trial balance before anything is claimed', async () => {
    h.entries = [
      draft([
        { glAccountId: 'a1', direction: 'debit', amountMinor: 500_00 },
        { glAccountId: 'a3', direction: 'debit', amountMinor: 100_00 },
        { glAccountId: 'a4', direction: 'credit', amountMinor: 500_00 },
      ]),
    ]
    expect((await postOpeningTrialBalance(db, ORG, USER))._unsafeUnwrapErr().message).toMatch(
      /off by 10000/
    )
    expect(postEntry).not.toHaveBeenCalled()
  })

  it('posts whatever inventory figure the draft holds - nothing locks it any more', async () => {
    h.entries = [
      draft([
        { glAccountId: 'a1', direction: 'debit', amountMinor: 500_00 },
        { glAccountId: 'a3', direction: 'debit', amountMinor: 999_99 },
        { glAccountId: 'a4', direction: 'credit', amountMinor: 1499_99 },
      ]),
    ]
    expect((await postOpeningTrialBalance(db, ORG, USER)).isErr()).toBe(false)
    expect(postEntry).toHaveBeenCalledTimes(1)
  })

  it('reports an EMPTY draft as an empty trial balance', async () => {
    h.entries = [draft([])]
    expect((await postOpeningTrialBalance(db, ORG, USER))._unsafeUnwrapErr().message).toMatch(
      /opening trial balance is empty/i
    )
  })
})
