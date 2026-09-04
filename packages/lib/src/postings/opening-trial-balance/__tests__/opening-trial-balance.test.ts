// packages/lib/src/postings/opening-trial-balance/__tests__/opening-trial-balance.test.ts
//
// The reads and writes over the one `opening_balance` journal entry.
//
// Everything this module touches a table through is somebody else's tested
// function - `listJournalEntries`, `listChartAccounts`, `loadRoleAccountCodes`,
// `postEntry`, `UnifiedCrudHandler` - so the doubles are at THOSE seams rather
// than at a fake Postgres. What is actually under test is the assembly: which
// entry wins, where a locked row's number comes from, what the freeze refuses,
// and that the posted entry is keyed on the cutover date rather than on the
// record number.
//
// The one exception is `hasStandingPosting`, a two-line select this module owns,
// which gets a hand-written `db` double for the same reason `post-entry.test.ts`
// hand-writes its own: a chainable spy cannot answer two queries differently.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  entries: [] as unknown[],
  chart: [] as unknown[],
  roleAccounts: new Map<string, { id: string; code: string; name: string }>(),
  standingPostings: 0,
  postResult: { status: 'posted', glPostingId: 'glp_1' } as Record<string, unknown>,
  crudUpdate: vi.fn(),
  created: [] as unknown[],
  updated: [] as unknown[],
}))

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings.get(key) ?? null,
}))

vi.mock('../../journal-entries/reads', () => ({
  listJournalEntries: async () => ({ isErr: () => false, value: h.entries }),
  requireJournalEntryFieldContext: async () => ({ journalEntryDefId: 'def_je', fields: {} }),
}))

