// packages/lib/src/builds/__tests__/backfill-builds.test.ts
//
// The bulk builder's WRITE half
// (plans/money/tasks/44-auto-build-cutoff-and-backfill.md §6, §7.3, §7.4).
//
// The DECISION is not under test here — `backfill-policy.test.ts` owns it, pure
// and with no doubles. What is under test is the shell: the values one bucket
// becomes, the accounting date it is completed at, and the three-layer
// never-throw discipline that has to keep four hundred builds from being lost
// to one unpriced screw.
//
// Two properties carry most of the weight:
//
//   1. §7.4 — a refused completion is a `leftInProgress` RESULT carrying the
//      build id, and the run CONTINUES. An error channel cannot name a build,
//      so the person would be told "failed" about builds that exist and would
//      press the button again.
//   2. §6.2 / the accounting rule — `completedAt` comes from the bucket's own
//      demand period, in the book timezone, and never from `new Date()`.
//      Dating eight months of production to today puts all of it in one
//      month-end entry.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import type { BackfillBucket, BackfillPlan, BackfillRequest } from '../backfill-types'
import type { BuildRecord } from '../types'

const ORG = 'org_1'
const USER = 'user_1'
const LIFT = 'part_lift'
const HOIST = 'part_hoist'
const BUILD_DEF = 'def_build'

const h = vi.hoisted(() => ({
  /** `accounting.bookTimeZone`, or null for an org that keeps no books. */
  timeZone: null as string | null,
  /** Which of the two demand-period fields are provisioned. */
  periodFields: { start: true, end: true },
  /** Every `createBuild` call, as the `CreateBuildInput` it was handed. */
  createCalls: [] as Record<string, unknown>[],
  startCalls: [] as Record<string, unknown>[],
  completeCalls: [] as Record<string, unknown>[],
  /** partIds whose `createBuild` must return an `err`. */
  createRefusals: new Map<string, Error>(),
  /** buildIds whose `startBuild` must return an `err`. */
  startRefusals: new Map<string, Error>(),
  /** buildIds whose `completeBuild` must return an `err`. */
  completeRefusals: new Map<string, Error>(),
  nextBuild: 0,
}))

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: vi.fn(async () => h.timeZone),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({
        build_period_start: h.periodFields.start ? { id: 'f_period_start' } : null,
        build_period_end: h.periodFields.end ? { id: 'f_period_end' } : null,
      }),
    }),
  }),
}))

// The three sanctioned writers are doubles: each has its own suite, and what is
// under test here is the SEAM between them. `createBuild` in particular owns the
// part-kind and bill-of-materials refusals and the demand-period write, so this
// file asserts on the input it is handed rather than re-testing those.
vi.mock('../build-mutations', () => ({
  createBuild: vi.fn(
    async (_db: unknown, _org: string, _user: string, input: Record<string, unknown>) => {
      h.createCalls.push(input)
      const refusal = h.createRefusals.get(String(input.partId))
      if (refusal) return err(refusal)
      h.nextBuild += 1
      const buildId = `bld_${h.nextBuild}`
      return ok(raised(buildId, { partId: String(input.partId) }))
    }
  ),
  startBuild: vi.fn(
    async (_db: unknown, _org: string, _user: string, input: { buildId: string }) => {
      h.startCalls.push(input)
      const refusal = h.startRefusals.get(input.buildId)
      return refusal ? err(refusal) : ok(raised(input.buildId, { status: 'in_progress' }))
    }
  ),
}))

vi.mock('../complete-build', () => ({
  completeBuild: vi.fn(
    async (_db: unknown, _org: string, _user: string, input: Record<string, unknown>) => {
      h.completeCalls.push(input)
      const refusal = h.completeRefusals.get(String(input.buildId))
      return refusal ? err(refusal) : ok({ buildId: input.buildId, movementIds: ['mv_1'] })
    }
  ),
}))

import { executeBackfill, resolveBackfillCompletedAt } from '../backfill-builds'

