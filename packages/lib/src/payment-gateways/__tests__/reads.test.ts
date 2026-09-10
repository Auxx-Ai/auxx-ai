// packages/lib/src/payment-gateways/__tests__/reads.test.ts
//
// The one thing this hydration does that `banking/reads.ts`'s does not:
// `handles` is a multi-value TAGS field, one `FieldValue` row per handle, so
// the byInstance map has to group by (entityId, fieldId) into ARRAYS rather
// than keep the single row `hydrateBankAccounts` does for every scalar field.
// Uses the same double `banking/__tests__/reads-archived.test.ts` does
// (`docs/lib-module-guide.md` §9's "copy the reference module" rule, applied
// to its tests too).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  /** The rows each successive `db.select()` resolves to, in call order. */
  script: [] as unknown[][],
  /**
   * `options` hung on `order_payment_gateways`, for the census test that
   * exercises the connector-provisioned option path rather than free text.
   */
  gatewayFieldOptions: null as unknown,
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: async (_org: string, entityType: string) =>
    entityType === 'payment_gateway' ? 'def_pg' : null,
  getOrgCache: () => ({
    from: () => ({
      // Every attribute resolves to a field whose id IS the attribute name.
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((attr) => [
            attr,
            attr === 'order_payment_gateways'
              ? { id: attr, options: state.gatewayFieldOptions }
              : { id: attr },
          ])
        ),
    }),
  }),
}))

/** One query stage: chainable and awaitable, resolving to `rows`. */
function stage(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'orderBy', 'limit', 'where']) {
    chain[method] = () => stage(rows)
  }
  return Object.assign(Promise.resolve(rows), chain)
}

function fakeDb() {
  let call = 0
  // `selectDistinct` shares the script counter: `listObservedGatewayHandles`
  // opens with one, then `listPaymentGateways` takes the next two.
  const next = () => stage(state.script[call++] ?? [])
  return { select: next, selectDistinct: next } as never
}

const ORG = 'org_1'

beforeEach(() => {
  state.script.length = 0
  state.gatewayFieldOptions = null
})

const { getPaymentGateway, listObservedGatewayHandles, listPaymentGateways } = await import(
  '../reads'
)

