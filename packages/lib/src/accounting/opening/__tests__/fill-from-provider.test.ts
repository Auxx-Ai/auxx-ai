// packages/lib/src/accounting/opening/__tests__/fill-from-provider.test.ts
//
// `fillOpeningTrialBalanceFromProvider` wires the pure planner into the real
// read/write path (`readOpeningTrialBalance`, `saveOpeningTrialBalance`,
// `postOpeningTrialBalance`), doubled only at their table seams. Under test: the
// provider's balance sheet is the opening INCLUDING inventory (103 §5a), and an
// unmatched provider balance refuses before anything is saved.

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
  batchUpdateSettings: vi.fn(),
  cacheEvents: [] as unknown[],
  sheet: null as unknown,
  accountMap: new Map<string, string>(),
}))

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings.get(key) ?? null,
  batchUpdateOrganizationSettings: async (input: unknown) => {
    h.batchUpdateSettings(input)
  },
}))

vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async (_organizationId: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, h.settings.get(key) ?? null])),
}))

vi.mock('../../../cache/invalidate', () => ({
  onCacheEvent: async (...args: unknown[]) => {
    h.cacheEvents.push(args)
  },
}))

vi.mock('../../providers/provider', () => ({
  resolveAccountingProvider: async () => ({
    id: 'quickbooks',
    readProviderBalances: async () => ({ isErr: () => false, value: h.sheet }),
    listAccountMappings: async () => ({ isErr: () => false, value: h.accountMap }),
  }),
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
    h.entries = [record]
    return { isErr: () => false, value: record }
  },
  updateJournalEntry: async (
    _db: unknown,
    _org: string,
    _user: string,
    input: Record<string, unknown>
  ) => {
    h.updated.push(input)
    const record = { ...(h.entries[0] as object), ...input }
    h.entries = [record]
    return { isErr: () => false, value: record }
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

import { fillOpeningTrialBalanceFromProvider } from '../fill-from-provider'
import { postOpeningTrialBalance } from '../writes'

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

function accountRow(providerAccountId: string, minorSigned: number, name = 'Account') {
  return { providerAccountId, name, kind: 'account' as const, minorSigned }
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
    account('a1', '1000', 'Cash', 'asset'),
    account('a2', '2000', 'Accounts Payable', 'liability'),
    account('a3', '1330', 'Finished Goods', 'asset'),
  ]
  h.roleAccounts = new Map()
  h.accountMap = new Map([
    ['a1', 'p_cash'],
    ['a2', 'p_ap'],
    ['a3', 'p_inv'],
  ])
  h.sheet = {
    asOf: '2026-12-31',
    currency: 'USD',
    reportBasis: 'Accrual',
    hasData: true,
    rows: [
      accountRow('p_cash', 400_00, 'Cash'),
      accountRow('p_inv', 100_00, 'Inventory Asset'),
      accountRow('p_ap', -500_00, 'Accounts Payable'),
    ],
  }
  h.standingPostings = 0
  h.postResult = { status: 'posted', glPostingId: 'glp_1' }
  h.crudUpdate = vi.fn()
  h.created = []
  h.updated = []
  h.batchUpdateSettings = vi.fn()
  h.cacheEvents = []
  postEntry.mockClear()
})

describe('fillOpeningTrialBalanceFromProvider', () => {
  it('saves the provider inventory figure like any other row, and the draft posts', async () => {
    const filled = await fillOpeningTrialBalanceFromProvider(db, ORG, USER)
    expect(filled._unsafeUnwrap()).toMatchObject({ filledCount: 3, differenceMinor: 0 })

    const lines = (h.created[0] as { lines: unknown[] }).lines
    expect(lines).toContainEqual({ glAccountId: 'a3', direction: 'debit', amountMinor: 100_00 })

    const posted = await postOpeningTrialBalance(db, ORG, USER)
    expect(posted.isErr()).toBe(false)
    expect(postEntry).toHaveBeenCalledTimes(1)
  })

  it('refuses on a provider balance with no account of ours, listing it, and saves nothing', async () => {
    h.sheet = {
      ...(h.sheet as object),
      rows: [
        accountRow('p_cash', 400_00, 'Cash'),
        accountRow('p_inv', 100_00, 'Inventory Asset'),
        accountRow('p_loan', -50_00, 'Bank Loan'),
        accountRow('p_ap', -450_00, 'Accounts Payable'),
      ],
    }
    const result = await fillOpeningTrialBalanceFromProvider(db, ORG, USER)
    const error = result._unsafeUnwrapErr() as Error & { details: Record<string, unknown> }
    expect(error.message).toMatch(/Bank Loan/)
    expect(error.details.providerAccountIds).toEqual(['p_loan'])
    expect(h.created).toEqual([])
    expect(h.batchUpdateSettings).not.toHaveBeenCalled()
  })

  it('does not refuse on an unmatched provider account with a zero balance', async () => {
    h.sheet = {
      ...(h.sheet as object),
      rows: [...(h.sheet as { rows: unknown[] }).rows, accountRow('p_empty', 0, 'Unused')],
    }
    const result = await fillOpeningTrialBalanceFromProvider(db, ORG, USER)
    expect(result.isErr()).toBe(false)
  })

  it('writes the provenance settings and nothing about inventory', async () => {
    await fillOpeningTrialBalanceFromProvider(db, ORG, USER)
    const call = h.batchUpdateSettings.mock.calls[0]![0] as { settings: unknown[] }
    expect(call.settings).toEqual([
      { key: 'accounting.openingSource', value: 'provider' },
      { key: 'accounting.openingSourceAsOf', value: '2026-12-31' },
    ])
    expect(call).not.toHaveProperty('skipCacheInvalidation')
  })

  it('refuses when nothing is connected', async () => {
    h.sheet = null
    const result = await fillOpeningTrialBalanceFromProvider(db, ORG, USER)
    expect(result._unsafeUnwrapErr().message).toMatch(/no accounting system is connected/i)
  })

  it('refuses on a currency mismatch, naming both', async () => {
    h.sheet = { ...(h.sheet as object), currency: 'CAD' }
    const result = await fillOpeningTrialBalanceFromProvider(db, ORG, USER)
    expect(result._unsafeUnwrapErr().message).toMatch(/CAD/)
    expect(result._unsafeUnwrapErr().message).toMatch(/USD/)
  })
})
