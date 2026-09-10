// packages/lib/src/seed/gl-account-chart-payment-gateways.test.ts
//
// `seedDefaultPaymentGateways` (task 13 §5.3): the two default records the
// census names, seeded once the chart's clearing accounts exist. Separate
// file from `gl-account-chart.test.ts` because that one mocks
// `../resources/crud` directly, while this exercises the boundary one layer
// up - `../payment-gateways` itself - so a change to the write path's
// internals cannot silently desync the two doubles.
//
// This function is NOT called from `seedChartPacks`'s core walk (brief 16
// §1.5) - it is a separate export the router calls only when the walked packs
// include `card_rail`. That gate is a ROUTER decision, not something this
// function or `seedChartPacks` can see (neither takes a `packs` argument the
// other reads), so "gateways seed after `card_rail`, never after `['core']`"
// is pinned at the router level instead:
// `apps/web/src/server/api/routers/ledger-permissions.test.ts`'s "never seeds
// payment gateways after provisioning only core" / "seeds payment gateways
// after provisioning card_rail" cases. What THIS file still pins is what it
// always pinned: given a chart whose roles are (or are not) mapped, which
// gateways get created.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  defId: 'def-payment-gateway' as string | null,
  roleRows: [] as { role: string; glAccountId: string }[],
  existingGateways: [] as { id: string; handles: string[] }[],
  createCalls: [] as unknown[],
}))

vi.mock('../cache', () => ({
  getCachedEntityDefId: async (_org: string, entityType: string) =>
    entityType === 'payment_gateway' ? h.defId : 'def-gl-account',
}))

vi.mock('../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => 'system-user-1' },
}))

vi.mock('../payment-gateways', () => ({
  normaliseGatewayHandle: (value: string) => value.trim().toLowerCase(),
  listPaymentGateways: async () => ({
    isOk: () => true,
    isErr: () => false,
    value: h.existingGateways,
  }),
  createPaymentGateway: async (_db: unknown, input: unknown) => {
    h.createCalls.push(input)
    return { isOk: () => true, isErr: () => false, value: { id: 'pg_new' } }
  },
}))

import { seedDefaultPaymentGateways } from './gl-account-chart'

/** A stub `Database` that answers the `GlRoleAssignment` select with `h.roleRows`. */
function stubDb() {
  return {
    select: () => ({
      from: () => ({
        where: async () => h.roleRows,
      }),
    }),
  } as never
}

beforeEach(() => {
  h.defId = 'def-payment-gateway'
  h.roleRows = []
  h.existingGateways = []
  h.createCalls.length = 0
})

describe('seedDefaultPaymentGateways', () => {
  it('is a no-op when the org has no payment_gateway def yet', async () => {
    h.defId = null
    const result = await seedDefaultPaymentGateways(stubDb(), 'org-1')
    expect(result).toEqual({ created: 0, skipped: 0 })
    expect(h.createCalls).toEqual([])
  })

  it('creates Shopify Payments and Affirm when both clearing roles are mapped', async () => {
    h.roleRows = [
      { role: 'clearing_card', glAccountId: 'acct_1200' },
      { role: 'clearing_affirm', glAccountId: 'acct_1210' },
      { role: 'payment_processing_fees', glAccountId: 'acct_6100' },
    ]

    const result = await seedDefaultPaymentGateways(stubDb(), 'org-1')

    expect(result.created).toBe(2)
    expect(h.createCalls).toHaveLength(2)
    expect(h.createCalls[0]).toMatchObject({
      name: 'Shopify Payments',
      handles: ['shopify_payments'],
      clearingAccountId: 'acct_1200',
      feeAccountId: 'acct_6100',
      settlementSource: 'shopify_payments',
      status: 'active',
    })
    expect(h.createCalls[1]).toMatchObject({
      name: 'Affirm',
      handles: ['affirm'],
      clearingAccountId: 'acct_1210',
      settlementSource: 'manual',
      status: 'active',
    })
  })

  it('skips a default whose clearing role is unmapped, rather than guessing an account', async () => {
    h.roleRows = [{ role: 'clearing_card', glAccountId: 'acct_1200' }]

    const result = await seedDefaultPaymentGateways(stubDb(), 'org-1')

    expect(result.created).toBe(1)
    expect(result.skipped).toBe(1)
    expect(h.createCalls).toHaveLength(1)
    expect(h.createCalls[0]).toMatchObject({ name: 'Shopify Payments' })
  })

  it('is idempotent by handle - skips a default a record already claims', async () => {
    h.roleRows = [
      { role: 'clearing_card', glAccountId: 'acct_1200' },
      { role: 'clearing_affirm', glAccountId: 'acct_1210' },
    ]
    h.existingGateways = [{ id: 'pg_existing', handles: ['Affirm'] }]

    const result = await seedDefaultPaymentGateways(stubDb(), 'org-1')

    expect(result.created).toBe(1)
    expect(result.skipped).toBe(1)
    expect(h.createCalls).toHaveLength(1)
    expect(h.createCalls[0]).toMatchObject({ name: 'Shopify Payments' })
  })

  it('never seeds Authorize.Net - a merchant adds it, auxx does not guess it', async () => {
    h.roleRows = [
      { role: 'clearing_card', glAccountId: 'acct_1200' },
      { role: 'clearing_affirm', glAccountId: 'acct_1210' },
    ]

    await seedDefaultPaymentGateways(stubDb(), 'org-1')

    expect(h.createCalls.some((call) => (call as { name?: string }).name === 'Authorize.Net')).toBe(
      false
    )
  })
})
