// packages/lib/src/accounting/providers/__tests__/create-provider-account.test.ts
//
// `create-provider-account.ts` runs the seam BACKWARDS, and like
// `account-identities.ts` it is provider-neutral - what is stubbed here is an
// `AccountingProvider`, never QuickBooks. The QuickBooks-shaped half of this
// (which account type a create asks for) is `money/quickbooks/account-types.ts`
// and is tested beside it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listChartAccounts = vi.fn()
vi.mock('../../ledger/roles/role-map', () => ({
  listChartAccounts: (...a: unknown[]) => listChartAccounts(...a),
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
import type { ChartAccountRow, ProviderAccount } from '../../ledger/types'
import { createAndLinkProviderAccount } from '../create-provider-account'

const ORG = 'org1'
const db = {} as Database

const CLEARING: ChartAccountRow = {
  id: 'gl1200',
  code: '1200',
  name: 'Card Clearing',
  accountType: 'asset',
  isActive: true,
  subtype: null,
  parentId: null,
}

const CREATED: ProviderAccount = {
  id: 'qbo104',
  name: 'Card Clearing',
  fullyQualifiedName: 'Card Clearing',
  number: '1200',
  accountType: 'Other Current Asset',
  classification: 'asset',
  active: true,
  parentId: null,
}

const SALES: ChartAccountRow = {
  id: 'gl_sales',
  code: null,
  name: 'Sales',
  accountType: 'revenue',
  isActive: true,
  subtype: null,
  parentId: null,
}

const PRODUCT_INCOME: ChartAccountRow = {
  id: 'gl_product_income',
  code: null,
  name: 'Product Income',
  accountType: 'revenue',
  isActive: true,
  subtype: null,
  parentId: 'gl_sales',
}

/** A provider that can create, with every call spied on. */
function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stub',
    listAccountMappings: vi.fn(async () => ok(new Map<string, string>())),
    setAccountMapping: vi.fn(async () => ok(undefined)),
    createProviderAccount: vi.fn(async (_input: { glAccountId: string }) =>
      ok({ account: CREATED, outcome: 'created' as const, numberDropped: false })
    ),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listChartAccounts.mockResolvedValue(ok([CLEARING]))
})

describe('createAndLinkProviderAccount - the happy path', () => {
  it('describes the account in OUR vocabulary and links what comes back', async () => {
    const p = provider()
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl1200',
      actorUserId: 'user1',
    })

    expect(result.isOk()).toBe(true)
    // 🛑 The whole of `P2` in one assertion: what crosses into the adapter is
    // name/code/classification/subtype and nothing that names a provider's own
    // type vocabulary. A field like `accountSubType` appearing here would mean
    // QuickBooks had leaked one layer up.
    expect(p.createProviderAccount).toHaveBeenCalledWith({
      orgId: ORG,
      glAccountId: 'gl1200',
      name: 'Card Clearing',
      code: '1200',
      classification: 'asset',
      subtype: null,
      actorUserId: 'user1',
    })
    expect(p.setAccountMapping).toHaveBeenCalledWith({
      orgId: ORG,
      glAccountId: 'gl1200',
      providerAccountId: 'qbo104',
      actorUserId: 'user1',
    })

    const value = result._unsafeUnwrap()
    expect(value.row.state).toBe('confirmed')
    expect(value.row.providerAccountId).toBe('qbo104')
    expect(value.outcome).toBe('created')
    // The provider now holds a row the cached provider chart does not (84 §7.4).
    expect(onCacheEvent).toHaveBeenCalledWith('accounting.provider-chart.changed', { orgId: ORG })
  })

  it('carries `existing` and `numberDropped` through instead of flattening them', async () => {
    // Both are true and the call still SUCCEEDS - neither is a failure. They
    // exist so the screen can say something other than "created it", which is
    // what it would otherwise have to imply.
    const p = provider({
      createProviderAccount: vi.fn(async () =>
        ok({
          account: { ...CREATED, number: null },
          outcome: 'existing' as const,
          numberDropped: true,
        })
      ),
    })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl1200',
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().outcome).toBe('existing')
    expect(result._unsafeUnwrap().numberDropped).toBe(true)
    expect(p.setAccountMapping).toHaveBeenCalled()
  })

  it('sends a null code rather than inventing one for an uncoded account', async () => {
    listChartAccounts.mockResolvedValue(ok([{ ...CLEARING, code: null }]))
    const p = provider()
    resolveAccountingProvider.mockResolvedValue(p)

    await createAndLinkProviderAccount(db, { organizationId: ORG, glAccountId: 'gl1200' })

    expect(p.createProviderAccount).toHaveBeenCalledWith(expect.objectContaining({ code: null }))
  })
})

