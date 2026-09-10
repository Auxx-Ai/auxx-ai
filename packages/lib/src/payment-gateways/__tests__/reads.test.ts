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
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: async (_org: string, entityType: string) =>
    entityType === 'payment_gateway' ? 'def_pg' : null,
  getOrgCache: () => ({
    from: () => ({
      // Every attribute resolves to a field whose id IS the attribute name.
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((attr) => [attr, { id: attr }])),
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
  return { select: () => stage(state.script[call++] ?? []) } as never
}

const ORG = 'org_1'

beforeEach(() => {
  state.script.length = 0
})

const { getPaymentGateway, listPaymentGateways } = await import('../reads')

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
