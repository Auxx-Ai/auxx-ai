// packages/lib/src/inventory/builds/__tests__/build-table.int.test.ts
// The `Build` table's reads and write primitives against a real database (plans/mrp/23 §3).

import { type Database, schema, type Transaction } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ConflictError, NotFoundError } from '../../../errors'
import {
  getBuild,
  hasBuildReversal,
  listBuilds,
  listUnpostedBuilds,
  lockBuild,
  readBuildMovements,
  readBuildsByIds,
} from '../build-queries'
import { insertBuild, insertBuilds, updateBuild } from '../build-writes'
import { insertTestBuild, readTestBuild, seedBuildOrg } from './support/build-fixture'

vi.mock('../../../events/publisher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publisher: { publish: async () => {}, publishLater: async () => {} },
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dedup/enqueue-scan')>()),
  enqueueDuplicateScan: async () => {},
}))
vi.mock('../../../realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../realtime')>()),
  getRealtimeService: () => ({ publish: async () => true }),
}))

const db = () => getTestDb() as unknown as Database
const inTx = <T>(fn: (tx: Transaction) => Promise<T>) =>
  db().transaction((tx) => fn(tx as unknown as Transaction))

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 12, minute))

describe('insertBuilds', () => {
  it('numbers a batch from one range, in input order, with the column defaults', async () => {
    const f = await seedBuildOrg({ components: 1 })
    const builds = await insertBuilds(db(), f.organizationId, f.userId, [
      { partId: f.producedPartId, quantityPlanned: 2 },
      { partId: f.producedPartId, quantityPlanned: 3, number: 'B-CUSTOM' },
      { partId: f.producedPartId, quantityPlanned: 4 },
    ])

    expect(builds.map((b) => [b.number, b.quantityPlanned])).toEqual([
      ['B-0001', 2],
      ['B-CUSTOM', 3],
      ['B-0002', 4],
    ])
    expect(builds[0]).toMatchObject({
      status: 'planned',
      source: 'manual',
      partId: f.producedPartId,
      createdById: f.userId,
      materialCost: null,
      reversalOfBuildId: null,
    })
    expect((await insertTestBuild(f)).number).toBe('B-0003')
  })

  it('refuses a second reversal of one build with a ConflictError', async () => {
    const f = await seedBuildOrg({ components: 1 })
    const original = await insertTestBuild(f, { status: 'completed', quantityProduced: 5 })
    expect(await hasBuildReversal(db(), f.organizationId, original.buildId)).toBe(false)

    const reversal = { partId: f.producedPartId, status: 'completed' as const }
    await insertBuild(db(), f.organizationId, f.userId, {
      ...reversal,
      reversalOfBuildId: original.buildId,
      quantityProduced: -5,
    })
    expect(await hasBuildReversal(db(), f.organizationId, original.buildId)).toBe(true)

    await expect(
      insertBuild(db(), f.organizationId, f.userId, {
        ...reversal,
        reversalOfBuildId: original.buildId,
      })
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('reads', () => {
  it('scopes a build to its organization', async () => {
    const f = await seedBuildOrg({ components: 1 })
    const other = await createTestOrganization()
    const build = await insertTestBuild(f)

    expect((await getBuild(db(), f.organizationId, build.buildId))._unsafeUnwrap()).toEqual(build)
    expect((await getBuild(db(), other.id, build.buildId))._unsafeUnwrap()).toBeNull()
    expect(await readBuildsByIds(db(), other.id, [build.buildId])).toEqual([])
  })

  it('filters and pages builds newest first, and lists unposted completions', async () => {
    const f = await seedBuildOrg({ components: 1 })
    const component = f.componentPartIds[0]!
    const a = await insertTestBuild(f, { createdAt: at(1), source: 'batch', batchRun: 7 })
    const b = await insertTestBuild(f, { createdAt: at(2), status: 'completed' })
    const c = await insertTestBuild(f, { createdAt: at(3), partId: component })
    const d = await insertTestBuild(f, {
      createdAt: at(4),
      status: 'completed',
      postedAt: at(5),
    })

    const ids = async (filters: Parameters<typeof listBuilds>[2]) =>
      (await listBuilds(db(), f.organizationId, filters))._unsafeUnwrap().map((x) => x.buildId)

    expect(await ids({})).toEqual([d.buildId, c.buildId, b.buildId, a.buildId])
    expect(await ids({ status: 'completed' })).toEqual([d.buildId, b.buildId])
    expect(await ids({ source: 'batch' })).toEqual([a.buildId])
    expect(await ids({ batchRun: 7 })).toEqual([a.buildId])
    expect(await ids({ partId: component })).toEqual([c.buildId])
    expect(await ids({ limit: 2, offset: 1 })).toEqual([c.buildId, b.buildId])

    const unposted = (await listUnpostedBuilds(db(), f.organizationId))._unsafeUnwrap()
    expect(unposted.map((x) => x.buildId)).toEqual([b.buildId])
  })

  it('reads the movements linked to a build with their frozen costs', async () => {
    const f = await seedBuildOrg({ components: 1 })
    const build = await insertTestBuild(f, { status: 'completed' })
    await db().insert(schema.StockMovement).values({
      organizationId: f.organizationId,
      partId: f.producedPartId,
      type: 'build_produce',
      quantity: 2,
      unitCostMinor: 12_500,
      extendedCostMinor: 25_000,
      costBasis: 'standard',
      buildId: build.buildId,
    })

    const [movement] = await readBuildMovements(db(), f.organizationId, build.buildId)
    expect(movement).toMatchObject({
      partId: f.producedPartId,
      type: 'build_produce',
      quantity: 2,
      unitCost: 12_500,
      extendedCost: 25_000,
      costBasis: 'standard',
    })
  })
})

describe('lock and update', () => {
  it('locks a build and writes its columns in the same transaction', async () => {
    const f = await seedBuildOrg({ components: 1 })
    const build = await insertTestBuild(f)
    const completedAt = at(30)

    const updated = await inTx(async (tx) => {
      const locked = await lockBuild(tx, f.organizationId, build.buildId)
      expect(locked.status).toBe('planned')
      return updateBuild(tx, f.organizationId, build.buildId, {
        status: 'completed',
        quantityProduced: 1,
        completedAt,
        materialCost: 1_000.5,
      })
    })

    expect(updated).toMatchObject({ status: 'completed', completedAt, materialCost: 1_000.5 })
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(build.updatedAt.getTime())
    expect(await readTestBuild(f, build.buildId)).toEqual(updated)
  })

  it('refuses a missing build', async () => {
    const f = await seedBuildOrg({ components: 1 })

    await expect(inTx((tx) => lockBuild(tx, f.organizationId, 'nope'))).rejects.toBeInstanceOf(
      NotFoundError
    )
    await expect(
      inTx((tx) => updateBuild(tx, f.organizationId, 'nope', { notes: 'x' }))
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
