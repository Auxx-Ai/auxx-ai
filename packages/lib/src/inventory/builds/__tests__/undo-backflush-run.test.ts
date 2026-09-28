// packages/lib/src/inventory/builds/__tests__/undo-backflush-run.test.ts
//
// A slice undoes up to N actionable builds after the cursor, checkpoints, then walks the next run
// and finally asks for finalize. A failed build is recorded and passed, never retried forever.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchRunBuild } from '../batch-run-queries'
import type { UndoBackflushRunMetadata } from '../undo-backflush-types'

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  builds: new Map<number, BatchRunBuild[]>(),
  undone: [] as string[],
  failing: new Set<string>(),
  checkpoints: [] as Array<Record<string, unknown>>,
  advanced: true,
}))

vi.mock('../undo-backflush-queries', () => ({
  readUndoBackflushRunRow: vi.fn(async () => h.row),
  listBackflushRunNumbers: vi.fn(async () => []),
}))
vi.mock('../undo-backflush-mutations', () => ({
  markUndoBackflushRunStarted: vi.fn(async () => true),
  checkpointUndoBackflushRun: vi.fn(async (_db: unknown, _id: string, input: never) => {
    h.checkpoints.push(input)
    return h.advanced
  }),
  claimUndoBackflushRun: vi.fn(),
  completeUndoBackflushRun: vi.fn(),
}))
vi.mock('../undo-backflush-realtime', () => ({ publishUndoBackflushRun: vi.fn(async () => {}) }))
vi.mock('../batch-run-queries', () => ({
  readBatchRunBuilds: vi.fn(async (_db: unknown, _org: string, run: number) =>
    ok([...(h.builds.get(run) ?? [])])
  ),
  listBatchRuns: vi.fn(),
}))
vi.mock('../undo-batch-run', () => ({
  undoBatchRunBuild: vi.fn(
    async (
      _db: unknown,
      _org: string,
      _user: string,
      _run: number,
      build: BatchRunBuild,
      summary: { reversed: unknown[]; skipped: unknown[] }
    ) => {
      if (h.failing.has(build.buildId)) throw new Error('refused')
      if (build.alreadyReversed) {
        summary.skipped.push({ buildId: build.buildId })
        return
      }
      h.undone.push(build.buildId)
      summary.reversed.push({ buildId: build.buildId })
    }
  ),
}))
vi.mock('../../../cache', () => ({ getCachedEntityDefId: vi.fn(async () => null) }))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishRecordsInvalidated: vi.fn(),
}))

import { parseUndoCursor, runUndoBackflushSlice } from '../undo-backflush-run'

const at = new Date('2026-09-26T03:40:00Z')
function build(id: string, extra: Partial<BatchRunBuild> = {}): BatchRunBuild {
  return {
    buildId: id,
    runNumber: 0,
    status: 'completed',
    partId: 'p',
    alreadyReversed: false,
    isReversal: false,
    periodStart: null,
    periodEnd: null,
    createdAt: at,
    ...extra,
  }
}

function meta(cursor: string | null, runNumbers = [15, 13]): UndoBackflushRunMetadata {
  return {
    scope: 'backflush',
    runNumbers,
    actorUserId: 'u1',
    cursor,
    cancelled: 0,
    reversed: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    recoveries: 0,
    finalizedAt: null,
  }
}

function setRow(cursor: string | null) {
  h.row = {
    id: 'run_1',
    organizationId: 'org_1',
    status: 'IN_PROGRESS',
    totalRecords: 5,
    processedRecords: 0,
    failedRecords: 0,
    error: null,
    metadata: meta(cursor),
  }
}

beforeEach(() => {
  h.builds = new Map([
    // Same createdAt, so the id orders them.
    [15, [build('c'), build('a'), build('b', { alreadyReversed: true }), build('d')]],
    [13, [build('x')]],
  ])
  h.undone = []
  h.failing = new Set()
  h.checkpoints = []
  h.advanced = true
})

describe('runUndoBackflushSlice', () => {
  it('undoes up to the limit of actionable builds and checkpoints after the last one', async () => {
    setRow(null)
    const step = await runUndoBackflushSlice({} as never, 'org_1', 'run_1', { sliceBuilds: 2 })

    // `b` is already reversed: visited, skipped, and not counted against the limit.
    expect(h.undone).toEqual(['a', 'c'])
    expect(step._unsafeUnwrap()).toEqual({ kind: 'slice', cursor: `0|${at.getTime()}|c` })
    expect(h.checkpoints[0]).toMatchObject({ expectedCursor: null, processedRecords: 2 })
  })

  it('moves to the next run when this one is exhausted, then asks for finalize', async () => {
    setRow(`0|${at.getTime()}|c`)
    const first = await runUndoBackflushSlice({} as never, 'org_1', 'run_1', { sliceBuilds: 10 })
    expect(h.undone).toEqual(['d'])
    expect(first._unsafeUnwrap()).toEqual({ kind: 'slice', cursor: '1|' })

    setRow('1|')
    const second = await runUndoBackflushSlice({} as never, 'org_1', 'run_1', { sliceBuilds: 10 })
    expect(h.undone).toEqual(['d', 'x'])
    expect(second._unsafeUnwrap()).toEqual({ kind: 'finalize' })
  })

  it('records a crashed build as failed and moves past it', async () => {
    h.failing.add('a')
    setRow(null)
    const step = await runUndoBackflushSlice({} as never, 'org_1', 'run_1', { sliceBuilds: 1 })
    expect(step._unsafeUnwrap()).toEqual({ kind: 'slice', cursor: `0|${at.getTime()}|a` })
    const saved = h.checkpoints[0]?.metadata as UndoBackflushRunMetadata
    expect(saved.failed).toBe(1)
    expect(saved.failures[0]).toMatchObject({ runNumber: 15, buildId: 'a', reason: 'refused' })
  })

  it('drops a duplicate job whose cursor already moved on', async () => {
    setRow('1|')
    const step = await runUndoBackflushSlice({} as never, 'org_1', 'run_1', {
      expectedCursor: null,
    })
    expect(step._unsafeUnwrap()).toBeNull()
    expect(h.undone).toEqual([])
  })

  it('returns null when another worker checkpointed first', async () => {
    h.advanced = false
    setRow(null)
    const step = await runUndoBackflushSlice({} as never, 'org_1', 'run_1', { sliceBuilds: 1 })
    expect(step._unsafeUnwrap()).toBeNull()
  })
})

describe('parseUndoCursor', () => {
  it('reads the start, a run start and a position', () => {
    expect(parseUndoCursor(null)).toEqual({ runIndex: 0, after: null })
    expect(parseUndoCursor('2|')).toEqual({ runIndex: 2, after: null })
    expect(parseUndoCursor('1|1000|b1')).toEqual({
      runIndex: 1,
      after: { createdAt: new Date(1000), buildId: 'b1' },
    })
  })
})