describe('createAndLinkProviderAccount - what it refuses, and writes nothing', () => {
  it('refuses a provider that cannot create accounts at all', async () => {
    // The optional method absent IS the capability answer. Nothing is attempted.
    const p = provider({ createProviderAccount: undefined })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl1200',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('cannot have accounts added')
    expect(p.setAccountMapping).not.toHaveBeenCalled()
  })

  it('refuses an account that is not in this org chart', async () => {
    const p = provider()
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl9999',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('gl9999')
    expect(p.createProviderAccount).not.toHaveBeenCalled()
  })

  it('refuses an account that is ALREADY linked, before asking the provider', async () => {
    // 🛑 The double-click guard. Without it a second click asks for a second
    // counterpart to an account that has one, and whether that ends as a
    // duplicate in somebody's books depends on the adapter being careful.
    const p = provider({
      listAccountMappings: vi.fn(async () => ok(new Map([['gl1200', 'qbo55']]))),
    })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl1200',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('already linked')
    expect(p.createProviderAccount).not.toHaveBeenCalled()
  })

  it('does NOT link an account whose statement section disagrees with ours', async () => {
    // The case that matters: the adapter REUSED an account it matched by name,
    // and the match is in the wrong half of the books. Linking it would post
    // asset movements into a revenue account - an entry that balances and
    // misstates the P&L, which nothing downstream can catch.
    const p = provider({
      createProviderAccount: vi.fn(async () =>
        ok({
          account: { ...CREATED, classification: 'revenue' as const },
          outcome: 'existing' as const,
          numberDropped: false,
        })
      ),
    })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl1200',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('balance')
    expect(p.setAccountMapping).not.toHaveBeenCalled()
  })

  it('does NOT link an inactive account the provider handed back', async () => {
    const p = provider({
      createProviderAccount: vi.fn(async () =>
        ok({
          account: { ...CREATED, active: false },
          outcome: 'existing' as const,
          numberDropped: false,
        })
      ),
    })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl1200',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('deactivated')
    expect(p.setAccountMapping).not.toHaveBeenCalled()
  })

  it("surfaces the adapter's own refusal verbatim rather than a generic one", async () => {
    // A duplicate the adapter could not settle reads as Intuit's sentence,
    // because "resolve this in QuickBooks" is advice only that sentence carries.
    const p = provider({
      createProviderAccount: vi.fn(async () =>
        err(new Error('2 QuickBooks accounts already match by name'))
      ),
    })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl1200',
    })

    expect(result._unsafeUnwrapErr().message).toContain('already match by name')
    expect(p.setAccountMapping).not.toHaveBeenCalled()
  })
})

describe('createAndLinkProviderAccount - a sub-account (CHART-HIERARCHY §6)', () => {
  it("refuses when the parent has no counterpart yet, naming it and 'first'", async () => {
    listChartAccounts.mockResolvedValue(ok([SALES, PRODUCT_INCOME]))
    const p = provider()
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl_product_income',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('Sales')
    expect(result._unsafeUnwrapErr().message).toContain('first')
    expect(p.createProviderAccount).not.toHaveBeenCalled()
  })

  it('passes the resolved parentProviderId once the parent is mapped', async () => {
    listChartAccounts.mockResolvedValue(ok([SALES, PRODUCT_INCOME]))
    const p = provider({
      listAccountMappings: vi.fn(async () => ok(new Map([['gl_sales', 'qbo_sales']]))),
      createProviderAccount: vi.fn(async () =>
        ok({
          account: {
            ...CREATED,
            id: 'qbo_product_income',
            name: 'Product Income',
            fullyQualifiedName: 'Sales:Product Income',
            classification: 'revenue' as const,
            parentId: 'qbo_sales',
          },
          outcome: 'created' as const,
          numberDropped: false,
        })
      ),
    })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl_product_income',
    })

    expect(result.isOk()).toBe(true)
    expect(p.createProviderAccount).toHaveBeenCalledWith(
      expect.objectContaining({ glAccountId: 'gl_product_income', parentProviderId: 'qbo_sales' })
    )
  })

  it('creates the unlinked parent FIRST and nests the child under what came back', async () => {
    listChartAccounts.mockResolvedValue(ok([SALES, PRODUCT_INCOME]))
    const p = provider({
      createProviderAccount: vi.fn(async (input: { glAccountId: string }) =>
        ok({
          account:
            input.glAccountId === 'gl_sales'
              ? {
                  ...CREATED,
                  id: 'qbo_sales',
                  name: 'Sales',
                  fullyQualifiedName: 'Sales',
                  number: null,
                  classification: 'revenue' as const,
                }
              : {
                  ...CREATED,
                  id: 'qbo_product_income',
                  name: 'Product Income',
                  fullyQualifiedName: 'Sales:Product Income',
                  number: null,
                  classification: 'revenue' as const,
                  parentId: 'qbo_sales',
                },
          outcome: 'created' as const,
          numberDropped: false,
        })
      ),
    })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl_product_income',
      includeAncestors: true,
    })

    expect(result.isOk()).toBe(true)
    const calls = p.createProviderAccount.mock.calls.map(([input]) => input.glAccountId)
    expect(calls).toEqual(['gl_sales', 'gl_product_income'])
    // The parent's id is the one the provider JUST returned, not one read back.
    expect(p.createProviderAccount).toHaveBeenLastCalledWith(
      expect.objectContaining({ glAccountId: 'gl_product_income', parentProviderId: 'qbo_sales' })
    )
    const value = result._unsafeUnwrap()
    expect(value.row.providerAccountId).toBe('qbo_product_income')
    expect(value.ancestors.map((created) => created.row.account.id)).toEqual(['gl_sales'])
  })

  it('leaves an ancestor that is already linked alone', async () => {
    listChartAccounts.mockResolvedValue(ok([SALES, PRODUCT_INCOME]))
    const p = provider({
      listAccountMappings: vi.fn(async () => ok(new Map([['gl_sales', 'qbo_sales']]))),
      createProviderAccount: vi.fn(async () =>
        ok({
          account: {
            ...CREATED,
            id: 'qbo_product_income',
            name: 'Product Income',
            fullyQualifiedName: 'Sales:Product Income',
            number: null,
            classification: 'revenue' as const,
            parentId: 'qbo_sales',
          },
          outcome: 'created' as const,
          numberDropped: false,
        })
      ),
    })
    resolveAccountingProvider.mockResolvedValue(p)

    const result = await createAndLinkProviderAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl_product_income',
      includeAncestors: true,
    })

    expect(result.isOk()).toBe(true)
    expect(p.createProviderAccount).toHaveBeenCalledTimes(1)
    expect(result._unsafeUnwrap().ancestors).toEqual([])
  })
})
