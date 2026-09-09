// packages/lib/src/builds/__tests__/undo-batch-run.test.ts
//
// `undoBatchRun`, the rules table of
// `plans/money/tasks/45-batch-only-builds.md` section 4.1, and the bucket
// section 10.8 added to it.
//
// The two writers are doubles, which is the point: what is under test is the
// CLASSIFICATION, not what cancelling or reversing does. Three properties, in
// the order they will bite:
//
// 1. 🛑 **`skipped` is not `failed`.** A build that is already cancelled or
//    already reversed needs nothing from an undo. `reverseBuild` refuses it with
//    a `ConflictError` and a per-build isolation loop copied from
//    `executeBackfill` would file that as a failure, and an undo reporting "3
//    failed" for three builds that are correctly undone is a summary people
//    learn to ignore.
// 2. 🛑 **Never a delete.** The movement subledger is append-only, so the only
//    two verbs are cancel and reverse.
// 3. ⚠️ **One refused build must not lose the rest of the run.**

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../../errors'
import type { BatchRunBuild } from '../batch-run-queries'

const ORG = 'org_1'
const USER = 'user_1'
const RUN = 7

const h = vi.hoisted(() => ({
  /** What the run read returns, or the error it fails with. */
  builds: [] as unknown[],
  readError: null as Error | null,
  cancelCalls: [] as { buildId: string; reason?: string }[],
  reverseCalls: [] as { buildId: string; reason?: string }[],
  /** buildId -> the error that writer answers with. Absent means it succeeds. */
  cancelErrors: new Map<string, Error>(),
  reverseErrors: new Map<string, Error>(),
  /** buildId -> an error THROWN rather than returned, which must not escape. */
  cancelThrows: new Map<string, Error>(),
}))

vi.mock('../batch-run-queries', () => ({
  readBatchRunBuilds: vi.fn(async () => {
    const { err, ok } = await import('neverthrow')
    return h.readError ? err(h.readError) : ok(h.builds)
  }),
}))

vi.mock('../build-mutations', () => ({
  cancelBuild: vi.fn(
    async (
      _db: unknown,
      _org: string,
      _user: string,
      input: { buildId: string; reason?: string }
    ) => {
      const { err, ok } = await import('neverthrow')
      h.cancelCalls.push(input)
      const thrown = h.cancelThrows.get(input.buildId)
      if (thrown) throw thrown
      const failure = h.cancelErrors.get(input.buildId)
      return failure ? err(failure) : ok({ buildId: input.buildId })
    }
  ),
}))

vi.mock('../reverse-build', () => ({
  reverseBuild: vi.fn(
    async (
      _db: unknown,
      _org: string,
      _user: string,
      input: { buildId: string; reason?: string }
    ) => {
      const { err, ok } = await import('neverthrow')
      h.reverseCalls.push(input)
      const failure = h.reverseErrors.get(input.buildId)
      return failure
        ? err(failure)
        : ok({
            buildId: `rev_${input.buildId}`,
            recordId: `def_build:rev_${input.buildId}`,
            reversalOfBuildId: input.buildId,
            movementIds: [],
            recalculatedPartIds: [],
          })
    }
  ),
}))

import { undoBatchRun } from '../undo-batch-run'

const db = {} as never

/** One build of the run. `planned`, on the lift, unless told otherwise. */
function build(overrides: Partial<BatchRunBuild> = {}): BatchRunBuild {
  return {
    buildId: 'bld_1',
    runNumber: RUN,
    status: 'planned',
    partId: 'part_lift',
    alreadyReversed: false,
    isReversal: false,
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-02-01T00:00:00.000Z'),
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
    ...overrides,
  }
}

function given(builds: BatchRunBuild[]): void {
  h.builds = builds
}

async function undo() {
  const result = await undoBatchRun(db, ORG, USER, RUN)
  if (result.isErr()) throw result.error
  return result.value
}

/** Every build id in one bucket, so an assertion reads as a set of ids. */
function ids(entries: { buildId: string }[]): string[] {
  return entries.map((entry) => entry.buildId)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.builds = []
  h.readError = null
  h.cancelCalls = []
  h.reverseCalls = []
  h.cancelErrors = new Map()
  h.reverseErrors = new Map()
  h.cancelThrows = new Map()
})