/** Nothing in this file reads the database — every writer it calls is a double. */
const db = {} as never

function raised(buildId: string, over: Partial<BuildRecord> = {}): BuildRecord {
  return {
    buildId,
    recordId: `${BUILD_DEF}:${buildId}`,
    number: null,
    partId: LIFT,
    status: 'planned',
    quantityPlanned: 10,
    quantityProduced: null,
    quantityScrapped: null,
    startedAt: null,
    completedAt: null,
    materialCost: null,
    laborCost: null,
    overheadCost: null,
    producedValue: null,
    varianceAmount: null,
    postedAt: null,
    notes: null,
    orderId: null,
    source: 'batch',
    reversalOfBuildId: null,
    orderRevision: null,
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
    ...over,
  } as BuildRecord
}

/** One monthly bucket. `month` is 1-based; the period is UTC-bounded by default. */
function bucket(over: Partial<BackfillBucket> = {}): BackfillBucket {
  return {
    partId: LIFT,
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-02-01T00:00:00.000Z'),
    periodKey: '2026-01',
    bucketId: `${LIFT}:2026-01`,
    quantityOrdered: 10,
    quantityCovered: 0,
    quantityFromStock: 0,
    quantityToBuild: 10,
    orderIds: ['ord_1'],
    ...over,
  }
}

function planOf(...buckets: BackfillBucket[]): BackfillPlan {
  const byPart = new Map<string, BackfillBucket[]>()
  for (const b of buckets) {
    const list = byPart.get(b.partId) ?? []
    list.push(b)
    byPart.set(b.partId, list)
  }
  return {
    parts: [...byPart.entries()].map(([partId, list]) => ({
      partId,
      quantityOrdered: list.reduce((n, b) => n + b.quantityOrdered, 0),
      quantityCovered: 0,
      quantityOnHand: 0,
      quantityToBuild: list.reduce((n, b) => n + b.quantityToBuild, 0),
      buckets: list,
    })),
    excluded: [],
    buildCount: buckets.length,
    unitCount: buckets.reduce((n, b) => n + b.quantityToBuild, 0),
  }
}

const PLANNED: BackfillRequest = {
  from: new Date('2026-01-01T00:00:00.000Z'),
  to: new Date('2026-03-01T00:00:00.000Z'),
  grouping: 'month',
  status: 'planned',
}
const COMPLETED: BackfillRequest = { ...PLANNED, status: 'completed' }

beforeEach(() => {
  vi.useRealTimers()
  h.timeZone = 'UTC'
  h.periodFields = { start: true, end: true }
  h.createCalls = []
  h.startCalls = []
  h.completeCalls = []
  h.createRefusals = new Map()
  h.startRefusals = new Map()
  h.completeRefusals = new Map()
  h.nextBuild = 0
})

// ─── The accounting date ────────────────────────────────────────────────

