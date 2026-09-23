// packages/lib/src/accounting/providers/__tests__/create-provider-accounts.test.ts
//
// The batch form of `create-provider-account.ts`, provider-neutral like its
// neighbour: what is stubbed is an `AccountingProvider`, never QuickBooks.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listAccountIdentities = vi.fn()
vi.mock('../account-identities', () => ({
  listAccountIdentities: (...a: unknown[]) => listAccountIdentities(...a),
}))

vi.mock('../../ledger/roles/role-map', () => ({
  listChartAccounts: vi.fn(),
}))

const resolveAccountingProvider = vi.fn()
vi.mock('../provider', () => ({
  resolveAccountingProvider: (...a: unknown[]) => resolveAccountingProvider(...a),
  supportsCreatingProviderAccounts: (provider: { createProviderAccount?: unknown }) =>
    typeof provider.createProviderAccount === 'function',
}))

const onCacheEvent = vi.fn()
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  onCacheEvent: (...a: unknown[]) => onCacheEvent(...a),
}))

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import type { AccountIdentityRow, ChartAccountRow, ProviderAccount } from '../../ledger/types'
import { createProviderAccounts } from '../create-provider-accounts'
import type { CreateProviderAccountInput } from '../provider'

const ORG = 'org1'
const db = {} as Database

function account(overrides: Partial<ChartAccountRow> & { id: string }): ChartAccountRow {
  return {
    code: null,
    name: overrides.id,
    accountType: 'revenue',
    isActive: true,
    subtype: null,
    parentId: null,
    ...overrides,
  }
}

// Coded, so chart order (code, then name) is the order the assertions below pin.
const SALES = account({ id: 'gl_sales', code: '4000', name: 'Sales' })
const PRODUCT_INCOME = account({
  id: 'gl_product',
  code: '4020',
  name: 'Product Income',
  parentId: 'gl_sales',
})
const OTHER = account({ id: 'gl_other', code: '4900', name: 'Other Revenue' })

function providerAccount(overrides: Partial<ProviderAccount> & { id: string }): ProviderAccount {
  return {
    name: overrides.id,
    fullyQualifiedName: overrides.id,
    number: null,
    accountType: 'Income',
    classification: 'revenue',
    active: true,
    parentId: null,
    ...overrides,
  }
}

function identity(row: ChartAccountRow, overrides: Partial<AccountIdentityRow> = {}) {
  return {
    account: row,
    state: 'unmapped' as const,
    providerAccountId: null,
    providerAccountName: null,
    providerAccountNumber: null,
    source: null,
    confirmedAt: null,
    liveProviderAccount: null,
    suggestion: null,
    ...overrides,
  }
}

function identities(rows: AccountIdentityRow[]) {
  return ok({ providerId: 'stub', canCreateProviderAccounts: true, rows, broken: [] })
}

