// packages/lib/src/builds/__tests__/batch-run-queries.test.ts
//
// The two reads behind the Undo card
// (`plans/money/tasks/45-batch-only-builds.md` sections 10.4 and 11.3), at the
// thing a db double can actually see: what they make of the rows the query
// comes back with.
//
// ⚠️ **The SQL predicates are NOT under test here and cannot be.**
// `src/test/setup.ts` mocks `@auxx/database` wholesale, so `schema.Foo` is a
// memoized `{}` whose COLUMNS are `undefined`, so a `WHERE` is unreadable and an
// alias is indistinguishable from any other. So "only this org", "only this run
// number" and "an archived reversal does not count" live in SQL and are asserted
// against a real database elsewhere; asserting them here would only be asserting
// the double.
//
// What IS here is the fold, which is where the two numbers that matter are
// decided: 🛑 `willCancel` and `willReverse` differ, and `willReverse` excludes
// a `completed` build something has ALREADY reversed. Counting that build would
// promise a ledger write the undo will not make (45 section 11.4).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const LIFT = 'part_lift'

/** The one projection these reads issue, which is how the double recognises it. */
const RUN_BUILDS =
  'buildId|createdAt|runNumber|status|partId|reversalOfBuildId|reversedByBuildId|periodStart|periodEnd'

const h = vi.hoisted(() => ({
  /** entityType -> `EntityDefinition.id`, for the defs the org has. */
  defs: new Map<string, string>(),
  /** systemAttributes the org has materialised. */
  fields: new Set<string>(),
  /** projection key -> the rows that read returns. */
  rows: new Map<string, Record<string, unknown>[]>(),
  /** projection keys, in the order the reads were issued. */
  issued: [] as string[],
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(
          attrs.map((attr) => [attr, h.fields.has(attr) ? { id: `fld_${attr}` } : null])
        ),
    }),
  }),
}))

import { listBatchRuns, readBatchRun, readBatchRunBuilds } from '../batch-run-queries'

const CHAIN_METHODS = ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']

/** A promise carrying the chain methods, so `await` works anywhere along it. */
function chain(rows: Record<string, unknown>[]) {
  const promise = Promise.resolve(rows) as Promise<Record<string, unknown>[]> &
    Record<string, unknown>
  for (const method of CHAIN_METHODS) promise[method] = () => promise
  return promise
}

const db = {
  select: (projection: Record<string, unknown>) => {
    const key = Object.keys(projection).join('|')
    h.issued.push(key)
    return chain(h.rows.get(key) ?? [])
  },
} as never

const BUILD_ATTRS = [
  'build_part',
  'build_status',
  'build_reversal_of',
  'build_period_start',
  'build_period_end',
  'build_batch_run',
]

/** One row as the run query returns it. Defaults to a `planned` build of run 7. */
function runRow(overrides: Record<string, unknown> = {}) {
  return {
    buildId: 'bld_1',
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
    runNumber: 7,
    status: 'planned',
    partId: LIFT,
    reversalOfBuildId: null,
    reversedByBuildId: null,
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-02-01T00:00:00.000Z',
    ...overrides,
  }
}

function given(rows: Record<string, unknown>[]): void {
  h.rows.set(RUN_BUILDS, rows)
}

async function read(runNumber: number) {
  const result = await readBatchRun(db, ORG, runNumber)
  if (result.isErr()) throw result.error
  return result.value
}

async function list() {
  const result = await listBatchRuns(db, ORG)
  if (result.isErr()) throw result.error
  return result.value
}

beforeEach(() => {
  vi.clearAllMocks()
  h.defs = new Map([['build', 'def_build']])
  h.fields = new Set(BUILD_ATTRS)
  h.rows = new Map()
  h.issued = []
})