describe('🛑 completedAt comes from the period, never from now', () => {
  it('is the last instant of the period, not its exclusive end', () => {
    const at = resolveBackfillCompletedAt(bucket(), 'UTC')
    expect(at.toISOString()).toBe('2026-01-31T23:59:59.999Z')
  })

  it('falls INSIDE the half-open period for every bucket', () => {
    for (const month of ['01', '02', '06', '11'] as const) {
      const next = month === '11' ? '12' : String(Number(month) + 1).padStart(2, '0')
      const b = bucket({
        periodStart: new Date(`2026-${month}-01T00:00:00.000Z`),
        periodEnd: new Date(`2026-${next}-01T00:00:00.000Z`),
      })
      const at = resolveBackfillCompletedAt(b, 'UTC').getTime()
      expect(at).toBeGreaterThanOrEqual(b.periodStart.getTime())
      expect(at).toBeLessThan(b.periodEnd.getTime())
    }
  })

  // 🛑 January 31 19:00 in New York is already February in UTC. Derive this in
  // UTC and eight months of production land in the wrong month-end entries,
  // invisibly, and uncorrectably once the period is locked.
  it('derives the local day end in the BOOK timezone', () => {
    const b = bucket({
      // The month, bounded as New York wall-clock midnights.
      periodStart: new Date('2026-01-01T05:00:00.000Z'),
      periodEnd: new Date('2026-02-01T05:00:00.000Z'),
    })
    const at = resolveBackfillCompletedAt(b, 'America/New_York')
    expect(at.toISOString()).toBe('2026-02-01T04:59:59.999Z')
    // Which is still January in the books — the whole point.
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
    }).format(at)
    expect(local).toBe('2026-01')
  })

  // A boundary computed in a different zone from the one read here must still
  // only produce an instant the build's own period contains.
  it('clamps below the exclusive end when the zones disagree', () => {
    const b = bucket({
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-02-01T00:00:00.000Z'),
    })
    const at = resolveBackfillCompletedAt(b, 'America/New_York')
    expect(at.getTime()).toBeLessThan(b.periodEnd.getTime())
    expect(at.toISOString()).toBe('2026-01-31T23:59:59.999Z')
  })

  // Under `grouping: 'order'` the two bounds collapse onto the one order's date.
  it('returns the start for a period with no width', () => {
    const day = new Date('2026-01-17T14:30:00.000Z')
    const at = resolveBackfillCompletedAt(bucket({ periodStart: day, periodEnd: day }), 'UTC')
    expect(at.toISOString()).toBe(day.toISOString())
  })
})

// ─── What one bucket becomes ────────────────────────────────────────────

describe('one bucket, one build', () => {
  it('writes a batch build carrying the demand period', async () => {
    const result = await executeBackfill(db, ORG, USER, planOf(bucket()), PLANNED)

    expect(result.isOk()).toBe(true)
    expect(h.createCalls).toHaveLength(1)
    expect(h.createCalls[0]).toEqual({
      partId: LIFT,
      quantityPlanned: 10,
      source: 'batch',
      period: {
        start: new Date('2026-01-01T00:00:00.000Z'),
        end: new Date('2026-02-01T00:00:00.000Z'),
      },
    })
  })

  // §6.2: a batch build carries a PERIOD, not its orders. A relation would put
  // row growth back on order count, which is what batching exists to escape.
  it('carries no order relation, however many orders are behind it', async () => {
    const b = bucket({ orderIds: ['ord_1', 'ord_2', 'ord_3'] })
    await executeBackfill(db, ORG, USER, planOf(b), PLANNED)
    expect(h.createCalls[0]).not.toHaveProperty('orderId')
    expect(h.createCalls[0]).not.toHaveProperty('orderRevision')
  })

  it('reports every build it raised', async () => {
    const plan = planOf(bucket(), bucket({ periodKey: '2026-02', bucketId: `${LIFT}:2026-02` }))
    const summary = (await executeBackfill(db, ORG, USER, plan, PLANNED))._unsafeUnwrap()

    expect(summary.created).toEqual([
      { partId: LIFT, buildId: 'bld_1', quantity: 10, periodKey: '2026-01' },
      { partId: LIFT, buildId: 'bld_2', quantity: 10, periodKey: '2026-02' },
    ])
    expect(summary.failed).toEqual([])
    expect(summary.leftInProgress).toEqual([])
  })

  it('does nothing at all for an empty plan', async () => {
    const summary = (await executeBackfill(db, ORG, USER, planOf(), PLANNED))._unsafeUnwrap()
    expect(summary).toEqual({ created: [], leftInProgress: [], failed: [] })
    expect(h.createCalls).toHaveLength(0)
  })
})

describe('planned is the whole of the write', () => {
  it('never starts or completes a planned run', async () => {
    await executeBackfill(db, ORG, USER, planOf(bucket()), PLANNED)
    expect(h.startCalls).toHaveLength(0)
    expect(h.completeCalls).toHaveLength(0)
  })
})

