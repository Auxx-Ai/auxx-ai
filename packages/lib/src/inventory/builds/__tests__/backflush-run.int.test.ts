// packages/lib/src/inventory/builds/__tests__/backflush-run.int.test.ts
//
// The sliced backflush run end to end on real SQL and real build completions (plans/mrp/11 §8):
// slices write what the preview planned, a slice killed before its checkpoint re-runs without
// duplicates in the same batch, a second run is refused, finalize runs once, the stale sweep
// re-enqueues, and the realtime lifecycle frames go out.

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../errors'
import { recoverStaleBackflushRuns } from '../../../jobs/maintenance/backflush-job'
import { readPartNetThrough } from '../../costing/dated-reads'
import { endOfLocalDay } from '../backfill-builds'
import { previewBackflush } from '../backflush-preview'
import { finalizeBackflushRun, runBackflushSlice, startBackflushRun } from '../backflush-run'
import { readBackflushRunRow } from '../backflush-run-queries'
import { readBatchRunBuilds } from '../batch-run-queries'
import { type BuildFixture, seedBuildOrg } from './support/build-fixture'
import { insertRawMovements } from './support/raw-movements'

vi.mock('../../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dedup/enqueue-scan')>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})

const h = vi.hoisted(() => ({
  frames: [] as Array<{ event: string; data: Record<string, unknown> }>,
  enqueued: [] as Array<{ name: string; data: Record<string, unknown>; jobId?: string }>,
  failNextCheckpoint: false,
}))

vi.mock('../../../realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../realtime')>()
  const service = {
    publish: async (_room: string, event: string, data: Record<string, unknown>) => {
      h.frames.push({ event, data })
      return true
    },
  }
  return { ...actual, getRealtimeService: () => service }
})
vi.mock('../../../jobs/queues', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getQueue: () => ({
    add: async (name: string, data: Record<string, unknown>, opts: { jobId?: string }) => {
      h.enqueued.push({ name, data, jobId: opts?.jobId })
    },
  }),
}))
vi.mock('../../../accounting/work-items/recovery', () => ({
  requestAccountingRecovery: async () => {},
}))
vi.mock('../backflush-run-mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../backflush-run-mutations')>()
  return {
    ...actual,
    // A worker killed after the slice's builds committed and before its checkpoint.
    checkpointBackflushRun: async (...args: Parameters<typeof actual.checkpointBackflushRun>) => {
      if (h.failNextCheckpoint) {
        h.failNextCheckpoint = false
        throw new Error('worker killed')
      }
      return actual.checkpointBackflushRun(...args)
    },
  }
})

const db = () => getTestDb() as unknown as Database
const DAYS = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
const RANGE = { from: '2026-09-01', to: '2026-09-05' }

let f: BuildFixture

beforeEach(async () => {
  h.frames = []
  h.enqueued = []
  h.failNextCheckpoint = false
  f = await seedBuildOrg({ components: 2 })
  // A few sales of the finished good every day; nothing in stock.
  await insertRawMovements(
    f.organizationId,
    f.movementDefId,
    DAYS.flatMap((day, i) => [
      { partId: f.producedPartId, quantity: -(i + 1), occurredAt: new Date(`${day}T15:00:00Z`) },
      { partId: f.producedPartId, quantity: -2, occurredAt: new Date(`${day}T18:00:00Z`) },
    ])
  )
})

async function start() {
  const started = await startBackflushRun(db(), f.organizationId, {
    ...RANGE,
    actorUserId: f.userId,
  })
  if (started.isErr()) throw started.error
  return started.value
}

/** Drive slices of two days until the run asks for its finalize. */
async function walk(runId: string) {
  let cursor: string | null = null
  for (let guard = 0; guard < 10; guard += 1) {
    const step = await runBackflushSlice(db(), f.organizationId, runId, {
      sliceDays: 2,
      expectedCursor: cursor,
    })
    if (step.isErr()) throw step.error
    if (!step.value || step.value.kind === 'finalize') return
    cursor = step.value.cursor
  }
  throw new Error('the run never reached its finalize')
}

async function expectEveryDayBuiltToZero() {
  for (const day of DAYS) {
    const net = await readPartNetThrough(
      f.organizationId,
      [f.producedPartId],
      endOfLocalDay(day, 'UTC')
    )
    expect(net.get(f.producedPartId), day).toBe(0)
  }
}

