// packages/lib/src/accounting/money/payouts/__tests__/repost-writes.test.ts
//
// T26 (`plans/accounting/payout-links.md` §13 Q6): an item matched after its
// payout posted backs the entry out through the ordinary reverse path, and a
// closed period refuses it in a sentence rather than throwing.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  reverseEntry: vi.fn(async (_db: unknown, _options: unknown) => ({
    status: 'posted' as string,
    error: undefined as string | undefined,
  })),
  resolvePeriodLock: vi.fn(async () => ({ closedThrough: null })),
}))

vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../ledger/periods/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))

import { reverseStalePayoutPosting } from '../repost-writes'

const db = {} as Database

beforeEach(() => {
  vi.clearAllMocks()
  h.reverseEntry.mockResolvedValue({ status: 'posted', error: undefined })
})

describe('reverseStalePayoutPosting', () => {
  it('backs the entry out through the ordinary reverse path, under the period lock it read', async () => {
    const result = await reverseStalePayoutPosting(db, {
      organizationId: 'org_1',
      glPostingId: 'glp_1',
      actorUserId: 'user_1',
    })

    expect(result).toEqual({ glPostingId: 'glp_1', reversed: true, refusal: null })
    expect(h.reverseEntry).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organizationId: 'org_1',
        glPostingId: 'glp_1',
        actorUserId: 'user_1',
        lock: { closedThrough: null },
      })
    )
  })

  it('refuses in a sentence, never a throw, when the period is closed', async () => {
    h.reverseEntry.mockResolvedValue({ status: 'period_closed', error: 'June is closed' })

    const result = await reverseStalePayoutPosting(db, {
      organizationId: 'org_1',
      glPostingId: 'glp_1',
    })

    expect(result.reversed).toBe(false)
    expect(result.refusal).toContain('Re-open the period')
  })

  it('carries any other refusal through verbatim', async () => {
    h.reverseEntry.mockResolvedValue({ status: 'error', error: 'the chart moved' })

    const result = await reverseStalePayoutPosting(db, {
      organizationId: 'org_1',
      glPostingId: 'glp_1',
    })

    expect(result.reversed).toBe(false)
    expect(result.refusal).toContain('the chart moved')
  })
})
