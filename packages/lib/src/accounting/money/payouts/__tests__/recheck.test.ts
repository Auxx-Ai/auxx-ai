// packages/lib/src/accounting/money/payouts/__tests__/recheck.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listOpen: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock('../match-sync', () => ({ listTransfersWithOpenMatches: h.listOpen }))
vi.mock('../assess-payouts', () => ({ reconcileTransferIds: h.reconcile }))

import type { Database } from '@auxx/database'
import { recheckOpenPayoutMatches } from '../recheck'

const db = {} as Database
const params = { organizationId: 'org_a', actorUserId: 'user_1' }

beforeEach(() => {
  vi.clearAllMocks()
  h.listOpen.mockResolvedValue(new Map([['org_a', ['t1', 't2']]]))
  h.reconcile.mockResolvedValue({ changed: 2, reposted: 1 })
})

describe('recheckOpenPayoutMatches', () => {
  it('reconciles only this org’s open payouts, re-posting what that reverses as this person', async () => {
    const result = await recheckOpenPayoutMatches(db, params)

    expect(result._unsafeUnwrap()).toEqual({ payouts: 2, changed: 2, reposted: 1 })
    expect(h.listOpen).toHaveBeenCalledWith(db, { organizationId: 'org_a' })
    expect(h.reconcile).toHaveBeenCalledWith(db, 'org_a', ['t1', 't2'], { actorUserId: 'user_1' })
  })

  it('does nothing when no payout holds an open item', async () => {
    h.listOpen.mockResolvedValue(new Map())

    const result = await recheckOpenPayoutMatches(db, params)

    expect(result._unsafeUnwrap()).toEqual({ payouts: 0, changed: 0, reposted: 0 })
    expect(h.reconcile).not.toHaveBeenCalled()
  })

  it('returns an err when the reconcile throws', async () => {
    h.reconcile.mockRejectedValue(new Error('boom'))

    const result = await recheckOpenPayoutMatches(db, params)

    expect(result.isErr()).toBe(true)
  })
})
