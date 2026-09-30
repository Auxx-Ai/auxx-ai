// packages/lib/src/inventory/builds/__tests__/batch-run-queries.int.test.ts
// The batch-side reads over the `Build` table against a real database (plans/mrp/23 B3).

import type { Database } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { listBatchRuns, readBatchRun, readBatchRunBuilds } from '../batch-run-queries'
import { readOrderRaisedBuilds } from '../reconcile-queries'
import { hasStandingBackflushBuilds, listBackflushRunNumbers } from '../undo-backflush-queries'
import { type BuildFixture, insertTestBuild, seedBuildOrg } from './support/build-fixture'

vi.mock('../../../events/publisher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publisher: { publish: async () => {}, publishLater: async () => {} },
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dedup/enqueue-scan')>()),
  enqueueDuplicateScan: async () => {},
}))

const db = () => getTestDb() as unknown as Database

const day = (d: number) => new Date(Date.UTC(2026, 0, d))

/** A completed build and the build that reverses it. */
async function completedAndReversed(f: BuildFixture, batchRun: number) {
  const original = await insertTestBuild(f, { status: 'completed', source: 'batch', batchRun })
  await insertTestBuild(f, {
    status: 'completed',
    source: 'batch',
    reversalOfBuildId: original.buildId,
    quantityPlanned: null,
  })
  return original
}

describe('readBatchRun / listBatchRuns', () => {
  it('counts one run by status; willReverse leaves out the already reversed', async () => {
    const f = await seedBuildOrg({ components: 1 })
    const run = { source: 'batch' as const, batchRun: 7 }
    await insertTestBuild(f, { ...run, status: 'planned', periodStart: day(1), periodEnd: day(8) })
    await insertTestBuild(f, {
      ...run,
      status: 'in_progress',
      periodStart: day(8),
      periodEnd: day(15),
    })
    await insertTestBuild(f, { ...run, status: 'completed' })
    await insertTestBuild(f, { ...run, status: 'canceled' })
    await completedAndReversed(f, 7)
    await insertTestBuild(f, { source: 'batch', batchRun: 8 })

    const summary = (await readBatchRun(db(), f.organizationId, 7))._unsafeUnwrap()

    expect(summary).toMatchObject({
      runNumber: 7,
      total: 5,
      planned: 1,
      inProgress: 1,
      completed: 2,
      canceled: 1,
      willCancel: 2,
      willReverse: 1,
      periodStart: day(1),
      periodEnd: day(15),
    })
    expect(summary.ranAt).toBeInstanceOf(Date)
  })

  it('is an empty summary for a run number no build carries', async () => {
    const f = await seedBuildOrg({ components: 1 })
    const summary = (await readBatchRun(db(), f.organizationId, 99))._unsafeUnwrap()
    expect(summary).toMatchObject({ runNumber: 99, total: 0, willReverse: 0, ranAt: null })
  })

  it('lists every run of this org, highest number first, and none of a manual build', async () => {
    const f = await seedBuildOrg({ components: 1 })
    const other = await seedBuildOrg({ components: 1 })
    await insertTestBuild(f, { source: 'batch', batchRun: 1, status: 'completed' })
    await insertTestBuild(f, { source: 'batch', batchRun: 3 })
    await insertTestBuild(f, { source: 'batch', batchRun: 3, status: 'completed' })
    await insertTestBuild(f, { source: 'backflush', batchRun: 2, status: 'canceled' })
    await insertTestBuild(f)
    await insertTestBuild(other, { source: 'batch', batchRun: 4 })

    const runs = (await listBatchRuns(db(), f.organizationId))._unsafeUnwrap()

    expect(runs.map((run) => run.runNumber)).toEqual([3, 2, 1])
    expect(runs[0]).toMatchObject({ total: 2, planned: 1, completed: 1, willReverse: 1 })
    expect(runs[1]).toMatchObject({ total: 1, canceled: 1, willCancel: 0, willReverse: 0 })
  })
})

describe('readBatchRunBuilds', () => {
  it('returns the run oldest first with the reversal flags', async () => {
    const f = await seedBuildOrg({ components: 1 })
    const first = await insertTestBuild(f, { source: 'batch', batchRun: 5, createdAt: day(1) })
    const reversed = await completedAndReversed(f, 5)

    const builds = (await readBatchRunBuilds(db(), f.organizationId, 5))._unsafeUnwrap()

    expect(builds.map((b) => b.buildId)).toEqual([first.buildId, reversed.buildId])
    expect(builds[0]).toMatchObject({
      runNumber: 5,
      status: 'planned',
      partId: f.producedPartId,
      alreadyReversed: false,
      isReversal: false,
    })
    expect(builds[1]).toMatchObject({ status: 'completed', alreadyReversed: true })
  })
})

describe('undo-backflush build reads', () => {
  it('lists the backflush run numbers only, newest first', async () => {
    const f = await seedBuildOrg({ components: 1 })
    await insertTestBuild(f, { source: 'backflush', batchRun: 2, status: 'completed' })
    await insertTestBuild(f, { source: 'backflush', batchRun: 6, status: 'completed' })
    await insertTestBuild(f, { source: 'backflush', batchRun: 6, status: 'completed' })
    await insertTestBuild(f, { source: 'batch', batchRun: 9 })

    expect(await listBackflushRunNumbers(db(), f.organizationId)).toEqual([6, 2])
  })

  it('a backflush build stands until it is reversed', async () => {
    const f = await seedBuildOrg({ components: 1 })
    expect(await hasStandingBackflushBuilds(db(), f.organizationId)).toBe(false)

    const build = await insertTestBuild(f, {
      source: 'backflush',
      batchRun: 1,
      status: 'completed',
    })
    expect(await hasStandingBackflushBuilds(db(), f.organizationId)).toBe(true)

    // A reversal copies the source but carries no run, so it does not stand either.
    await insertTestBuild(f, {
      source: 'backflush',
      status: 'completed',
      reversalOfBuildId: build.buildId,
    })
    expect(await hasStandingBackflushBuilds(db(), f.organizationId)).toBe(false)
  })
})

describe('readOrderRaisedBuilds', () => {
  it('returns only the order-raised builds of this order, newest first', async () => {
    const f = await seedBuildOrg({ components: 2 })
    // Any EntityInstance satisfies `Build.orderId`'s FK; the components stand in for two orders.
    const [orderId, otherOrderId] = f.componentPartIds as [string, string]
    const older = await insertTestBuild(f, { source: 'order', orderId, createdAt: day(1) })
    const newer = await insertTestBuild(f, {
      source: 'order',
      orderId,
      status: 'completed',
      createdAt: day(2),
    })
    await insertTestBuild(f, { source: 'manual', orderId })
    await insertTestBuild(f, { source: 'order', orderId: otherOrderId })

    const builds = await readOrderRaisedBuilds(db(), f.organizationId, orderId)

    expect(builds.map((b) => b.buildId)).toEqual([newer.buildId, older.buildId])
  })
})