vi.mock('../../journal-entries/writes', () => ({
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

vi.mock('../../role-map', () => ({
  listChartAccounts: async () => ({ isErr: () => false, value: h.chart }),
}))

vi.mock('../../resolve-roles', () => ({
  loadRoleAccountCodes: async () => h.roleAccounts,
}))

vi.mock('../../read-posting', () => ({
  getPosting: async (_db: unknown, _org: string, id: string) => ({
    isErr: () => false,
    value: {
      id,
      docNumber: 'AUXX-OPB-20261231',
      txnDate: '2026-12-31',
      status: 'posted',
      totalMinor: 500_00,
    },
  }),
}))

vi.mock('../../period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))

// ⚠️ `assertAccountingSetupUnfrozen` reaches the module-level `database` pool
// rather than the `db` this module threads through, so it cannot be driven by
// the `db` double below. It is slot 0D's function with its own tests; what is
// under test here is that this module CALLS it and stops when it refuses, so
// the double reproduces its refusal verbatim, including the reversal sentence.
vi.mock('../../settled-periods', () => ({
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
vi.mock('../../post-entry', () => ({
  postEntry: (...args: unknown[]) => postEntry(...(args as [])),
  previewEntry: async (
    _db: unknown,
    options: { entry: { periodKey: string; txnDate: string } }
  ) => ({
    postingType: 'opening_balance',
    periodKey: options.entry.periodKey,
    txnDate: options.entry.txnDate,
    docNumber: 'AUXX-OPB-20261231',
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

import { findLockedRowDivergences, type OpeningTrialBalanceRow } from '../client'
import { readOpeningTrialBalance } from '../reads'
import {
  postOpeningTrialBalance,
  previewOpeningTrialBalance,
  saveOpeningTrialBalance,
} from '../writes'

const ORG = 'org_1'
const USER = 'usr_1'

/** `hasStandingPosting`'s only query: `select().from().where().limit()`. */
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
    ['accounting.openingRawMaterials', 100_00],
    ['accounting.openingWip', 0],
    ['accounting.openingFinishedGoods', 250_00],
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
    ['inventory_raw_materials', { id: 'a3', code: '1310', name: 'Raw Materials' }],
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

  it('marks the inventory account locked and reads its amount from the SETTINGS', async () => {
    // 🛑 Even when the stored draft disagrees. `readOpeningBaseline` hands the
    // first close the settings figure, so a draft that won here would post a
    // ledger the close then contradicts.
    h.entries = [draft([{ accountCode: '1310', direction: 'debit', amountMinor: 999_99 }])]
    const { rows } = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    const inventory = rows.find((r) => r.accountCode === '1310')
    expect(inventory?.lockedByRole).toBe('inventory_raw_materials')
    expect(inventory?.debitMinor).toBe(100_00)
    expect(inventory?.creditMinor).toBeNull()
  })

  it('resolves the lock by ROLE, so a renumbered chart still locks the right row', async () => {
    h.roleAccounts = new Map([
      ['inventory_raw_materials', { id: 'a1', code: '1000', name: 'Renumbered RM' }],
    ])
    const { rows } = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    expect(rows.find((r) => r.accountCode === '1000')?.lockedByRole).toBe('inventory_raw_materials')
    expect(rows.find((r) => r.accountCode === '1310')?.lockedByRole).toBeUndefined()
  })

  it('reads an unset inventory setting as null, never as zero', async () => {
    h.settings.delete('accounting.openingRawMaterials')
    const { rows } = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    expect(rows.find((r) => r.accountCode === '1310')?.debitMinor).toBeNull()
  })

  it('reads a FRACTIONAL inventory setting as null - the close would refuse it anyway', async () => {
    h.settings.set('accounting.openingRawMaterials', 12.5)
    const { rows } = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    expect(rows.find((r) => r.accountCode === '1310')?.debitMinor).toBeNull()
  })

  it('fills unlocked rows from the stored draft, both sides', async () => {
    h.entries = [
      draft([
        { accountCode: '1000', direction: 'debit', amountMinor: 500_00 },
        { accountCode: '3900', direction: 'credit', amountMinor: 600_00 },
      ]),
    ]
    const { rows, summary } = (await readOpeningTrialBalance(db, ORG))._unsafeUnwrap()
    expect(rows.find((r) => r.accountCode === '1000')?.debitMinor).toBe(500_00)
    expect(rows.find((r) => r.accountCode === '3900')?.creditMinor).toBe(600_00)
    // The verdict counts the locked inventory row too: 500_00 + 100_00 vs 600_00.
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
    expect(view.posting?.docNumber).toBe('AUXX-OPB-20261231')
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
      lines: [{ accountCode: '1000', direction: 'debit', amountMinor: 500_00 }],
    })
    expect(result.isErr()).toBe(false)
    expect(h.created).toEqual([
      {
        kind: 'opening_balance',
        date: '2026-12-31',
        memo: undefined,
        lines: [{ accountCode: '1000', direction: 'debit', amountMinor: 500_00 }],
      },
    ])
  })

  it('replaces an existing draft wholesale, re-deriving the date', async () => {
    h.entries = [draft([{ accountCode: '1000', direction: 'debit', amountMinor: 1 }])]
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
        { accountCode: '1000', direction: 'debit', amountMinor: 500_00 },
        // The locked inventory row, carrying exactly what
        // `accounting.openingRawMaterials` says. A draft that disagreed is
        // refused - see the divergence test below.
        { accountCode: '1310', direction: 'debit', amountMinor: 100_00 },
        { accountCode: '3900', direction: 'credit', amountMinor: 600_00 },
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
        { accountCode: '1000', direction: 'debit', amountMinor: 1 },
        { accountCode: '1310', direction: 'debit', amountMinor: 100_00 },
        { accountCode: '3900', direction: 'credit', amountMinor: 100_01 },
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
    { accountCode: '1000', direction: 'debit' as const, amountMinor: 500_00 },
    // 1310 is LOCKED to `accounting.openingRawMaterials` (100_00 in the
    // fixture). A draft that carries a different number for it is refused
    // before anything is claimed - see the last case in this block.
    { accountCode: '1310', direction: 'debit' as const, amountMinor: 100_00 },
    { accountCode: '3900', direction: 'credit' as const, amountMinor: 600_00 },
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

  it('stamps the record posted with its posting id', async () => {
    h.entries = [draft(balanced)]
    const result = await postOpeningTrialBalance(db, ORG, USER)
    expect(result._unsafeUnwrap()).toEqual({ status: 'posted', glPostingId: 'glp_1' })
    expect(h.crudUpdate).toHaveBeenCalledWith('def_je:je_1', {
      journal_entry_status: 'posted',
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

  it('stamps on not_connected, which DOES write a posting', async () => {
    h.entries = [draft(balanced)]
    h.postResult = { status: 'not_connected', glPostingId: 'glp_2' }
    await postOpeningTrialBalance(db, ORG, USER)
    expect(h.crudUpdate).toHaveBeenCalled()
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
        { accountCode: '1000', direction: 'debit', amountMinor: 500_00 },
        { accountCode: '1310', direction: 'debit', amountMinor: 100_00 },
        { accountCode: '3900', direction: 'credit', amountMinor: 500_00 },
      ]),
    ]
    expect((await postOpeningTrialBalance(db, ORG, USER))._unsafeUnwrapErr().message).toMatch(
      /off by 10000/
    )
    expect(postEntry).not.toHaveBeenCalled()
  })

  it('refuses a draft whose LOCKED inventory row disagrees with its setting, naming the account', async () => {
    // 🛑 `readOpeningTrialBalance` renders 1310 from
    // `accounting.openingRawMaterials`; the builder posts what is STORED. A
    // divergent draft therefore shows one number on screen and writes another -
    // and the settings are what `readOpeningBaseline` hands the first close, so
    // the very next month-end assertion would contradict the ledger.
    h.entries = [
      draft([
        { accountCode: '1000', direction: 'debit', amountMinor: 500_00 },
        { accountCode: '1310', direction: 'debit', amountMinor: 999_99 },
        { accountCode: '3900', direction: 'credit', amountMinor: 1499_99 },
      ]),
    ]
    const error = (await postOpeningTrialBalance(db, ORG, USER))._unsafeUnwrapErr()
    expect(error.message).toMatch(/1310 Raw Materials/)
    expect(error.message).toMatch(/99999/)
    expect(error.message).toMatch(/10000/)
    expect(postEntry).not.toHaveBeenCalled()
  })

  it('refuses a draft that OMITS a locked row the settings give a balance to', async () => {
    h.entries = [
      draft([
        { accountCode: '1000', direction: 'debit', amountMinor: 500_00 },
        { accountCode: '3900', direction: 'credit', amountMinor: 500_00 },
      ]),
    ]
    expect((await postOpeningTrialBalance(db, ORG, USER))._unsafeUnwrapErr().message).toMatch(
      /1310 Raw Materials/
    )
    expect(postEntry).not.toHaveBeenCalled()
  })

  it('posts a draft whose locked row matches, and one with no inventory setting at all', async () => {
    h.settings.delete('accounting.openingRawMaterials')
    h.entries = [
      draft([
        { accountCode: '1000', direction: 'debit', amountMinor: 500_00 },
        { accountCode: '3900', direction: 'credit', amountMinor: 500_00 },
      ]),
    ]
    expect((await postOpeningTrialBalance(db, ORG, USER)).isErr()).toBe(false)
    expect(postEntry).toHaveBeenCalledTimes(1)
  })

  it('still reports an EMPTY draft as an empty trial balance, not as three divergences', async () => {
    h.entries = [draft([])]
    expect((await postOpeningTrialBalance(db, ORG, USER))._unsafeUnwrapErr().message).toMatch(
      /opening trial balance is empty/i
    )
  })
})

describe('findLockedRowDivergences', () => {
  function lockedRow(overrides: Partial<OpeningTrialBalanceRow> = {}): OpeningTrialBalanceRow {
    return {
      accountId: 'a3',
      accountCode: '1310',
      accountName: 'Raw Materials',
      accountType: 'asset',
      isActive: true,
      lockedByRole: 'inventory_raw_materials',
      debitMinor: 100_00,
      creditMinor: null,
      ...overrides,
    }
  }

  it('is empty when the stored line matches the setting', () => {
    expect(
      findLockedRowDivergences(
        [lockedRow()],
        [{ accountCode: '1310', direction: 'debit', amountMinor: 100_00 }]
      )
    ).toEqual([])
  })

  it('is empty for a row with no setting and no stored line - the ordinary "no WIP" case', () => {
    expect(findLockedRowDivergences([lockedRow({ debitMinor: null })], [])).toEqual([])
  })

  it('ignores unlocked rows entirely - only the three settings-owned rows are checked', () => {
    const unlocked = lockedRow({ accountCode: '1000', lockedByRole: undefined, debitMinor: 42 })
    expect(findLockedRowDivergences([unlocked], [])).toEqual([])
  })

  it('reports a stored amount that differs, with both numbers', () => {
    expect(
      findLockedRowDivergences(
        [lockedRow()],
        [{ accountCode: '1310', direction: 'debit', amountMinor: 999_99 }]
      )
    ).toEqual([
      {
        accountCode: '1310',
        accountName: 'Raw Materials',
        role: 'inventory_raw_materials',
        settingMinor: 100_00,
        storedMinor: 999_99,
      },
    ])
  })

  it('treats a CREDIT of the same magnitude as a divergence, never as a match', () => {
    // Signed, so a stored credit of 100_00 against a setting debit of 100_00 is
    // a 20,000-minor-unit disagreement rather than a match on magnitude.
    const [divergence] = findLockedRowDivergences(
      [lockedRow()],
      [{ accountCode: '1310', direction: 'credit', amountMinor: 100_00 }]
    )
    expect(divergence?.storedMinor).toBe(-100_00)
  })

  it('nets two stored lines for the same account before comparing', () => {
    expect(
      findLockedRowDivergences(
        [lockedRow()],
        [
          { accountCode: '1310', direction: 'debit', amountMinor: 150_00 },
          { accountCode: '1310', direction: 'credit', amountMinor: 50_00 },
        ]
      )
    ).toEqual([])
  })
})
