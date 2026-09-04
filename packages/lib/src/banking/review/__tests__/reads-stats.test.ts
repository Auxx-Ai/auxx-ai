// packages/lib/src/banking/review/__tests__/reads-stats.test.ts
//
// The stat strip.
//
// 🛑 Every figure is a COUNT OVER THE WHOLE ACCOUNT, not over a page of it. The
// queue this exists to describe is 2,390 rows on the real book it was designed
// against; a version that hydrated a page and counted in memory reported the
// page size instead, and reported the oldest of the NEWEST rows as the oldest
// unreviewed date - wrong in the reassuring direction, which for "how far behind
// am I" is the only direction that matters.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  buckets: [] as Record<string, unknown>[],
  coverage: { coverageFrom: '2026-01-01', gaps: [{ from: '2026-02-01', to: '2026-02-09' }] },
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: async () => 'def_bt',
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attributes: string[]) =>
        Object.fromEntries(attributes.map((attribute) => [attribute, { id: `f:${attribute}` }])),
    }),
  }),
}))
vi.mock('../../reads', () => ({
  listBankAccounts: async () => ({ isOk: () => true, value: [] }),
  readCoverage: async () => ({ isOk: () => true, isErr: () => false, value: h.coverage }),
}))

const { readQueueStats } = await import('../reads')

/** A builder whose every stage is chainable and thenable, resolving to the buckets. */
function chain(): Record<string, unknown> {
  const answer = () => Object.assign(Promise.resolve(h.buckets), chain())
  return {
    from: answer,
    innerJoin: answer,
    leftJoin: answer,
    where: answer,
    groupBy: answer,
    $dynamic: answer,
  }
}

const db = { select: () => chain() } as never

function bucket(over: Record<string, unknown> = {}) {
  return { status: 'for_review', rows: 0, inMinor: 0, outMinor: 0, oldest: null, ...over }
}

beforeEach(() => {
  h.buckets = []
})

describe('readQueueStats', () => {
  it('🛑 counts the WHOLE queue, not a page of it', async () => {
    h.buckets = [
      bucket({ status: 'for_review', rows: 2_390, oldest: '2025-03-04' }),
      bucket({ status: 'coded', rows: 11_000, oldest: '2024-01-01' }),
    ]
    const result = await readQueueStats(db, { organizationId: 'org_1' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.forReviewCount).toBe(2_390)
      expect(result.value.unreviewedCount).toBe(2_390)
    }
  })

  it('takes the oldest unreviewed date from SQL, never from the newest page', async () => {
    h.buckets = [
      bucket({ status: 'for_review', rows: 3, oldest: '2025-03-04' }),
      bucket({ status: 'suggested', rows: 2, oldest: '2024-11-30' }),
      // A `coded` line is somebody's decision and is not owed: it must not drag
      // the oldest date back.
      bucket({ status: 'coded', rows: 900, oldest: '2019-01-01' }),
    ]
    const result = await readQueueStats(db, { organizationId: 'org_1' })
    if (result.isOk()) {
      expect(result.value.oldestUnreviewedDate).toBe('2024-11-30')
      expect(result.value.unreviewedCount).toBe(5)
    }
  })

  it('sums money in and out UNSIGNED, over the unreviewed statuses only', async () => {
    h.buckets = [
      bucket({ status: 'for_review', rows: 2, inMinor: 120_000, outMinor: 45_000 }),
      bucket({ status: 'suggested', rows: 1, inMinor: 0, outMinor: 5_000 }),
      bucket({ status: 'excluded', rows: 40, inMinor: 999_999, outMinor: 999_999 }),
    ]
    const result = await readQueueStats(db, { organizationId: 'org_1' })
    if (result.isOk()) {
      expect(result.value.unreviewedInMinor).toBe(120_000)
      expect(result.value.unreviewedOutMinor).toBe(50_000)
    }
  })

  it('answers zeroes rather than nulls on an empty account', async () => {
    const result = await readQueueStats(db, { organizationId: 'org_1' })
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        forReviewCount: 0,
        unreviewedCount: 0,
        oldestUnreviewedDate: null,
        unreviewedInMinor: 0,
        unreviewedOutMinor: 0,
      })
    }
  })

  it('reports coverage only when ONE account is selected', async () => {
    const all = await readQueueStats(db, { organizationId: 'org_1' })
    if (all.isOk()) {
      // The floor is per account: rendering the first account's for an "All"
      // view would be a number that is wrong for every other account on screen.
      expect(all.value.coverageFrom).toBeNull()
      expect(all.value.coverageGapCount).toBe(0)
    }
    const one = await readQueueStats(db, { organizationId: 'org_1', bankAccountId: 'acct_1' })
    if (one.isOk()) {
      expect(one.value.coverageFrom).toBe('2026-01-01')
      expect(one.value.coverageGapCount).toBe(1)
    }
  })
})
