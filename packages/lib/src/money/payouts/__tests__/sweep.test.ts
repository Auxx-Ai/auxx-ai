// packages/lib/src/money/payouts/__tests__/sweep.test.ts
//
// brief 27 §7: the sweep walks every org a registered `api` source can poll,
// de-duplicated across sources, and one failure - a source that cannot list
// its orgs, an org whose sync errs, a rail that fails inside an org - never
// stops the walk.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  syncPayouts: vi.fn(async (_db: unknown, _params: { organizationId: string }) => ({
    isErr: () => false,
    value: {
      seen: 0,
      created: 0,
      posted: 0,
      alreadyPosted: 0,
      refused: [] as { payoutId: string; reason: string }[],
      failed: [] as { sourceId: string; paymentGatewayId: string | null; reason: string }[],
    },
  })),
}))

vi.mock('../sync', () => ({ syncPayouts: h.syncPayouts }))
vi.mock('@auxx/database', () => ({ database: {} }))

import type { Database } from '@auxx/database'
import type { PayoutSource } from '../source'
import { __resetPayoutSourcesForTests, registerPayoutSource } from '../source-registry'
import { sweepPayouts } from '../sweep'

const db = {} as Database

function apiSource(id: PayoutSource['id'], orgs: () => Promise<string[]>): PayoutSource {
  return { id, kind: 'api', listOrganizations: orgs, listPayouts: async () => [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetPayoutSourcesForTests()
})

describe('sweepPayouts', () => {
  it('walks the union of every api source’s organizations, once each', async () => {
    registerPayoutSource(apiSource('stripe', async () => ['org_a', 'org_b']))
    registerPayoutSource(apiSource('shopify_payments', async () => ['org_b', 'org_c']))

    const summary = await sweepPayouts(db)

    expect(summary.organizations).toBe(3)
    expect(h.syncPayouts.mock.calls.map(([, params]) => params.organizationId)).toEqual([
      'org_a',
      'org_b',
      'org_c',
    ])
  })

  it('never polls a file source', async () => {
    registerPayoutSource({ id: 'stripe', kind: 'file', listPayouts: async () => [] })

    const summary = await sweepPayouts(db)

    expect(summary.organizations).toBe(0)
    expect(h.syncPayouts).not.toHaveBeenCalled()
  })

  it('counts a source that cannot list its orgs as one failure and still walks the others', async () => {
    registerPayoutSource(
      apiSource('shopify_payments', async () => {
        throw new Error('tool unreachable')
      })
    )
    registerPayoutSource(apiSource('stripe', async () => ['org_a']))

    const summary = await sweepPayouts(db)

    expect(summary.failures).toBe(1)
    expect(summary.organizations).toBe(1)
    expect(h.syncPayouts).toHaveBeenCalledTimes(1)
  })

  it('counts an org whose sync errs, and a rail that failed inside an org, without stopping', async () => {
    registerPayoutSource(apiSource('stripe', async () => ['org_a', 'org_b', 'org_c']))
    h.syncPayouts
      .mockResolvedValueOnce({ isErr: () => true, error: new Error('def missing') } as never)
      .mockResolvedValueOnce({
        isErr: () => false,
        value: {
          seen: 2,
          created: 1,
          posted: 1,
          alreadyPosted: 1,
          refused: [{ payoutId: 'po_x', reason: 'arithmetic' }],
          failed: [{ sourceId: 'stripe', paymentGatewayId: 'pg_1', reason: '401' }],
        },
      })
      .mockRejectedValueOnce(new Error('boom'))

    const summary = await sweepPayouts(db)

    expect(summary).toEqual({
      organizations: 3,
      seen: 2,
      created: 1,
      posted: 1,
      refused: 1,
      failures: 3,
    })
    expect(h.syncPayouts).toHaveBeenCalledTimes(3)
  })
})