describe('a sliced backflush run', () => {
  it('writes in slices exactly what the preview planned, then finalizes once', async () => {
    const preview = await previewBackflush(db(), f.organizationId, RANGE)
    if (preview.isErr()) throw preview.error
    expect(preview.value.buildCount).toBe(DAYS.length)

    const { runId, batchRun } = await start()
    await walk(runId)
    const finalized = await finalizeBackflushRun(db(), f.organizationId, runId)
    expect(finalized._unsafeUnwrap()).toBe(true)

    const builds = (await readBatchRunBuilds(db(), f.organizationId, batchRun))._unsafeUnwrap()
    expect(builds).toHaveLength(preview.value.buildCount)
    expect(builds.every((b) => b.status === 'completed')).toBe(true)
    await expectEveryDayBuiltToZero()

    const row = await readBackflushRunRow(db(), f.organizationId, runId)
    expect(row?.status).toBe('COMPLETED')
    expect(row?.processedRecords).toBe(DAYS.length)
    expect(row?.metadata.cursor).toBe('2026-09-05')
    expect(row?.metadata.written).toBe(DAYS.length)
    expect(row?.metadata.finalizedAt).toBeTruthy()

    // A finalize retried after it finished is a no-op.
    expect((await finalizeBackflushRun(db(), f.organizationId, runId))._unsafeUnwrap()).toBe(false)

    const kinds = h.frames.filter((fr) => fr.event === 'backflush:run').map((fr) => fr.data.kind)
    expect(kinds[0]).toBe('started')
    expect(kinds.at(-1)).toBe('finished')
    expect(kinds).toContain('progress')
  }, 120_000)

  it('re-runs a slice killed before its checkpoint without duplicates, in the same batch', async () => {
    const { runId, batchRun } = await start()
    const first = await runBackflushSlice(db(), f.organizationId, runId, { sliceDays: 2 })
    expect(first._unsafeUnwrap()).toEqual({ kind: 'slice', cursor: '2026-09-02' })

    h.failNextCheckpoint = true
    const killed = await runBackflushSlice(db(), f.organizationId, runId, {
      sliceDays: 2,
      expectedCursor: '2026-09-02',
    })
    expect(killed.isErr()).toBe(true)
    expect((await readBackflushRunRow(db(), f.organizationId, runId))?.metadata.cursor).toBe(
      '2026-09-02'
    )

    // The retry walks the same two days again: the ledger already holds their builds.
    const retried = await runBackflushSlice(db(), f.organizationId, runId, {
      sliceDays: 2,
      expectedCursor: '2026-09-02',
    })
    expect(retried._unsafeUnwrap()).toEqual({ kind: 'slice', cursor: '2026-09-04' })
    // A stale duplicate of the slice just walked does nothing.
    const duplicate = await runBackflushSlice(db(), f.organizationId, runId, {
      sliceDays: 2,
      expectedCursor: '2026-09-02',
    })
    expect(duplicate._unsafeUnwrap()).toBeNull()

    const last = await runBackflushSlice(db(), f.organizationId, runId, {
      sliceDays: 2,
      expectedCursor: '2026-09-04',
    })
    expect(last._unsafeUnwrap()).toEqual({ kind: 'finalize' })
    ;(await finalizeBackflushRun(db(), f.organizationId, runId))._unsafeUnwrap()

    const builds = (await readBatchRunBuilds(db(), f.organizationId, batchRun))._unsafeUnwrap()
    expect(builds).toHaveLength(DAYS.length)
    await expectEveryDayBuiltToZero()
  }, 120_000)

  it('refuses a second run while one is active, and burns no batch number for it', async () => {
    const { batchRun } = await start()
    const second = await startBackflushRun(db(), f.organizationId, {
      ...RANGE,
      actorUserId: f.userId,
    })
    expect(second.isErr() && second.error).toBeInstanceOf(ConflictError)

    const rows = await db()
      .select({ id: schema.SyncJob.id })
      .from(schema.SyncJob)
      .where(eq(schema.SyncJob.organizationId, f.organizationId))
    expect(rows).toHaveLength(1)
    const [sequence] = await db()
      .select({ current: schema.RecordSequence.currentNumber })
      .from(schema.RecordSequence)
      .where(eq(schema.RecordSequence.organizationId, f.organizationId))
    expect(sequence?.current).toBe(batchRun)
  })

  it('the stale sweep re-enqueues a run whose heartbeat stopped, at its cursor', async () => {
    const { runId } = await start()
    ;(await runBackflushSlice(db(), f.organizationId, runId, { sliceDays: 2 }))._unsafeUnwrap()
    await db()
      .update(schema.SyncJob)
      .set({ updatedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(schema.SyncJob.id, runId))

    await recoverStaleBackflushRuns()
    expect(h.enqueued).toEqual([
      {
        name: 'backflushJob',
        data: { organizationId: f.organizationId, runId, step: 'slice', cursor: '2026-09-02' },
        jobId: `backflush-${f.organizationId}-${runId}-2026-09-02`,
      },
    ])
    const row = await readBackflushRunRow(db(), f.organizationId, runId)
    expect(row?.metadata.recoveries).toBe(1)
    expect(row?.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })
})