describe('completed walks create -> start -> complete', () => {
  it('completes at the period date, not at now', async () => {
    await executeBackfill(db, ORG, USER, planOf(bucket()), COMPLETED)

    expect(h.startCalls).toEqual([{ buildId: 'bld_1' }])
    expect(h.completeCalls).toHaveLength(1)
    expect(h.completeCalls[0]).toMatchObject({ buildId: 'bld_1', quantityProduced: 10 })
    expect((h.completeCalls[0]?.completedAt as Date).toISOString()).toBe('2026-01-31T23:59:59.999Z')
  })

  // The failure this exists to prevent: eight monthly builds all dated today
  // land in ONE month-end entry, and the other seven months show no production.
  it('dates each month to its own month, across a long range', async () => {
    const months = ['01', '02', '03'] as const
    const plan = planOf(
      ...months.map((m) =>
        bucket({
          periodStart: new Date(`2026-${m}-01T00:00:00.000Z`),
          periodEnd: new Date(`2026-${String(Number(m) + 1).padStart(2, '0')}-01T00:00:00.000Z`),
          periodKey: `2026-${m}`,
          bucketId: `${LIFT}:2026-${m}`,
        })
      )
    )
    await executeBackfill(db, ORG, USER, plan, COMPLETED)

    const dates = h.completeCalls.map((call) =>
      (call.completedAt as Date).toISOString().slice(0, 7)
    )
    expect(dates).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  // §7.3 rule 1: completing demand that has not happened yet is meaningless.
  it('refuses a period that has not ended, and raises no build for it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))

    const summary = (
      await executeBackfill(db, ORG, USER, planOf(bucket()), COMPLETED)
    )._unsafeUnwrap()

    expect(h.createCalls).toHaveLength(0)
    expect(summary.created).toEqual([])
    expect(summary.failed).toHaveLength(1)
    expect(summary.failed[0]?.reason).toContain('has not ended yet')
    expect(summary.failed[0]?.bucketId).toBe(`${LIFT}:2026-01`)
  })
})

// ─── §7.4 — it is not atomic, and the summary says so ───────────────────

describe('🛑 a refused completion is a result, not an error', () => {
  it('records the build that exists and CONTINUES the run', async () => {
    h.completeRefusals.set(
      'bld_1',
      new UnprocessableEntityError('Feet Bracket has no standard cost')
    )
    const plan = planOf(bucket(), bucket({ periodKey: '2026-02', bucketId: `${LIFT}:2026-02` }))

    const result = await executeBackfill(db, ORG, USER, plan, COMPLETED)

    // ✅ Ok, not err — the caller has to be able to name and link the run.
    expect(result.isOk()).toBe(true)
    const summary = result._unsafeUnwrap()
    expect(summary.leftInProgress).toEqual([
      { partId: LIFT, buildId: 'bld_1', reason: 'Feet Bracket has no standard cost' },
    ])
    // The batch is NOT aborted: the second bucket still ran and completed.
    expect(h.createCalls).toHaveLength(2)
    expect(h.completeCalls).toHaveLength(2)
  })

  // A build left in progress WAS created, and `created.length` is the answer to
  // "how many builds does this org have that it did not before".
  it('still counts the raised build as created', async () => {
    h.completeRefusals.set('bld_1', new UnprocessableEntityError('nope'))
    const summary = (
      await executeBackfill(db, ORG, USER, planOf(bucket()), COMPLETED)
    )._unsafeUnwrap()

    expect(summary.created).toHaveLength(1)
    expect(summary.created[0]?.buildId).toBe('bld_1')
    expect(summary.failed).toEqual([])
  })

  it('records a refused START too, because that build also exists', async () => {
    h.startRefusals.set(
      'bld_1',
      new UnprocessableEntityError('Only a planned build can be started')
    )

    const summary = (
      await executeBackfill(db, ORG, USER, planOf(bucket()), COMPLETED)
    )._unsafeUnwrap()

    expect(h.completeCalls).toHaveLength(0)
    expect(summary.leftInProgress).toHaveLength(1)
    expect(summary.leftInProgress[0]?.buildId).toBe('bld_1')
    expect(summary.leftInProgress[0]?.reason).toContain('could not be started')
  })
})

// ─── Never throws ───────────────────────────────────────────────────────

describe('🛑 never throws', () => {
  it('a bucket whose raise is refused is recorded and stepped over', async () => {
    h.createRefusals.set(LIFT, new UnprocessableEntityError('crud blew up for part_lift'))
    const plan = planOf(bucket(), bucket({ partId: HOIST, bucketId: `${HOIST}:2026-01` }))

    const summary = (await executeBackfill(db, ORG, USER, plan, PLANNED))._unsafeUnwrap()

    expect(summary.failed).toHaveLength(1)
    expect(summary.failed[0]?.partId).toBe(LIFT)
    expect(summary.failed[0]?.reason).toContain('crud blew up')
    // The other part still got its build.
    expect(summary.created).toHaveLength(1)
    expect(summary.created[0]?.partId).toBe(HOIST)
  })

  it('records one row per failed bucket, never two', async () => {
    h.createRefusals.set(LIFT, new UnprocessableEntityError('crud blew up for part_lift'))
    const plan = planOf(bucket(), bucket({ periodKey: '2026-02', bucketId: `${LIFT}:2026-02` }))

    const summary = (await executeBackfill(db, ORG, USER, plan, PLANNED))._unsafeUnwrap()

    expect(summary.failed).toHaveLength(2)
    expect(summary.failed.map((row) => row.bucketId)).toEqual([
      `${LIFT}:2026-01`,
      `${LIFT}:2026-02`,
    ])
  })
})

// ─── The writer re-refuses what the policy already excluded ─────────────

// 🛑 The part-kind, bill-of-materials, part-existence and quantity refusals all
// live in `createBuild` and have their own suite there. What this file owns is
// what a refusal MEANS to a run: the bucket wrote nothing, so it is `failed` and
// never `leftInProgress`, and the run keeps going.
describe('a refused raise is a failed bucket, not a build to go and finish', () => {
  it('records the refusal verbatim and raises nothing', async () => {
    h.createRefusals.set(
      LIFT,
      new UnprocessableEntityError('This part is classified as purchased, so it cannot be built.')
    )

    const summary = (
      await executeBackfill(db, ORG, USER, planOf(bucket()), PLANNED)
    )._unsafeUnwrap()

    expect(summary.created).toEqual([])
    expect(summary.leftInProgress).toEqual([])
    expect(summary.failed).toEqual([
      {
        partId: LIFT,
        bucketId: `${LIFT}:2026-01`,
        periodKey: '2026-01',
        reason: 'This part is classified as purchased, so it cannot be built.',
      },
    ])
  })

  it('never starts or completes a bucket whose raise was refused', async () => {
    h.createRefusals.set(LIFT, new UnprocessableEntityError('no bill of materials'))
    await executeBackfill(db, ORG, USER, planOf(bucket()), COMPLETED)
    expect(h.startCalls).toHaveLength(0)
    expect(h.completeCalls).toHaveLength(0)
  })
})

// ─── The refusals that write nothing at all ─────────────────────────────

describe('🛑 the demand-period fields are required before anything is written', () => {
  // A batch build with no period is invisible to the netting read that decides
  // what the NEXT run owes (§6.2), so an unprovisioned org would get four
  // hundred builds and then get them all again on the second pass.
  it('refuses the whole run, having raised nothing', async () => {
    h.periodFields = { start: true, end: false }

    const result = await executeBackfill(db, ORG, USER, planOf(bucket()), PLANNED)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(h.createCalls).toHaveLength(0)
  })
})

describe('an organization that keeps no books yet', () => {
  it('falls back to UTC rather than refusing the run', async () => {
    h.timeZone = null
    await executeBackfill(db, ORG, USER, planOf(bucket()), COMPLETED)
    expect((h.completeCalls[0]?.completedAt as Date).toISOString()).toBe('2026-01-31T23:59:59.999Z')
  })
})
