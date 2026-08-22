// packages/lib/src/jobs/maintenance/__tests__/storage-cleanup-job.test.ts

/**
 * Regression test for `docs/files-upload-architecture-guide.md` §11.2.
 *
 * `deleteMarkedStorageLocations` called `deleteByKey({ provider, key })` with no
 * bucket, so every sweep aimed at the provider default (private) bucket. S3
 * answers 204 for a key that is not there, so a PUBLIC-bucket object was
 * reported as deleted while the real object leaked — silently, and forever.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ db: null as any }))

// Partial mock: `@auxx/logger/run-log` imports sink-registration helpers from this
// barrel at module load, so a full replacement breaks whichever test file happens
// to load it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@auxx/database', async () => {
  const { createSchemaMock } = await import('../../../test/database-mock')
  return {
    database: {
      select: (...args: unknown[]) => h.db.select(...args),
      delete: (...args: unknown[]) => h.db.delete(...args),
      execute: (...args: unknown[]) => h.db.execute(...args),
    },
    schema: createSchemaMock(),
    IntegrationProviderTypeValues: ['google', 'outlook'],
  }
})

vi.mock('@auxx/redis', () => ({ getRedisClient: vi.fn(async () => null) }))

vi.mock('../../../email/polling-import-cache', () => ({ clearImportCache: vi.fn() }))

const purgeMediaAssets = vi.fn(async () => [] as string[])
vi.mock('../../../files/core/media-asset-purge', () => ({
  purgeMediaAssets: (...args: unknown[]) => purgeMediaAssets(...(args as [])),
}))

const mockDeleteByKey = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../files/storage/storage-manager', () => ({
  StorageManager: class {
    deleteByKey = mockDeleteByKey
  },
}))

import type { JobContext } from '../../types'
import { type StorageCleanupJobData, storageCleanupJob } from '../storage-cleanup-job'

type MarkedLocation = {
  id: string
  provider: string
  externalId: string
  metadata?: Record<string, unknown> | null
}

/**
 * Drizzle-shaped stub. The sweep issues exactly one shape of read —
 * `select(projection).from(StorageLocation).where(...).limit(n)` — so the stub
 * records the projection (that is where the missing `metadata` column shows up)
 * and hands back one batch, then drains.
 */
function createFakeDb(batches: MarkedLocation[][]) {
  const projections: Record<string, unknown>[] = []
  let next = 0

  return {
    projections,
    db: {
      execute: vi.fn(async () => ({ rows: [] })),
      select: (projection: Record<string, unknown>) => {
        projections.push(projection)
        const rows = batches[next++] ?? []
        // Only the columns the caller actually projected come back from PG.
        const shaped = rows.map((row) =>
          Object.fromEntries(
            Object.keys(projection).map((key) => [key, (row as Record<string, unknown>)[key]])
          )
        )
        const chain: any = {
          from: () => chain,
          where: () => chain,
          limit: async () => shaped,
        }
        return chain
      },
      delete: () => ({ where: async () => undefined }),
    },
  }
}

function ctx(data: StorageCleanupJobData): JobContext<StorageCleanupJobData> {
  return {
    job: { data },
    data,
    jobId: 'job-1',
    updateProgress: vi.fn(),
  } as unknown as JobContext<StorageCleanupJobData>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.db = null
})

describe('storageCleanupJob → deleteMarkedStorageLocations', () => {
  it('deletes from the bucket recorded on the StorageLocation, not the provider default', async () => {
    const fake = createFakeDb([
      [
        {
          id: 'loc-public',
          provider: 'S3',
          externalId: 'org123/avatars/a.png',
          metadata: { bucket: 'test-public-bucket', key: 'org123/avatars/a.png' },
        },
      ],
    ])
    h.db = fake.db

    const result = await storageCleanupJob(ctx({ type: 'organization', organizationId: 'org123' }))

    expect(mockDeleteByKey).toHaveBeenCalledTimes(1)
    expect(mockDeleteByKey).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'S3',
        key: 'org123/avatars/a.png',
        bucket: 'test-public-bucket',
      })
    )
    expect(result.s3ObjectsDeleted).toBe(1)
    expect(result.storageLocationsDeleted).toBe(1)
  })

  it('selects the metadata column so the bucket is available at all', async () => {
    const fake = createFakeDb([[]])
    h.db = fake.db

    await storageCleanupJob(ctx({ type: 'organization', organizationId: 'org123' }))

    expect(fake.projections[0]).toBeDefined()
    expect(Object.keys(fake.projections[0]!)).toContain('metadata')
  })

  it('leaves the bucket undefined for a row that has none rather than inventing one', async () => {
    const fake = createFakeDb([
      [
        {
          id: 'loc-legacy',
          provider: 'S3',
          externalId: 'org123/legacy.bin',
          metadata: {},
        },
      ],
    ])
    h.db = fake.db

    await storageCleanupJob(ctx({ type: 'organization', organizationId: 'org123' }))

    expect(mockDeleteByKey).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'org123/legacy.bin', bucket: undefined })
    )
  })
})
