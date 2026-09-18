// packages/lib/src/accounting/ledger/roles/__tests__/source-scope.test.ts
//
// Task 47 §3 and §7.4: WHICH sources a role map may be scoped to, and which AXIS
// each one carries. Widened by task 58 §3 rule 6 (59 V1): the RAIL axis moved
// off this table entirely, onto the org's own `payment_gateway` records.
//
// Three things are easy to get wrong here and all are silent:
//
//  1. **The STORE axis cannot be derived from `providerKey`.** Shopify is a
//     storefront, so a row reached through `FinancialSourceObject` is a store.
//     `providerKey` alone does not settle it - a merchant account can share a
//     provider with a storefront and carry no store evidence at all.
//  2. **The manual bucket is a row, not a null.** It has to satisfy the existing
//     identity check and unique index without any schema change, and it has to
//     stay invisible to every other reader of `FinancialSourceAccount` - all of
//     which either filter `providerKey` or join in from an evidence row, and a
//     row with no evidence pointing at it is invisible to all of them (§3.1).
//  3. **A rail is never a `FinancialSourceAccount` row any more.** It is a live
//     `payment_gateway` EntityInstance, read through a separate module
//     (`payment-gateways/reads.ts`, mocked below) and appended to the same
//     list, always on the `rail` axis alone.

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gatewayStub = vi.hoisted(() => ({ rows: [] as Array<{ id: string; name: string }> }))
vi.mock('../../../rails/reads', () => ({
  listPaymentGateways: vi.fn(async () => {
    const { ok } = await import('neverthrow')
    return ok(gatewayStub.rows)
  }),
}))

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
  /** `FinancialSourceAccount.name` (#2178). Null until somebody names the account. */
  name?: string | null
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
  /** Filled with the `where` clause each table's query was given, so a test can
   *  assert on a predicate this stub is too dumb to evaluate. */
  captured?: Map<unknown, unknown>
}) {
  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.FinancialSourceAccount) return input.accounts
    if (table === schema.FinancialSourceObject) return (input.storeIds ?? []).map((id) => ({ id }))
    return []
  }

  // biome-ignore lint/suspicious/noExplicitAny: a hand-written query stub
  const chainFor = (table: unknown): any => {
    // biome-ignore lint/suspicious/noExplicitAny: a hand-written query stub
    const chain: any = {
      where: (clause: unknown) => {
        input.captured?.set(table, clause)
        return chain
      },
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

beforeEach(() => {
  gatewayStub.rows = []
})

describe('listRoleSources - the STORE axis comes from evidence', () => {
  it('reads a source with order evidence as a STORE', async () => {
    const rows = await listRoleSources(stubDb({ accounts: [SHOPIFY], storeIds: [SHOPIFY.id] }), ORG)
    expect(rows).toEqual([expect.objectContaining({ id: SHOPIFY.id, axes: ['store'] })])
  })

  // 🛑 The regression this filter exists for. `FinancialSourceObject` holds BOTH
  // sides of the business: a Shopify Payments account carries 1,749
  // `balance_transaction` rows and 262 `payout` rows and not one order. An
  // unfiltered lookup therefore read it as a storefront and offered a payment
  // processor under Product Revenue - which 47 §7.4 forbids outright, and which
  // was worse than cosmetic: a fulfillment's `sourceStoreId` resolves to the
  // STORE account, so any override saved against the payments account could
  // never match and the revenue silently kept using the org default.
  //
  // The stub cannot evaluate a predicate, so this asserts the predicate itself.
  it('asks only for STOREFRONT evidence, never a processor object type', async () => {
    const captured = new Map<unknown, unknown>()
    await listRoleSources(stubDb({ accounts: [SHOPIFY], captured }), ORG)

    const where = JSON.stringify(captured.get(schema.FinancialSourceObject) ?? null)
    expect(where).toContain('order_transaction')
    // Native Stripe writes these for customer money - still the store side.
    expect(where).toContain('charge')
    expect(where).toContain('refund')
    // The processor side must not be able to earn a store axis.
    expect(where).not.toContain('balance_transaction')
    expect(where).not.toContain('payout')
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
      'Amazon · A1B2C3',
      SHOPIFY.externalAccountId,
    ])
  })

  // 🔑 The row's label comes from `sourceAccountLabel`, the same helper the
  // settlement list and the processor activity row use, so one account reads the
  // same everywhere. 47 §13.6 predates the `name` column (#2178) and no longer
  // describes this: the derivation is now the FALLBACK, not the only rule.
  //
  // For Shopify the derivation is still the external id verbatim - a shop domain
  // already IS the account's name, which is why `receipt-accounting.ts` renders
  // it as `storeDomain`.
  it('names an unnamed Shopify connection by its shop domain', async () => {
    const rows = await listRoleSources(stubDb({ accounts: [SHOPIFY], storeIds: [SHOPIFY.id] }), ORG)
    expect(rows[0]).toMatchObject({
      name: 'auxx-lift.myshopify.com',
      providerKey: 'shopify',
      externalAccountId: 'auxx-lift.myshopify.com',
      isManual: false,
    })
  })

  // Every other provider gets the key beside the id, so `acct_1ABC` is not left
  // to stand on its own as though it were a word. Store evidence here only
  // because the derivation is store-side machinery; the fact under test is the
  // label, not the axis.
  it('qualifies an unnamed non-Shopify connection with its provider', async () => {
    const rows = await listRoleSources(stubDb({ accounts: [STRIPE], storeIds: [STRIPE.id] }), ORG)
    expect(rows[0]?.name).toBe('Stripe · acct_1ABC')
  })

  // 🛑 A name somebody typed wins over every derivation, including the
  // shop-domain case above: showing the domain instead would revert their
  // choice. `externalAccountId` is untouched - it stays the machine identity.
  it('prefers the name somebody gave the account over the derivation', async () => {
    const named = { ...SHOPIFY, name: 'Main US store' }
    const rows = await listRoleSources(stubDb({ accounts: [named], storeIds: [named.id] }), ORG)
    expect(rows[0]).toMatchObject({
      name: 'Main US store',
      externalAccountId: 'auxx-lift.myshopify.com',
    })
  })
})

