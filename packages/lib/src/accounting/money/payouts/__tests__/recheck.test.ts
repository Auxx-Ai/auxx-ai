// packages/lib/src/accounting/money/payouts/__tests__/recheck.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listOpen: vi.fn(),
  reconcile: vi.fn(),
  syncPayouts: vi.fn(),
}))

vi.mock('../match-sync', () => ({ listTransfersWithOpenMatches: h.listOpen }))
vi.mock('../assess-payouts', () => ({ reconcileTransferIds: h.reconcile }))
vi.mock('../sync', () => ({ syncPayouts: h.syncPayouts }))

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { recheckOpenPayoutMatches } from '../recheck'

const db = {} as Database
const params = { organizationId: 'org_a', actorUserId: 'user_1' }

beforeEach(() => {
  vi.clearAllMocks()
  h.listOpen.mockResolvedValue(new Map([['org_a', ['t1', 't2']]]))
  h.reconcile.mockResolvedValue(2)
  h.syncPayouts.mockResolvedValue(ok({ posted: 1 }))
})

describe('recheckOpenPayoutMatches', () => {
  it('reconciles only this org’s open payouts, then re-posts through its sync', async () => {
    const result = await recheckOpenPayoutMatches(db, params)

    expect(result._unsafeUnwrap()).toEqual({ payouts: 2, changed: 2, reposted: 1 })
    expect(h.listOpen).toHaveBeenCalledWith(db, { organizationId: 'org_a' })
    expect(h.reconcile).toHaveBeenCalledWith(db, 'org_a', ['t1', 't2'])
    expect(h.syncPayouts).toHaveBeenCalledWith(db, params)
  })

  it('does nothing when no payout holds an open item', async () => {
    h.listOpen.mockResolvedValue(new Map())

    const result = await recheckOpenPayoutMatches(db, params)

    expect(result._unsafeUnwrap()).toEqual({ payouts: 0, changed: 0, reposted: 0 })
    expect(h.reconcile).not.toHaveBeenCalled()
    expect(h.syncPayouts).not.toHaveBeenCalled()
  })

  it('skips the sync when nothing changed, since nothing can have been reversed', async () => {
    h.reconcile.mockResolvedValue(0)

    const result = await recheckOpenPayoutMatches(db, params)

    expect(result._unsafeUnwrap()).toEqual({ payouts: 2, changed: 0, reposted: 0 })
    expect(h.syncPayouts).not.toHaveBeenCalled()
  })

  it('keeps the re-check’s answer when the sync afterwards fails', async () => {
    h.syncPayouts.mockResolvedValue(err(new Error('provider down')))

    const result = await recheckOpenPayoutMatches(db, params)

    expect(result._unsafeUnwrap()).toEqual({ payouts: 2, changed: 2, reposted: 0 })
  })

  it('returns an err when the reconcile throws', async () => {
    h.reconcile.mockRejectedValue(new Error('boom'))

    const result = await recheckOpenPayoutMatches(db, params)

    expect(result.isErr()).toBe(true)
  })
})
