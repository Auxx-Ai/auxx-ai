// packages/lib/src/postings/__tests__/create-provider-account.test.ts
//
// `create-provider-account.ts` runs the seam BACKWARDS, and like
// `account-identities.ts` it is provider-neutral - what is stubbed here is an
// `AccountingProvider`, never QuickBooks. The QuickBooks-shaped half of this
// (which account type a create asks for) is `money/quickbooks/account-types.ts`
// and is tested beside it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listChartAccounts = vi.fn()
vi.mock('../role-map', () => ({
  listChartAccounts: (...a: unknown[]) => listChartAccounts(...a),
}))

const resolveAccountingProvider = vi.fn()
vi.mock('../provider', () => ({
  resolveAccountingProvider: (...a: unknown[]) => resolveAccountingProvider(...a),
  supportsCreatingProviderAccounts: (provider: { createProviderAccount?: unknown }) =>
    typeof provider.createProviderAccount === 'function',
}))

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { createAndLinkProviderAccount } from '../create-provider-account'
import type { ChartAccountRow, ProviderAccount } from '../types'

const ORG = 'org1'
const db = {} as Database

const CLEARING: ChartAccountRow = {
  id: 'gl1200',
  code: '1200',
  name: 'Card Clearing',
  accountType: 'asset',
  isActive: true,
  subtype: null,
}

const CREATED: ProviderAccount = {
  id: 'qbo104',
  name: 'Card Clearing',
  fullyQualifiedName: 'Card Clearing',
  number: '1200',
  accountType: 'Other Current Asset',
  classification: 'asset',
  active: true,
}

/** A provider that can create, with every call spied on. */
function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stub',
    listAccountMappings: vi.fn(async () => ok(new Map<string, string>())),
    setAccountMapping: vi.fn(async () => ok(undefined)),
    createProviderAccount: vi.fn(async () =>
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
