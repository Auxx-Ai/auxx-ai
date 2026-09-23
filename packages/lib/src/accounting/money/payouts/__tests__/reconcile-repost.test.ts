// packages/lib/src/accounting/money/payouts/__tests__/reconcile-repost.test.ts
//
// §13 Q6 in `reconcileTransferIds`: a stale posting is reversed after its chunk commits and the
// payout is re-posted from stored data in the same pass; so is one reversed on an earlier pass.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  syncStoredMatches: vi.fn(),
  reverseStalePayoutPosting: vi.fn(),
  repostStoredPayouts: vi.fn(),
  listTransfersAwaitingRepost: vi.fn(),
}))

vi.mock('@auxx/database', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  withAccountingCommitLock: async () => {},
}))
vi.mock('../match-sync', () => ({ syncStoredMatches: h.syncStoredMatches }))
vi.mock('../repost-writes', () => ({
  reverseStalePayoutPosting: h.reverseStalePayoutPosting,
  repostStoredPayouts: h.repostStoredPayouts,
}))
vi.mock('../repost-reads', () => ({ listTransfersAwaitingRepost: h.listTransfersAwaitingRepost }))

import type { Database } from '@auxx/database'
import { reconcileTransferIds } from '../assess-payouts'
import type { RepostTarget } from '../repost-reads'

const ORG = 'org_1'
const TRANSFER = {
  id: 'mt_1',
  sourceAccountId: 'fsa_1',
  externalId: 'po_7',
  currentObservationId: 'obs_1',
  sourceAmountMinor: 9_700n,
  reconciliationBasisHash: null,
  reconciliationState: 'pending',
}
const TARGET: RepostTarget = {
  transferId: 'mt_1',
  payoutExternalId: 'po_7',
  providerKey: 'shopify_payments',
  paymentGatewayId: 'pg_shop',
}

/** Every assessment reads the transfers, then their header observations (none here). */
function stubDb() {
  const written: unknown[] = []
  let selects = 0
  const tx = {
    select: () => {
      const chain = {
        from: () => chain,
        where: async () => (selects++ % 2 === 0 ? [TRANSFER] : []),
      }
      return chain
    },
    insert: () => ({
      values: (rows: unknown[]) => {
        written.push(...rows)
        return { onConflictDoUpdate: async () => undefined }
      },
    }),
  }
  const db = { transaction: async <T>(run: (t: unknown) => Promise<T>) => run(tx) }
  return { db: db as unknown as Database, written }
}

function summary(stalePostingIds: string[]) {
  return new Map([
    [
      'mt_1',
      {
        basis: [],
        unmatchedCount: 0,
        split: {},
        entryCount: 1,
        stalePostingIds,
      },
    ],
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  h.syncStoredMatches.mockResolvedValueOnce(summary(['glp_old'])).mockResolvedValue(summary([]))
  h.reverseStalePayoutPosting.mockResolvedValue({
    glPostingId: 'glp_old',
    reversed: true,
    refusal: null,
  })
  h.listTransfersAwaitingRepost.mockResolvedValue([TARGET])
  h.repostStoredPayouts.mockResolvedValue({ postedTransferIds: ['mt_1'], refused: 0 })
})

describe('reconcileTransferIds re-posts what it reverses', () => {
  it('reverses the stale posting, re-posts from stored data, then reassesses without reversing', async () => {
    const { db } = stubDb()

    const result = await reconcileTransferIds(db, ORG, ['mt_1'], { actorUserId: 'user_1' })

    expect(result.reposted).toBe(1)
    expect(h.reverseStalePayoutPosting).toHaveBeenCalledTimes(1)
    expect(h.reverseStalePayoutPosting).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      glPostingId: 'glp_old',
      transferId: 'mt_1',
      actorUserId: 'user_1',
    })
    expect(h.listTransfersAwaitingRepost).toHaveBeenCalledWith(db, ORG, ['mt_1'])
    expect(h.repostStoredPayouts).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      targets: [TARGET],
      actorUserId: 'user_1',
    })
    // The reassess pass ran (a second match pass) and re-posted nothing further.
    expect(h.syncStoredMatches).toHaveBeenCalledTimes(2)
    expect(h.repostStoredPayouts).toHaveBeenCalledTimes(1)
  })

  it('re-posts a payout reversed on an earlier pass, whatever its age, with nothing stale now', async () => {
    h.syncStoredMatches.mockReset().mockResolvedValue(summary([]))
    const { db } = stubDb()

    const result = await reconcileTransferIds(db, ORG, ['mt_1'])

    expect(h.reverseStalePayoutPosting).not.toHaveBeenCalled()
    expect(result.reposted).toBe(1)
  })

  it('leaves the stale blocker standing and re-posts nothing when the period refuses the reversal', async () => {
    h.reverseStalePayoutPosting.mockResolvedValue({
      glPostingId: 'glp_old',
      reversed: false,
      refusal: 'its period is closed',
    })
    h.listTransfersAwaitingRepost.mockResolvedValue([])
    h.repostStoredPayouts.mockResolvedValue({ postedTransferIds: [], refused: 0 })
    const { db, written } = stubDb()

    const result = await reconcileTransferIds(db, ORG, ['mt_1'])

    expect(result.reposted).toBe(0)
    expect(h.syncStoredMatches).toHaveBeenCalledTimes(1)
    expect(written).toEqual([
      expect.objectContaining({
        reconciliationResult: expect.objectContaining({
          blockers: expect.arrayContaining([expect.stringContaining('reversed and re-posted')]),
        }),
      }),
    ])
  })

  it('neither reverses nor re-posts on the reassess-only pass', async () => {
    const { db } = stubDb()

    const result = await reconcileTransferIds(db, ORG, ['mt_1'], { reverseStale: false })

    expect(result.reposted).toBe(0)
    expect(h.reverseStalePayoutPosting).not.toHaveBeenCalled()
    expect(h.listTransfersAwaitingRepost).not.toHaveBeenCalled()
    expect(h.repostStoredPayouts).not.toHaveBeenCalled()
  })
})