describe('listRoleSources - the RAIL axis comes from payment_gateway records (58 §3 rule 6)', () => {
  it('lists every live payment gateway on the rail axis', async () => {
    gatewayStub.rows = [{ id: 'pg_stripe', name: 'Stripe' }]
    const rows = await listRoleSources(stubDb({ accounts: [] }), ORG)
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'pg_stripe',
        name: 'Stripe',
        axes: ['rail'],
        isManual: false,
      }),
    ])
  })

  // A gateway's id lives in a different table and id space than any
  // `FinancialSourceAccount` - so a storefront that also happens to be a rail
  // (Shopify, whose payments arm is its own `payment_gateway` record) shows up
  // as TWO rows now, never one row carrying both axes.
  it('lists a storefront and its own rail as two separate rows', async () => {
    gatewayStub.rows = [{ id: 'pg_shopify_payments', name: 'Shopify Payments' }]
    const rows = await listRoleSources(stubDb({ accounts: [SHOPIFY], storeIds: [SHOPIFY.id] }), ORG)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: SHOPIFY.id, axes: ['store'] }),
        expect.objectContaining({ id: 'pg_shopify_payments', axes: ['rail'] }),
      ])
    )
    expect(rows).toHaveLength(2)
  })

  it('offers no rail at all for an org with no payment gateways', async () => {
    const rows = await listRoleSources(stubDb({ accounts: [] }), ORG)
    expect(rows).toEqual([])
  })

  // Manual still sorts first; a rail sorts among the connections by name, the
  // same rule `pins manual first, then sorts connections by name` pins for stores.
  it('sorts a rail into the same name order as the connections', async () => {
    gatewayStub.rows = [{ id: 'pg_stripe', name: 'Stripe' }]
    const rows = await listRoleSources(
      stubDb({ accounts: [MANUAL, AMAZON], storeIds: [AMAZON.id] }),
      ORG
    )
    expect(rows.map((row) => row.name)).toEqual([MANUAL_SOURCE_LABEL, 'Amazon · A1B2C3', 'Stripe'])
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