/** A provider that can create, answering `qbo_<glAccountId>` in the section asked for. */
function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stub',
    listAccountMappings: vi.fn(async () => ok(new Map<string, string>())),
    setAccountMapping: vi.fn(async () => ok(undefined)),
    createProviderAccount: vi.fn(async (input: CreateProviderAccountInput) =>
      ok({
        account: providerAccount({
          id: `qbo_${input.glAccountId}`,
          classification: input.classification,
          parentId: input.parentProviderId ?? null,
        }),
        outcome: 'created' as const,
        numberDropped: false,
      })
    ),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createProviderAccounts', () => {
  it('sends parents first, pulls in the unlinked parent, nests the child under what came back, and emits once', async () => {
    listAccountIdentities.mockResolvedValue(
      identities([identity(SALES), identity(PRODUCT_INCOME), identity(OTHER)])
    )
    const p = provider()
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createProviderAccounts(db, {
      organizationId: ORG,
      glAccountIds: ['gl_other', 'gl_product'],
      actorUserId: 'user1',
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(p.createProviderAccount.mock.calls.map(([input]) => input.glAccountId)).toEqual([
      'gl_sales',
      'gl_product',
      'gl_other',
    ])
    // The parent's id is the one the provider JUST returned, not one read back.
    expect(p.createProviderAccount).toHaveBeenCalledWith(
      expect.objectContaining({ glAccountId: 'gl_product', parentProviderId: 'qbo_gl_sales' })
    )
    expect(value.created.map((row) => row.row.account.id)).toEqual([
      'gl_sales',
      'gl_product',
      'gl_other',
    ])
    expect(value.ancestorsAdded).toEqual(['gl_sales'])
    expect(value.skipped).toEqual([])
    expect(value.failed).toBeUndefined()
    expect(p.setAccountMapping).toHaveBeenCalledTimes(3)
    // 🛑 One re-read of the provider chart for the run, not one per account.
    expect(onCacheEvent).toHaveBeenCalledTimes(1)
    expect(onCacheEvent).toHaveBeenCalledWith('accounting.provider-chart.changed', { orgId: ORG })
  })

  it('reports what it skips, by reason, and never asks the provider for them', async () => {
    listAccountIdentities.mockResolvedValue(
      identities([
        identity(SALES, { state: 'confirmed', providerAccountId: 'qbo_sales' }),
        identity(PRODUCT_INCOME, {
          suggestion: { account: providerAccount({ id: 'qbo_x' }), reason: 'name' },
        }),
        identity(OTHER),
      ])
    )
    const p = provider()
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createProviderAccounts(db, {
      organizationId: ORG,
      glAccountIds: ['gl_sales', 'gl_product', 'gl_nope', 'gl_other'],
    })

    const value = result._unsafeUnwrap()
    expect(p.createProviderAccount.mock.calls.map(([input]) => input.glAccountId)).toEqual([
      'gl_other',
    ])
    expect(value.skipped).toEqual([
      { glAccountId: 'gl_sales', reason: 'linked' },
      { glAccountId: 'gl_product', reason: 'suggested' },
      { glAccountId: 'gl_nope', reason: 'not_in_chart' },
    ])
    expect(value.ancestorsAdded).toEqual([])
  })

  it('halts at the first refusal, keeps what landed, names the row, and still emits once', async () => {
    listAccountIdentities.mockResolvedValue(
      identities([identity(SALES), identity(PRODUCT_INCOME), identity(OTHER)])
    )
    const p = provider({
      createProviderAccount: vi.fn(async (input: CreateProviderAccountInput) =>
        input.glAccountId === 'gl_product'
          ? err(new Error('2 QuickBooks accounts already match by name'))
          : ok({
              account: providerAccount({ id: `qbo_${input.glAccountId}` }),
              outcome: 'created' as const,
              numberDropped: false,
            })
      ),
    })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createProviderAccounts(db, {
      organizationId: ORG,
      glAccountIds: ['gl_sales', 'gl_product', 'gl_other'],
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.created.map((row) => row.row.account.id)).toEqual(['gl_sales'])
    expect(value.failed).toEqual({
      glAccountId: 'gl_product',
      message: '2 QuickBooks accounts already match by name',
    })
    // The row after the failure is never sent - the run stops, it does not press on.
    expect(p.createProviderAccount).toHaveBeenCalledTimes(2)
    expect(p.setAccountMapping).toHaveBeenCalledTimes(1)
    expect(onCacheEvent).toHaveBeenCalledTimes(1)
  })

  it('refuses a provider that cannot create accounts, before reading anything', async () => {
    resolveAccountingProvider.mockResolvedValue(provider({ createProviderAccount: undefined }))

    const result = await createProviderAccounts(db, {
      organizationId: ORG,
      glAccountIds: ['gl_sales'],
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('cannot have accounts added')
    expect(listAccountIdentities).not.toHaveBeenCalled()
    expect(onCacheEvent).not.toHaveBeenCalled()
  })

  it("uses the provider's connection-bound creator, opened once, when it offers one", async () => {
    listAccountIdentities.mockResolvedValue(identities([identity(SALES), identity(OTHER)]))
    const bound = provider()
    const open = vi.fn(async () =>
      ok({
        createProviderAccount: bound.createProviderAccount,
        setAccountMapping: bound.setAccountMapping,
      })
    )
    const p = provider({ openProviderAccountCreator: open })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createProviderAccounts(db, {
      organizationId: ORG,
      glAccountIds: ['gl_sales', 'gl_other'],
      actorUserId: 'user1',
    })

    expect(result.isOk()).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith({ orgId: ORG, actorUserId: 'user1' })
    expect(bound.createProviderAccount).toHaveBeenCalledTimes(2)
    expect(bound.setAccountMapping).toHaveBeenCalledTimes(2)
    // The per-call methods, which would resolve the connection each time, are not touched.
    expect(p.createProviderAccount).not.toHaveBeenCalled()
    expect(p.setAccountMapping).not.toHaveBeenCalled()
  })

  it('emits nothing when nothing was sent', async () => {
    listAccountIdentities.mockResolvedValue(
      identities([identity(SALES, { state: 'confirmed', providerAccountId: 'qbo_sales' })])
    )
    const p = provider()
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createProviderAccounts(db, {
      organizationId: ORG,
      glAccountIds: ['gl_sales'],
    })

    expect(result._unsafeUnwrap()).toEqual({
      created: [],
      skipped: [{ glAccountId: 'gl_sales', reason: 'linked' }],
      ancestorsAdded: [],
    })
    expect(p.createProviderAccount).not.toHaveBeenCalled()
    expect(onCacheEvent).not.toHaveBeenCalled()
  })
})
