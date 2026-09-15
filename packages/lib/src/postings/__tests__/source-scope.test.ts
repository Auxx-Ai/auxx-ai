// packages/lib/src/postings/__tests__/source-scope.test.ts
//
// Task 47 §3 and §7.4: WHICH sources a role map may be scoped to, and which AXIS
// each one carries.
//
// Two things are easy to get wrong here and both are silent:
//
//  1. **The axis cannot be derived from `providerKey`.** Shopify is a storefront
//     AND a processor (Shopify Payments), so the key does not settle it. The
//     evidence does: a row reached through `FinancialSourceObject` is a store, a
//     row carrying processor balance entries or payouts is a merchant account,
//     and a row can be BOTH.
//  2. **The manual bucket is a row, not a null.** It has to satisfy the existing
//     identity check and unique index without any schema change, and it has to
//     stay invisible to every other reader of `FinancialSourceAccount` - all of
//     which either filter `providerKey` or join in from an evidence row, and a
//     row with no evidence pointing at it is invisible to all of them (§3.1).

import { type Database, schema } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'

import {
  listRoleSources,
  MANUAL_SOURCE_EXTERNAL_ID,
  MANUAL_SOURCE_LABEL,
  MANUAL_SOURCE_PROVIDER_KEY,
  readLiveSourceAccountIds,
} from '../source-scope'

const ORG = 'org_1'

interface Row {
  id: string
  providerKey: string
  externalAccountId: string
}

const SHOPIFY: Row = {
  id: 'fsa_shopify',
  providerKey: 'shopify',
  externalAccountId: 'auxx-lift.myshopify.com',
}
const AMAZON: Row = { id: 'fsa_amazon', providerKey: 'amazon', externalAccountId: 'A1B2C3' }
const STRIPE: Row = { id: 'fsa_stripe', providerKey: 'stripe', externalAccountId: 'acct_1ABC' }
const MANUAL: Row = {
  id: 'fsa_manual',
  providerKey: MANUAL_SOURCE_PROVIDER_KEY,
  externalAccountId: MANUAL_SOURCE_EXTERNAL_ID,
}

function stubDb(input: {
  accounts: Row[]
  storeIds?: string[]
  balanceIds?: string[]
  transferIds?: string[]
}) {
  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.FinancialSourceAccount) return input.accounts
    if (table === schema.FinancialSourceObject) return (input.storeIds ?? []).map((id) => ({ id }))
    if (table === schema.ProcessorBalanceEntry)
      return (input.balanceIds ?? []).map((id) => ({ id }))
    if (table === schema.MoneyTransfer) return (input.transferIds ?? []).map((id) => ({ id }))
    return []
  }

  // biome-ignore lint/suspicious/noExplicitAny: a hand-written query stub
  const chainFor = (table: unknown): any => {
    // biome-ignore lint/suspicious/noExplicitAny: a hand-written query stub
    const chain: any = {
      where: () => chain,
      limit: () => chain,
      orderBy: () => chain,
      // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(rowsFor(table)).then(resolve, reject),
    }
    return chain
  }

  return {
    select: () => ({ from: (table: unknown) => chainFor(table) }),
    selectDistinct: () => ({ from: (table: unknown) => chainFor(table) }),
  } as unknown as Database
}

describe('listRoleSources - the axis comes from the evidence', () => {
  it('reads a source with order evidence as a STORE', async () => {
    const rows = await listRoleSources(stubDb({ accounts: [SHOPIFY], storeIds: [SHOPIFY.id] }), ORG)
    expect(rows).toEqual([expect.objectContaining({ id: SHOPIFY.id, axes: ['store'] })])
  })

  it('reads a source with settlement evidence as a PROCESSOR', async () => {
    const rows = await listRoleSources(stubDb({ accounts: [STRIPE], balanceIds: [STRIPE.id] }), ORG)
    expect(rows).toEqual([expect.objectContaining({ id: STRIPE.id, axes: ['processor'] })])
  })

  it('counts a payout as settlement evidence too', async () => {
    const rows = await listRoleSources(
      stubDb({ accounts: [STRIPE], transferIds: [STRIPE.id] }),
      ORG
    )
    expect(rows[0]?.axes).toEqual(['processor'])
  })

  // 🛑 Shopify Payments. The one row is both a storefront and a merchant
  // account, and it has to appear under both - a revenue role AND the fee role
  // may legitimately name it.
  it('reads a source with both kinds of evidence as BOTH', async () => {
    const rows = await listRoleSources(
      stubDb({ accounts: [SHOPIFY], storeIds: [SHOPIFY.id], balanceIds: [SHOPIFY.id] }),
      ORG
    )
    expect(rows[0]?.axes).toEqual(['store', 'processor'])
  })

  // A live account nothing has ever flowed through carries no axis, so there is
  // no role it could be offered under. Dropped rather than listed under both - a
  // picker offering a source that cannot post is a question with no answer.
  it('drops a source with no evidence at all', async () => {
    const rows = await listRoleSources(stubDb({ accounts: [AMAZON] }), ORG)
    expect(rows).toEqual([])
  })

  // 🔑 The sentinel is a STORE and needs no evidence: it is the bucket for
  // records that have none, so requiring some would make it permanently invisible.
  it('always offers the manual bucket, on the store axis, with no evidence', async () => {
    const rows = await listRoleSources(stubDb({ accounts: [MANUAL] }), ORG)
    expect(rows).toEqual([
      expect.objectContaining({ id: MANUAL.id, axes: ['store'], isManual: true }),
    ])
  })

  // ⚠️ Manual is pinned FIRST. Sorting by `providerKey` would bury `auxx`
  // between `amazon` and `shopify` - a sort order that hides the one row every
  // org has.
  it('pins manual first, then sorts connections by name', async () => {
    const rows = await listRoleSources(
      stubDb({
        accounts: [SHOPIFY, MANUAL, AMAZON],
        storeIds: [SHOPIFY.id, AMAZON.id],
      }),
      ORG
    )
    expect(rows.map((row) => row.name)).toEqual([
      MANUAL_SOURCE_LABEL,
      AMAZON.externalAccountId,
      SHOPIFY.externalAccountId,
    ])
  })

  // The external id IS the human-readable identity for a connected source -
  // Shopify's is the shop domain, which `receipt-accounting.ts` already renders
  // as `storeDomain`. No name column is added by this brief (§13.6).
  it('names a connection by its own external id, and carries the provider beside it', async () => {
    const rows = await listRoleSources(stubDb({ accounts: [SHOPIFY], storeIds: [SHOPIFY.id] }), ORG)
    expect(rows[0]).toMatchObject({
      name: 'auxx-lift.myshopify.com',
      providerKey: 'shopify',
      externalAccountId: 'auxx-lift.myshopify.com',
      isManual: false,
    })
  })
})

describe('readLiveSourceAccountIds', () => {
  it('asks nothing of the database for an empty list', async () => {
    const select = vi.fn()
    const ids = await readLiveSourceAccountIds({ select } as unknown as Database, ORG, [])
    expect(ids.size).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })

  it('answers the ids the query returned, as a set', async () => {
    const ids = await readLiveSourceAccountIds(stubDb({ accounts: [SHOPIFY] }), ORG, [
      SHOPIFY.id,
      'fsa_gone',
    ])
    expect([...ids]).toEqual([SHOPIFY.id])
  })
})
