// packages/lib/src/postings/opening-trial-balance/__tests__/fill-from-provider.test.ts
//
// `fillOpeningTrialBalanceFromProvider` wires the pure planner into the
// existing read/write path. Everything it touches through a table is somebody
// else's tested function - `readOpeningTrialBalance`, `saveOpeningTrialBalance`,
// `postOpeningTrialBalance` are the REAL functions here, doubled at the same
// seams `opening-trial-balance.test.ts` doubles them at - so what is under test
// is the assembly, and in particular the section 4.3 trap: a fill that saved
// `rows` WITHOUT the locked inventory rows would store zero for them, and the
// moment the count column holds a value `postOpeningTrialBalance` throws the
// "re-open the opening balances page" `ConflictError`. This is that regression
// test, run against the real write path rather than the pure planner alone.

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

vi.mock('../../../cache/invalidate', () => ({
  onCacheEvent: async (...args: unknown[]) => {
    h.cacheEvents.push(args)
  },
}))

vi.mock('../../provider', () => ({
  resolveAccountingProvider: async () => ({
    id: 'quickbooks',
    readProviderOpeningBalances: async () => ({ isErr: () => false, value: h.sheet }),
    listAccountMappings: async () => ({ isErr: () => false, value: h.accountMap }),
  }),
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
    // The count column is already set - the section 4.3 trap only bites when
    // it holds a value the locked row must be re-emitted at.
    ['accounting.openingRawMaterials', 100_00],
    ['accounting.openingWip', 0],
    ['accounting.openingFinishedGoods', 0],
  ])
  h.entries = []
  h.chart = [
    account('a1', '1000', 'Cash', 'asset'),
    account('a2', '2000', 'Accounts Payable', 'liability'),
    account('a3', '1310', 'Raw Materials', 'asset'),
  ]
  h.roleAccounts = new Map([
    ['inventory_raw_materials', { glAccountId: 'a3', code: '1310', name: 'Raw Materials' }],
  ])
  h.accountMap = new Map([
    ['a1', 'p_cash'],
    ['a2', 'p_ap'],
  ])
  // Balances with the locked row's 100_00 count included: 400_00 + 100_00 debit
  // vs 500_00 credit.
  h.sheet = {
    asOf: '2026-12-31',
    currency: 'USD',
    reportBasis: 'Accrual',
    hasData: true,
    rows: [accountRow('p_cash', 400_00, 'Cash'), accountRow('p_ap', -500_00, 'Accounts Payable')],
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
  it('saves a draft that includes the locked inventory row, so Finalize does not throw the locked-row ConflictError', async () => {
    const filled = await fillOpeningTrialBalanceFromProvider(db, ORG, USER)
    expect(filled.isErr()).toBe(false)

    // The section 4.3 trap: an early draft of the planner excluded locked rows
    // from `rows`, which stored zero for them and made this call throw.
    const posted = await postOpeningTrialBalance(db, ORG, USER)
    expect(posted.isErr()).toBe(false)
    expect(postEntry).toHaveBeenCalledTimes(1)
  })

  it('writes the provenance settings and fires the cache invalidation the settings router would have', async () => {
    await fillOpeningTrialBalanceFromProvider(db, ORG, USER)
    expect(h.batchUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        settings: expect.arrayContaining([
          { key: 'accounting.openingSource', value: 'provider' },
          { key: 'accounting.openingSourceAsOf', value: '2026-12-31' },
        ]),
      })
    )
    expect(h.cacheEvents).toEqual([['org.settings.changed', { orgId: ORG }]])
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
