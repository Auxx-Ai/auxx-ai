// packages/lib/src/import/__tests__/plan-estimates.test.ts
//
// `getPlanWithEstimates` reads a STORED plan, so its numbers are what the plan
// screen shows. The bucket mapping is shared with the planner
// (`calculateEstimatesFromCounts`); the two things that are NOT shared, and
// that this file pins, are:
//   • `totalRows` is the FILE's row count, never the sum of the buckets
//   • nothing assigned yet reads as an all-create import, not an empty one

import { describe, expect, it } from 'vitest'
import { calculateEstimatesFromCounts } from '../planning/calculate-estimates'
import { getPlanWithEstimates } from '../planning/get-plan'

/** Fake db serving one stored plan and its strategy rows. */
function fakeDb(
  strategies: Array<{ strategy: string; statistics: unknown }>,
  status: string = 'ready'
) {
  return {
    query: {
      ImportPlan: {
        findFirst: async () => ({ id: 'plan-1', status, strategies }),
      },
    },
  } as never
}

const planned = (count: number) => ({ planned: count, executed: 0, failed: 0 })

describe('getPlanWithEstimates, totalRows is the file, not the plan', () => {
  // Mid-planning, only some rows are assigned. Summing the buckets would make
  // the preview's total count upward as the planner runs, so the file's own
  // rowCount wins.
  it('reports the file rowCount while only some rows are assigned', async () => {
    const plan = await getPlanWithEstimates(
      fakeDb([
        { strategy: 'create', statistics: planned(30) },
        { strategy: 'update', statistics: planned(10) },
      ]),
      'job-1',
      100
    )

    expect(plan?.estimates).toEqual({
      totalRows: 100,
      toCreate: 30,
      toUpdate: 10,
      toSkip: 0,
      toUnmatched: 0,
      withErrors: 0,
    })
  })

  // The partially-assigned override is the ONLY divergence from the shared
  // helper: every bucket matches, the total does not.
  it('agrees with the shared helper on every bucket, and only the total differs', async () => {
    const counts = { create: 30, update: 10, skip: 4, unmatched: 6 }
    const plan = await getPlanWithEstimates(
      fakeDb(
        Object.entries(counts).map(([strategy, count]) => ({
          strategy,
          statistics: planned(count),
        }))
      ),
      'job-1',
      100
    )

    const shared = calculateEstimatesFromCounts(counts, counts.skip)

    expect(plan?.estimates).toEqual({ ...shared, totalRows: 100 })
    expect(shared.totalRows).toBe(50)
  })

  // `unmatched` is NOT `skip`: "no record to update in update-only mode" is not
  // a row error, and folding them together hides a class of unimported rows.
  it('keeps unmatched out of skip, and withErrors tracks skip alone', async () => {
    const plan = await getPlanWithEstimates(
      fakeDb([
        { strategy: 'update', statistics: planned(60) },
        { strategy: 'skip', statistics: planned(4) },
        { strategy: 'unmatched', statistics: planned(36) },
      ]),
      'job-1',
      100
    )

    expect(plan?.estimates.toSkip).toBe(4)
    expect(plan?.estimates.toUnmatched).toBe(36)
    expect(plan?.estimates.withErrors).toBe(4)
  })
})

describe('getPlanWithEstimates, nothing assigned yet', () => {
  it('reads an empty plan as an all-create import', async () => {
    const plan = await getPlanWithEstimates(fakeDb([]), 'job-1', 100)

    expect(plan?.estimates).toEqual({
      totalRows: 100,
      toCreate: 100,
      toUpdate: 0,
      toSkip: 0,
      toUnmatched: 0,
      withErrors: 0,
    })
  })

  // Strategy rows that exist but have not been counted yet are the same state.
  it('treats zero-count and unparseable statistics as unassigned', async () => {
    const plan = await getPlanWithEstimates(
      fakeDb([
        { strategy: 'create', statistics: planned(0) },
        { strategy: 'update', statistics: null },
        { strategy: 'skip', statistics: 'not an object' },
      ]),
      'job-1',
      100
    )

    expect(plan?.estimates.totalRows).toBe(100)
    expect(plan?.estimates.toCreate).toBe(100)
    expect(plan?.estimates.withErrors).toBe(0)
  })

  it('returns null when the job has no plan', async () => {
    const db = { query: { ImportPlan: { findFirst: async () => undefined } } } as never
    expect(await getPlanWithEstimates(db, 'job-1', 100)).toBeNull()
  })
})