describe('readBatchRun', () => {
  it('counts by status, and willCancel is planned plus in progress', async () => {
    given([
      runRow({ buildId: 'bld_1', status: 'planned' }),
      runRow({ buildId: 'bld_2', status: 'in_progress' }),
      runRow({ buildId: 'bld_3', status: 'completed' }),
      runRow({ buildId: 'bld_4', status: 'canceled' }),
    ])

    const summary = await read(7)

    expect(summary).toMatchObject({
      runNumber: 7,
      total: 4,
      planned: 1,
      inProgress: 1,
      completed: 1,
      canceled: 1,
      willCancel: 2,
      willReverse: 1,
    })
  })

  it('🛑 excludes an ALREADY REVERSED build from willReverse, but not from completed', async () => {
    // The build is still a completed build of this run and the card says so.
    // What it is not is work the undo has left to do: `reverseBuild` would
    // refuse it, so counting it would over-state the ledger writes.
    given([
      runRow({ buildId: 'bld_1', status: 'completed' }),
      runRow({ buildId: 'bld_2', status: 'completed', reversedByBuildId: 'bld_rev' }),
      runRow({ buildId: 'bld_3', status: 'completed', reversedByBuildId: 'bld_rev_2' }),
    ])

    const summary = await read(7)

    expect(summary.completed).toBe(3)
    expect(summary.willReverse).toBe(1)
    expect(summary.willCancel).toBe(0)
  })

  it('a run number no build carries is an EMPTY summary, never an error', async () => {
    // 45 section 10.8: a run whose buckets all failed allocated a number and
    // wrote nothing. A 404 there reads as "your data is missing".
    given([])

    const summary = await read(9)

    expect(summary).toEqual({
      runNumber: 9,
      total: 0,
      planned: 0,
      inProgress: 0,
      completed: 0,
      canceled: 0,
      willCancel: 0,
      willReverse: 0,
      periodStart: null,
      periodEnd: null,
      ranAt: null,
    })
  })

  it('reads empty, and issues no query, when the org has no build_batch_run field', async () => {
    h.fields.delete('build_batch_run')
    given([runRow()])

    const summary = await read(7)

    expect(summary.total).toBe(0)
    expect(h.issued).toEqual([])
  })

  it('reads empty when the org has no build definition at all', async () => {
    h.defs = new Map()

    expect((await read(7)).total).toBe(0)
    expect(h.issued).toEqual([])
  })

  it('spans the run period and dates it from the FIRST build written', async () => {
    given([
      runRow({
        buildId: 'bld_1',
        createdAt: new Date('2026-03-01T09:00:00.000Z'),
        periodStart: '2026-02-01T00:00:00.000Z',
        periodEnd: '2026-03-01T00:00:00.000Z',
      }),
      runRow({
        buildId: 'bld_2',
        createdAt: new Date('2026-03-01T08:00:00.000Z'),
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-02-01T00:00:00.000Z',
      }),
    ])

    const summary = await read(7)

    expect(summary.periodStart).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(summary.periodEnd).toEqual(new Date('2026-03-01T00:00:00.000Z'))
    expect(summary.ranAt).toEqual(new Date('2026-03-01T08:00:00.000Z'))
  })

  it('counts a build ONCE even when the reversal join fans out', async () => {
    // Two reversals of one build should never exist, and if they ever did the
    // total is a number somebody reconciles against a list.
    given([
      runRow({ buildId: 'bld_1', status: 'completed', reversedByBuildId: null }),
      runRow({ buildId: 'bld_1', status: 'completed', reversedByBuildId: 'bld_rev' }),
    ])

    const summary = await read(7)

    expect(summary.total).toBe(1)
    expect(summary.willReverse).toBe(0)
  })

  it('never counts a build whose status is missing as cancellable or reversible', async () => {
    // `resolveBuildStatus` returns `null` rather than defaulting, and an undo
    // must not guess: guessing either cancels a live run or reverses one that
    // wrote nothing.
    given([runRow({ buildId: 'bld_1', status: null })])

    const summary = await read(7)

    expect(summary.total).toBe(1)
    expect(summary.willCancel).toBe(0)
    expect(summary.willReverse).toBe(0)
  })
})

describe('listBatchRuns', () => {
  it('groups every run and returns them newest first', async () => {
    given([
      runRow({ buildId: 'bld_1', runNumber: 1, status: 'completed' }),
      runRow({ buildId: 'bld_2', runNumber: 3, status: 'planned' }),
      runRow({ buildId: 'bld_3', runNumber: 3, status: 'completed' }),
      runRow({ buildId: 'bld_4', runNumber: 2, status: 'canceled' }),
    ])

    const runs = await list()

    expect(runs.map((run) => run.runNumber)).toEqual([3, 2, 1])
    expect(runs[0]).toMatchObject({
      total: 2,
      planned: 1,
      completed: 1,
      willCancel: 1,
      willReverse: 1,
    })
    expect(runs[1]).toMatchObject({ total: 1, canceled: 1, willCancel: 0, willReverse: 0 })
    expect(runs[2]).toMatchObject({ total: 1, completed: 1, willReverse: 1 })
  })

  it('issues ONE query for every run there is', async () => {
    given([runRow({ runNumber: 1 }), runRow({ buildId: 'bld_2', runNumber: 2 })])

    await list()

    expect(h.issued).toEqual([RUN_BUILDS])
  })

  it('is an empty list, not an error, for an org that has never run a batch', async () => {
    given([])
    expect(await list()).toEqual([])
  })
})

describe('readBatchRunBuilds', () => {
  it('returns the run oldest first, carrying what the undo classifies on', async () => {
    given([
      runRow({
        buildId: 'bld_late',
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        status: 'completed',
        reversedByBuildId: 'bld_rev',
      }),
      runRow({
        buildId: 'bld_early',
        createdAt: new Date('2026-03-01T09:00:00.000Z'),
        status: 'planned',
      }),
    ])

    const result = await readBatchRunBuilds(db, ORG, 7)
    expect(result.isOk()).toBe(true)
    const builds = result._unsafeUnwrap()

    // Oldest first, so an interrupted undo has undone a PREFIX of the run.
    expect(builds.map((build) => build.buildId)).toEqual(['bld_early', 'bld_late'])
    expect(builds[0]).toMatchObject({
      status: 'planned',
      partId: LIFT,
      alreadyReversed: false,
      isReversal: false,
      runNumber: 7,
    })
    expect(builds[1]).toMatchObject({ status: 'completed', alreadyReversed: true })
  })

  it('flags a build that is ITSELF a reversal', async () => {
    // It should never carry a run number at all (that is what
    // `reverse-build-batch-run.test.ts` pins), so this is read rather than
    // assumed, and the undo skips it instead of chaining reversals.
    given([runRow({ status: 'completed', reversalOfBuildId: 'bld_original' })])

    const result = await readBatchRunBuilds(db, ORG, 7)
    expect(result._unsafeUnwrap()[0]).toMatchObject({ isReversal: true })
    expect((await read(7)).willReverse).toBe(0)
  })
})
