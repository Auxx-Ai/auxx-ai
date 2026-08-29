// packages/lib/src/postings/__tests__/account-identities.test.ts
//
// `account-identities.ts` is the provider-NEUTRAL half of the `G19` account map,
// so what is stubbed here is an `AccountingProvider` rather than QuickBooks.
// That is the point of the seam: if any of these tests needed to know what a
// realm id was, the layering would be wrong.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listChartAccounts = vi.fn()
vi.mock('../role-map', () => ({
  listChartAccounts: (...a: unknown[]) => listChartAccounts(...a),
}))

const resolveAccountingProvider = vi.fn()
vi.mock('../provider', () => ({
  resolveAccountingProvider: (...a: unknown[]) => resolveAccountingProvider(...a),
}))

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import {
  confirmSuggestedIdentities,
  listAccountIdentities,
  resolveProviderAccountIds,
  setAccountIdentity,
} from '../account-identities'
import type { ChartAccountRow, ProviderAccount } from '../types'

const ORG = 'org1'
const db = {} as Database

const OUR_CHART: ChartAccountRow[] = [
  { id: 'gl1310', code: '1310', name: 'Raw Materials', accountType: 'asset', isActive: true },
  { id: 'gl2160', code: '2160', name: 'GRNI', accountType: 'liability', isActive: true },
  { id: 'gl5090', code: '5090', name: 'PPV', accountType: 'expense', isActive: true },
]

function providerAccount(over: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: '92',
    name: 'Inventory Asset',
    fullyQualifiedName: 'Inventory Asset',
    number: '1310',
    accountType: 'Other Current Asset',
    classification: 'asset',
    active: true,
    ...over,
  }
}

const THEIR_CHART = [
  providerAccount(),
  providerAccount({ id: '79', name: 'GRNI', number: '2160', classification: 'liability' }),
]

/** A provider whose four map methods answer from the arguments given. */
function stubProvider(
  options: { id?: string; accounts?: ProviderAccount[]; mappings?: Map<string, string> } = {}
) {
  // Typed as the interface returns rather than inferred from the happy path, so
  // a test can hand back an `err` without fighting the inferred `Ok<undefined>`.
  const set = vi.fn<() => Promise<Result<void, Error>>>(async () => ok(undefined))
  const clear = vi.fn<() => Promise<Result<void, Error>>>(async () => ok(undefined))
  const provider = {
    id: options.id ?? 'stub',
    accounts: options.accounts ?? THEIR_CHART,
    listProviderAccounts: async () => ok(options.accounts ?? THEIR_CHART),
    listAccountMappings: async () => ok(options.mappings ?? new Map<string, string>()),
    setAccountMapping: set,
    clearAccountMapping: clear,
  }
  resolveAccountingProvider.mockResolvedValue(provider)
  return { set, clear }
}

beforeEach(() => {
  vi.clearAllMocks()
  listChartAccounts.mockResolvedValue(ok(OUR_CHART))
})

describe('listAccountIdentities - the checklist', () => {
  it('returns a row for EVERY account, mapped or not', async () => {
    // The difference between this and a table dump: a screen that rendered only
    // the mappings that exist could never show what is missing.
    stubProvider()

    const result = await listAccountIdentities(db, ORG)

    expect(result._unsafeUnwrap().rows).toHaveLength(3)
    expect(result._unsafeUnwrap().rows.every((row) => row.state === 'unmapped')).toBe(true)
  })

  it('marks a mapped account confirmed and resolves its live provider account', async () => {
    stubProvider({ mappings: new Map([['gl1310', '92']]) })

    const row = (await listAccountIdentities(db, ORG))._unsafeUnwrap().rows[0]

    expect(row?.state).toBe('confirmed')
    expect(row?.providerAccountId).toBe('92')
    expect(row?.liveProviderAccount?.fullyQualifiedName).toBe('Inventory Asset')
    // A confirmation cannot also be a suggestion.
    expect(row?.suggestion).toBeNull()
  })

  it('attaches a suggestion to an unmapped account, with its reason', async () => {
    stubProvider()

    const rows = (await listAccountIdentities(db, ORG))._unsafeUnwrap().rows

    expect(rows[0]?.suggestion?.account.id).toBe('92')
    expect(rows[0]?.suggestion?.reason).toBe('number')
    // 5090 has no counterpart at all, so it gets a row and no proposal.
    expect(rows[2]?.suggestion).toBeNull()
  })

  it('reports a mapping whose target has vanished as broken, not as mapped', async () => {
    stubProvider({ mappings: new Map([['gl1310', 'deleted-99']]) })

    const map = (await listAccountIdentities(db, ORG))._unsafeUnwrap()

    expect(map.broken).toEqual(['1310'])
    expect(map.rows[0]?.liveProviderAccount).toBeNull()
  })

  it('reports a mapping that has drifted into another section as broken', async () => {
    stubProvider({ mappings: new Map([['gl1310', '79']]) })

    expect((await listAccountIdentities(db, ORG))._unsafeUnwrap().broken).toEqual(['1310'])
  })

  it('gives an org with nothing connected its own chart, unmapped', async () => {
    // `P1`: a chart nobody exports is still a chart, and this is not an error.
    stubProvider({ id: 'none', accounts: [] })

    const map = (await listAccountIdentities(db, ORG))._unsafeUnwrap()

    expect(map.providerId).toBe('none')
    expect(map.rows).toHaveLength(3)
    expect(map.providerAccounts).toEqual([])
    expect(map.rows.every((row) => row.suggestion === null)).toBe(true)
  })
})

