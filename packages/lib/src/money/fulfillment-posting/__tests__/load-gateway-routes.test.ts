// packages/lib/src/money/fulfillment-posting/__tests__/load-gateway-routes.test.ts
//
// `loadGatewayRoutesForPlan` is the one database read `planFulfillmentPosting`
// itself must never take on (this file's own header: PURE, no db). It is a
// thin wrapper over `payment-gateways/reads.ts` + `client.ts`'s
// `toGatewayRoutes`, so this only pins the two edges: an org with no
// `payment_gateway` rows (or an unmigrated one) gets an empty table rather
// than a throw.

import { describe, expect, it, vi } from 'vitest'

interface FakeResult {
  isOk: () => boolean
  isErr: () => boolean
  value: unknown[]
}

const h = vi.hoisted(() => ({
  result: { isOk: () => true, isErr: () => false, value: [] } as FakeResult,
}))

vi.mock('../../../payment-gateways', () => ({
  listPaymentGateways: async () => h.result,
  toGatewayRoutes: (rows: { handles: string[]; clearingGlAccountId: string; status: string }[]) =>
    rows.map((row) => ({
      handles: row.handles,
      clearingGlAccountId: row.clearingGlAccountId,
      active: row.status === 'active',
    })),
}))

const { loadGatewayRoutesForPlan } = await import('../plan')

describe('loadGatewayRoutesForPlan', () => {
  it('returns an empty table when the org has no payment gateways', async () => {
    h.result = { isOk: () => true, isErr: () => false, value: [] }
    const routes = await loadGatewayRoutesForPlan({} as never, 'org_1')
    expect(routes).toEqual([])
  })

  it('returns an empty table rather than throwing when the read fails', async () => {
    h.result = { isOk: () => false, isErr: () => true, value: [] }
    const routes = await loadGatewayRoutesForPlan({} as never, 'org_1')
    expect(routes).toEqual([])
  })

  it('maps rows through toGatewayRoutes, active and closed alike', async () => {
    h.result = {
      isOk: () => true,
      isErr: () => false,
      value: [
        {
          handles: ['authorize_net', 'authorize.net'],
          clearingGlAccountId: 'acct_1',
          status: 'closed',
        },
        { handles: ['affirm'], clearingGlAccountId: 'acct_2', status: 'active' },
      ],
    }
    const routes = await loadGatewayRoutesForPlan({} as never, 'org_1')
    expect(routes).toEqual([
      { handles: ['authorize_net', 'authorize.net'], clearingGlAccountId: 'acct_1', active: false },
      { handles: ['affirm'], clearingGlAccountId: 'acct_2', active: true },
    ])
  })
})
