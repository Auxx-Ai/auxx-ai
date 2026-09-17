// packages/lib/src/money/fulfillment-posting/__tests__/load-gateway-routes.test.ts
//
// `loadGatewayRoutesForPlan` is the one database read `planFulfillmentPosting`
// itself must never take on (this file's own header: PURE, no db). It is a
// thin wrapper over `payment-gateways/reads.ts`'s `listPaymentGateways`, so
// this only pins the two edges: an org with no `payment_gateway` rows (or an
// unmigrated one) gets an empty table rather than a throw.

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

  it('maps rows to id, handles, active and name - never a clearing account (task 58 §5.2)', async () => {
    h.result = {
      isOk: () => true,
      isErr: () => false,
      value: [
        {
          id: 'gw_1',
          name: 'Authorize.Net',
          handles: ['authorize_net', 'authorize.net'],
          status: 'closed',
        },
        { id: 'gw_2', name: 'Affirm', handles: ['affirm'], status: 'active' },
      ],
    }
    const routes = await loadGatewayRoutesForPlan({} as never, 'org_1')
    expect(routes).toEqual([
      // The record's NAME rides along for the debit's reason sentence (brief 28 §5).
      {
        id: 'gw_1',
        handles: ['authorize_net', 'authorize.net'],
        active: false,
        name: 'Authorize.Net',
      },
      { id: 'gw_2', handles: ['affirm'], active: true, name: 'Affirm' },
    ])
  })
})