describe('undoBatchRun', () => {
  it('cancels the open builds, reverses the completed ones and skips the rest', async () => {
    given([
      build({ buildId: 'bld_planned', status: 'planned' }),
      build({ buildId: 'bld_open', status: 'in_progress' }),
      build({ buildId: 'bld_done', status: 'completed' }),
      build({ buildId: 'bld_gone', status: 'canceled' }),
    ])

    const summary = await undo()

    expect(summary.runNumber).toBe(RUN)
    expect(summary.total).toBe(4)
    expect(ids(summary.cancelled)).toEqual(['bld_planned', 'bld_open'])
    expect(ids(summary.reversed)).toEqual(['bld_done'])
    expect(ids(summary.skipped)).toEqual(['bld_gone'])
    expect(summary.failed).toEqual([])
    // 🛑 Cancel and reverse are the only two verbs. There is no delete here and
    // there must never be one: the ledger is append-only.
    expect(ids(h.cancelCalls)).toEqual(['bld_planned', 'bld_open'])
    expect(ids(h.reverseCalls)).toEqual(['bld_done'])
  })

  it('names the run in the reason it writes on both verbs', async () => {
    given([
      build({ buildId: 'bld_planned', status: 'planned' }),
      build({ buildId: 'bld_done', status: 'completed' }),
    ])

    await undo()

    expect(h.cancelCalls[0]?.reason).toContain('batch run 7')
    expect(h.reverseCalls[0]?.reason).toContain('batch run 7')
  })

  it('carries the reversing build id back on every reversed entry', async () => {
    given([build({ buildId: 'bld_done', status: 'completed' })])

    const summary = await undo()

    expect(summary.reversed[0]).toMatchObject({
      buildId: 'bld_done',
      partId: 'part_lift',
      outcome: 'reversed',
      reason: null,
      reversalBuildId: 'rev_bld_done',
    })
  })

  it('🛑 an ALREADY REVERSED build is skipped, not failed, and is never sent to reverseBuild', async () => {
    given([
      build({ buildId: 'bld_a', status: 'completed', alreadyReversed: true }),
      build({ buildId: 'bld_b', status: 'completed', alreadyReversed: true }),
      build({ buildId: 'bld_c', status: 'completed', alreadyReversed: true }),
    ])

    const summary = await undo()

    // The defect this rule exists to prevent: "3 failed" for three builds that
    // are correctly already undone.
    expect(summary.failed).toEqual([])
    expect(ids(summary.skipped)).toEqual(['bld_a', 'bld_b', 'bld_c'])
    // Classified, not caught (45 section 10.8): the writer is never reached.
    expect(h.reverseCalls).toEqual([])
  })

  it('skips a build that is itself a reversal, rather than chaining undos', async () => {
    given([build({ buildId: 'bld_rev', status: 'completed', isReversal: true })])

    const summary = await undo()

    expect(ids(summary.skipped)).toEqual(['bld_rev'])
    expect(h.reverseCalls).toEqual([])
  })

  it('classifies the two reverseBuild refusals as skipped even when they come back late', async () => {
    // The backstop: the pre-check and the write are not one transaction, so a
    // reversal written in between still has to read as a skip.
    given([
      build({ buildId: 'bld_conflict', status: 'completed' }),
      build({ buildId: 'bld_bad', status: 'completed' }),
    ])
    h.reverseErrors.set('bld_conflict', new ConflictError('This build has already been reversed.'))
    h.reverseErrors.set('bld_bad', new BadRequestError('This build is itself a reversal.'))

    const summary = await undo()

    expect(ids(summary.skipped)).toEqual(['bld_conflict', 'bld_bad'])
    expect(summary.failed).toEqual([])
    expect(summary.skipped[0]?.reason).toContain('already been reversed')
  })

  it('a refusal that is NOT one of those two is a real failure', async () => {
    given([build({ buildId: 'bld_done', status: 'completed' })])
    h.reverseErrors.set(
      'bld_done',
      new UnprocessableEntityError('This build wrote no stock movements')
    )

    const summary = await undo()

    expect(summary.skipped).toEqual([])
    expect(ids(summary.failed)).toEqual(['bld_done'])
    expect(summary.failed[0]?.reason).toContain('no stock movements')
  })

  it('⚠️ one failing build does not lose the rest of the run', async () => {
    given([
      build({ buildId: 'bld_1', status: 'planned' }),
      build({ buildId: 'bld_2', status: 'planned' }),
      build({ buildId: 'bld_3', status: 'completed' }),
    ])
    h.cancelErrors.set(
      'bld_2',
      new ConflictError('A completed build is reversed, never cancelled.')
    )

    const summary = await undo()

    expect(ids(summary.cancelled)).toEqual(['bld_1'])
    expect(ids(summary.failed)).toEqual(['bld_2'])
    expect(ids(summary.reversed)).toEqual(['bld_3'])
    expect(summary.total).toBe(3)
  })

  it('a THROWN error is caught per build, and the run continues', async () => {
    given([
      build({ buildId: 'bld_1', status: 'planned' }),
      build({ buildId: 'bld_2', status: 'planned' }),
    ])
    h.cancelThrows.set('bld_1', new NotFoundError('Build bld_1 not found'))

    const summary = await undo()

    expect(ids(summary.failed)).toEqual(['bld_1'])
    expect(ids(summary.cancelled)).toEqual(['bld_2'])
  })

  it('⚠️ a run number no build carries is an EMPTY summary, never a NotFoundError', async () => {
    given([])

    const summary = await undo()

    expect(summary).toEqual({
      runNumber: RUN,
      total: 0,
      cancelled: [],
      reversed: [],
      skipped: [],
      failed: [],
    })
    expect(h.cancelCalls).toEqual([])
    expect(h.reverseCalls).toEqual([])
  })

  it('fails a build whose status is missing, rather than guessing a verb', async () => {
    given([build({ buildId: 'bld_odd', status: null })])

    const summary = await undo()

    expect(ids(summary.failed)).toEqual(['bld_odd'])
    expect(h.cancelCalls).toEqual([])
    expect(h.reverseCalls).toEqual([])
  })

  it('refuses as a Result when the run cannot be READ, having written nothing', async () => {
    // The one refusal: undoing "the builds we managed to see" would leave the
    // rest of the run standing while reporting a complete undo.
    h.readError = new UnprocessableEntityError('Builds are not available')

    const result = await undoBatchRun(db, ORG, USER, RUN)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(h.cancelCalls).toEqual([])
    expect(h.reverseCalls).toEqual([])
  })
})