describe('listPaymentGateways', () => {
  it('groups a multi-value TAGS field (handles) into an array per instance', async () => {
    state.script.push([{ id: 'pg_1', createdAt: null, updatedAt: null }])
    state.script.push([
      { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Authorize.Net' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_handles', optionId: 'authorize_net' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_handles', optionId: 'authorize.net' },
      {
        entityId: 'pg_1',
        fieldId: 'payment_gateway_clearing_account',
        valueText: 'acct_card_clearing',
      },
      { entityId: 'pg_1', fieldId: 'payment_gateway_settlement_source', optionId: 'manual' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_status', optionId: 'closed' },
    ])

    const result = await listPaymentGateways(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toHaveLength(1)
    expect(result.value[0]?.handles).toEqual(['authorize_net', 'authorize.net'])
    expect(result.value[0]?.status).toBe('closed')
    expect(result.value[0]?.settlementSource).toBe('manual')
    expect(result.value[0]?.clearingGlAccountId).toBe('acct_card_clearing')
  })

  it('falls back to valueText for a handle with no optionId, and drops a truly empty row', async () => {
    state.script.push([{ id: 'pg_1', createdAt: null, updatedAt: null }])
    state.script.push([
      { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Shopify Payments' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_handles', valueText: 'shopify_payments' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_handles', optionId: null, valueText: null },
      {
        entityId: 'pg_1',
        fieldId: 'payment_gateway_clearing_account',
        valueText: 'acct_card_clearing',
      },
    ])

    const result = await listPaymentGateways(fakeDb(), ORG)
    if (!result.isOk()) throw result.error
    expect(result.value[0]?.handles).toEqual(['shopify_payments'])
  })

  it('defaults settlementSource to manual and status to active when the fields carry nothing', async () => {
    state.script.push([{ id: 'pg_1', createdAt: null, updatedAt: null }])
    state.script.push([
      { entityId: 'pg_1', fieldId: 'payment_gateway_name', valueText: 'Affirm' },
      { entityId: 'pg_1', fieldId: 'payment_gateway_clearing_account', valueText: 'acct_affirm' },
    ])

    const result = await listPaymentGateways(fakeDb(), ORG)
    if (!result.isOk()) throw result.error
    expect(result.value[0]?.settlementSource).toBe('manual')
    expect(result.value[0]?.status).toBe('active')
    expect(result.value[0]?.feeGlAccountId).toBeNull()
  })
})

describe('getPaymentGateway', () => {
  it('returns null when the instance does not exist', async () => {
    state.script.push([])
    const result = await getPaymentGateway(fakeDb(), ORG, 'gone')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The census behind the add dialog's suggestions and the list page's
// "routed" line.
// ─────────────────────────────────────────────────────────────────────────────

describe('listObservedGatewayHandles', () => {
  /** Push the two selects `listPaymentGateways` issues for one claiming gateway. */
  function claimedBy(id: string, handles: string[]) {
    state.script.push([{ id, createdAt: null, updatedAt: null }])
    state.script.push([
      { entityId: id, fieldId: 'payment_gateway_name', valueText: id },
      { entityId: id, fieldId: 'payment_gateway_clearing_account', valueText: 'acct_1' },
      ...handles.map((handle) => ({
        entityId: id,
        fieldId: 'payment_gateway_handles',
        optionId: handle,
      })),
    ])
  }

  it('de-duplicates case-insensitively, drops the reserved handles, and marks what is claimed', async () => {
    state.script.push([
      { optionId: 'shopify_payments', valueText: null },
      // Same rail, different spelling - one row out, the first spelling seen.
      { optionId: 'Shopify_Payments', valueText: null },
      { optionId: 'authorize_net', valueText: null },
      // 🛑 Neither of these ever reaches a route: `manual` debits A/R and
      // `bogus` excludes the shipment, both before any route is consulted.
      { optionId: 'manual', valueText: null },
      { optionId: 'bogus', valueText: null },
    ])
    claimedBy('pg_shopify', ['shopify_payments'])

    const result = await listObservedGatewayHandles(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([
      { handle: 'authorize_net', claimedBy: null },
      { handle: 'shopify_payments', claimedBy: 'pg_shopify' },
    ])
  })

  it('resolves an option-keyed value through the field option list, not the raw key', async () => {
    // The connector-provisioned case: the stored value is an opaque key and the
    // label is in the field's own option set. Grouping on the key would offer a
    // handle that matches nothing a person recognises.
    state.gatewayFieldOptions = {
      options: [{ id: 'opt_1', value: 'opt_1', label: 'Authorize.Net' }],
    }
    state.script.push([{ optionId: 'opt_1', valueText: null }])
    state.script.push([])

    const result = await listObservedGatewayHandles(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([{ handle: 'Authorize.Net', claimedBy: null }])
  })

  it('reads valueText when the row carries no optionId', async () => {
    state.script.push([{ optionId: null, valueText: 'paypal' }])
    state.script.push([])

    const result = await listObservedGatewayHandles(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([{ handle: 'paypal', claimedBy: null }])
  })

  it('is empty when no order carries a gateway, without reading the gateways at all', async () => {
    state.script.push([])

    const result = await listObservedGatewayHandles(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([])
  })

  it('counts a CLOSED gateway as claiming its handles', async () => {
    // `toGatewayRoutes` keeps closed rows on purpose - a closed rail still
    // routes its own history - so its handles are routed, not orphaned.
    state.script.push([{ optionId: 'authorize_net', valueText: null }])
    state.script.push([{ id: 'pg_closed', createdAt: null, updatedAt: null }])
    state.script.push([
      { entityId: 'pg_closed', fieldId: 'payment_gateway_name', valueText: 'Authorize.Net' },
      { entityId: 'pg_closed', fieldId: 'payment_gateway_clearing_account', valueText: 'acct_1' },
      { entityId: 'pg_closed', fieldId: 'payment_gateway_handles', optionId: 'AUTHORIZE_NET' },
      { entityId: 'pg_closed', fieldId: 'payment_gateway_status', optionId: 'closed' },
    ])

    const result = await listObservedGatewayHandles(fakeDb(), ORG)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([{ handle: 'authorize_net', claimedBy: 'pg_closed' }])
  })
})
