// packages/lib/src/banking/feed/__tests__/fc-connect.test.ts
//
// Whose bank accounts a completion is allowed to provision.
//
// 🛑 A Financial Connections session id is a BEARER HANDLE to somebody's bank
// accounts: `start()` logs it and returns it to the browser. Reading the accounts
// back from Stripe proves the session exists; it proves nothing about who it
// belongs to. Without the check below, a caller with a valid state token for
// THEIR OWN org and another org's `fcsess_` id provisions that org's banks into
// theirs, with a live feed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: {
    accountHolderCustomerId: 'cus_org1',
    accounts: [
      {
        id: 'fca_1',
        status: 'active',
        institution_name: 'BoA',
        display_name: 'Checking',
        last4: '5381',
        category: 'cash',
        subcategory: 'checking',
        balance: { current: { usd: 100 } },
      },
    ],
  },
  storedHolder: null as string | null,
  customerOrg: null as string | null,
  subscribe: vi.fn(async () => true),
}))

vi.mock('../fc-client', () => ({
  ACCOUNT_HOLDER_METADATA_KEY: 'accountHolderCustomerId',
  createFinancialConnectionsSession: async () => ({ id: 'fcsess_1', clientSecret: 'secret' }),
  readSessionAccounts: async () => h.session,
  readStoredAccountHolderCustomerId: async () => h.storedHolder,
  readCustomerOrganizationId: async () => h.customerOrg,
  subscribeToTransactions: h.subscribe,
}))
vi.mock('../provision', () => ({ provisionBankFeed: async () => ({}) }))

const { financialConnectionsHandler } = await import('../fc-connect')

/** `complete()` is declared to allow one result or many; the FC handler always answers many. */
async function complete(
  ctx: unknown
): Promise<{ ready: boolean; connectionVariables: Record<string, string> }[]> {
  const results = await financialConnectionsHandler.complete(ctx as never)
  return (Array.isArray(results) ? results : [results]) as never
}

const CTX = {
  organizationId: 'org_1',
  userId: 'user_1',
  payload: { sessionId: 'fcsess_1' },
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.storedHolder = null
  h.customerOrg = 'org_1'
  h.session.accountHolderCustomerId = 'cus_org1'
  h.subscribe.mockResolvedValue(true)
})

describe('complete()', () => {
  it('provisions when the customer says it was minted for this org (the FIRST connect)', async () => {
    // No credential yet, so there is no stored holder to compare against. The
    // customer's own `auxxOrganizationId` is the authority - and it must NOT be
    // `resolveAccountHolderCustomerId`, which CREATES one on a miss and would
    // then compare a brand new customer against the session's and refuse.
    const results = await complete(CTX)
    expect(results).toHaveLength(1)
    expect(results[0]?.connectionVariables.accountHolderCustomerId).toBe('cus_org1')
  })

  it('🛑 refuses another org’s session id, even with a valid state token', async () => {
    h.customerOrg = 'org_2'
    await expect(financialConnectionsHandler.complete(CTX)).rejects.toThrow(
      /different account holder/i
    )
  })

  it('🛑 refuses a session whose holder is not the one this org already uses', async () => {
    h.storedHolder = 'cus_org1'
    h.session.accountHolderCustomerId = 'cus_someone_else'
    await expect(financialConnectionsHandler.complete(CTX)).rejects.toThrow(
      /different account holder/i
    )
  })

  it('accepts a session matching the org’s stored account holder with no Stripe round trip', async () => {
    h.storedHolder = 'cus_org1'
    // The customer lookup would answer the wrong org; the stored match wins and
    // it is never consulted.
    h.customerOrg = 'org_999'
    await expect(financialConnectionsHandler.complete(CTX)).resolves.toHaveLength(1)
  })

  it('refuses a session Stripe reports with no account holder at all', async () => {
    h.session.accountHolderCustomerId = null as never
    await expect(financialConnectionsHandler.complete(CTX)).rejects.toThrow(/cannot be verified/i)
  })

  it('refuses a payload that is not a session id before calling Stripe at all', async () => {
    await expect(
      financialConnectionsHandler.complete({
        ...(CTX as object),
        payload: { sessionId: 'x' },
      } as never)
    ).rejects.toThrow(/session/i)
  })

  it('reads ready off the account status AND the subscription, never off the form', async () => {
    h.subscribe.mockResolvedValue(false)
    const results = await complete(CTX)
    // An `inactive` account refuses both subscribe and refresh, so a connection
    // claiming ready would show a live status line over a dead feed.
    expect(results[0]?.ready).toBe(false)
  })
})