describe('setAccountIdentity - the confirmation', () => {
  it('writes a legal pairing through the provider', async () => {
    const { set } = stubProvider()

    const result = await setAccountIdentity(db, {
      organizationId: ORG,
      glAccountId: 'gl1310',
      providerAccountId: '92',
      actorUserId: 'u1',
    })

    expect(result.isOk()).toBe(true)
    expect(set).toHaveBeenCalledWith({
      orgId: ORG,
      glAccountId: 'gl1310',
      providerAccountId: '92',
      actorUserId: 'u1',
    })
  })

  it('refuses a pairing across statement sections, before writing', async () => {
    // The one misposting nothing downstream can detect, because it balances.
    const { set } = stubProvider()

    const result = await setAccountIdentity(db, {
      organizationId: ORG,
      glAccountId: 'gl1310',
      providerAccountId: '79',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('liability')
    expect(set).not.toHaveBeenCalled()
  })

  it('refuses an inactive provider account, before writing', async () => {
    const { set } = stubProvider({ accounts: [providerAccount({ active: false })] })

    const result = await setAccountIdentity(db, {
      organizationId: ORG,
      glAccountId: 'gl1310',
      providerAccountId: '92',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('not active')
    expect(set).not.toHaveBeenCalled()
  })

  it('validates against the LIVE chart, not against what a screen was showing', async () => {
    const { set } = stubProvider()

    const result = await setAccountIdentity(db, {
      organizationId: ORG,
      glAccountId: 'gl1310',
      providerAccountId: 'stale-id-from-an-old-render',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('Refresh')
    expect(set).not.toHaveBeenCalled()
  })

  it('refuses an account that is not in this org', async () => {
    const { set } = stubProvider()

    const result = await setAccountIdentity(db, {
      organizationId: ORG,
      glAccountId: 'someone-elses',
      providerAccountId: '92',
    })

    expect(result.isErr()).toBe(true)
    expect(set).not.toHaveBeenCalled()
  })

  it('clears the mapping when the provider account id is null', async () => {
    const { set, clear } = stubProvider()

    const result = await setAccountIdentity(db, {
      organizationId: ORG,
      glAccountId: 'gl1310',
      providerAccountId: null,
    })

    expect(result._unsafeUnwrap().state).toBe('unmapped')
    expect(clear).toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })
})

describe('confirmSuggestedIdentities - accept all', () => {
  it('confirms every suggestion and counts them', async () => {
    const { set } = stubProvider()

    const result = await confirmSuggestedIdentities(db, { organizationId: ORG })

    expect(result._unsafeUnwrap().confirmed).toBe(2)
    expect(result._unsafeUnwrap().failures).toEqual([])
    expect(set).toHaveBeenCalledTimes(2)
  })

  it('reports partial success rather than rolling the good ones back', async () => {
    // Nineteen good mappings and one refusal beats none, and the refusal has to
    // come back named so the screen can say which.
    const { set } = stubProvider()
    set.mockImplementationOnce(async () => err(new Error('QuickBooks said no')))

    const result = await confirmSuggestedIdentities(db, { organizationId: ORG })

    expect(result._unsafeUnwrap().confirmed).toBe(1)
    expect(result._unsafeUnwrap().failures[0]).toContain('1310')
  })
})

describe('resolveProviderAccountIds - the poster read', () => {
  it('resolves confirmed codes to provider ids', async () => {
    stubProvider({ mappings: new Map([['gl1310', '92']]) })

    const result = await resolveProviderAccountIds(db, ORG, ['1310'])

    expect(result._unsafeUnwrap().get('1310')).toBe('92')
  })

  it('refuses an unmapped code and names the screen that fixes it', async () => {
    stubProvider()

    const result = await resolveProviderAccountIds(db, ORG, ['1310'])

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('not mapped')
    expect(result._unsafeUnwrapErr().message).toContain('Settings')
  })

  it('collects EVERY problem rather than stopping at the first', async () => {
    // Fixing a chart one refused post at a time is how a close slips a day.
    stubProvider()

    const result = await resolveProviderAccountIds(db, ORG, ['1310', '2160', '5090'])

    const message = result._unsafeUnwrapErr().message
    expect(message).toContain('1310')
    expect(message).toContain('2160')
    expect(message).toContain('5090')
  })

  it('refuses a code that is not in the org chart at all', async () => {
    stubProvider()

    const result = await resolveProviderAccountIds(db, ORG, ['9999'])

    expect(result._unsafeUnwrapErr().message).toContain("code '9999'")
  })
})
