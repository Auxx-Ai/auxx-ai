// packages/lib/src/files/lifecycle/__tests__/orphaned-cleanup.test.ts

/**
 * Regression test for `docs/files-upload-architecture-guide.md` §11.2.
 *
 * `deletedFileCleanupJob`'s Phase-2 StorageLocation sweep called
 * `deleteByKey({ provider, key })` with no bucket, so it aimed at the provider
 * default (private) bucket. S3 answers 204 for a key that is not there, so a
 * PUBLIC-bucket object was counted as swept, its DB row hard-deleted, and the
 * real object left behind with nothing left pointing at it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ db: null as any }))

// Partial-mock the logger: `@auxx/logger/run-log` imports sink-registration
// helpers from this barrel at load, so a full replacement breaks whichever
// test file happens to load it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@auxx/database', async () => {
  const { createSchemaMock } = await import('../../../test/database-mock')
  return {
    database: {
      get query() {
        return h.db.query
      },
      select: (...args: unknown[]) => h.db.select(...args),
      delete: (...args: unknown[]) => h.db.delete(...args),
    },
    schema: createSchemaMock(),
    IntegrationProviderTypeValues: ['google', 'outlook'],
  }
})

vi.mock('../cleanup-service', () => ({
  deleteExpiredFiles: vi.fn(async () => ({ deleted: 0, failed: 0 })),
  deleteFilesByIds: vi.fn(async () => ({ deleted: 0, failed: 0 })),
}))

const mockDeleteByKey = vi.fn().mockResolvedValue(undefined)
vi.mock('../../storage/storage-manager', () => ({
  StorageManager: class {
    deleteByKey = mockDeleteByKey
  },
}))

import type { JobContext } from '../../../jobs/types'
import { deletedFileCleanupJob } from '../orphaned-cleanup'

type MarkedLocation = {
  id: string
  provider: string
  externalId: string
  organizationId: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Drizzle-shaped stub covering the two reads this job makes: the soft-deleted
 * `FolderFile` scan (relational query) and the marked-`StorageLocation` sweep
 * (`select(projection).from(...).where(...).limit(n)`). The projection is
 * recorded because that is where a missing `metadata` column shows up.
 */
function createFakeDb(locations: MarkedLocation[]) {
  const projections: Record<string, unknown>[] = []

  return {
    projections,
    db: {
      query: { FolderFile: { findMany: async () => [] } },
      select: (projection: Record<string, unknown>) => {
        projections.push(projection)
        const shaped = locations.map((row) =>
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

function ctx(): JobContext<{ batchSize?: number; dryRun?: boolean }> {
  const data = { batchSize: 100, dryRun: false }
  return {
    job: { data, updateProgress: vi.fn() },
    data,
    jobId: 'job-1',
  } as unknown as JobContext<{ batchSize?: number; dryRun?: boolean }>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.db = null
})

describe('deletedFileCleanupJob → StorageLocation sweep', () => {
  it('deletes from the bucket recorded on the StorageLocation, not the provider default', async () => {
    const fake = createFakeDb([
      {
        id: 'loc-public',
        provider: 'S3',
        externalId: 'org123/avatars/a.png',
        organizationId: 'org123',
        metadata: { bucket: 'test-public-bucket', key: 'org123/avatars/a.png' },
      },
    ])
    h.db = fake.db

    await deletedFileCleanupJob(ctx())

    expect(mockDeleteByKey).toHaveBeenCalledTimes(1)
    expect(mockDeleteByKey).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'S3',
        key: 'org123/avatars/a.png',
        bucket: 'test-public-bucket',
      })
    )
  })

  it('selects the metadata column so the bucket is available at all', async () => {
    const fake = createFakeDb([])
    h.db = fake.db

    await deletedFileCleanupJob(ctx())

    expect(fake.projections[0]).toBeDefined()
    expect(Object.keys(fake.projections[0]!)).toContain('metadata')
  })

  it('leaves the bucket undefined for a row that has none rather than inventing one', async () => {
    const fake = createFakeDb([
      {
        id: 'loc-legacy',
        provider: 'S3',
        externalId: 'org123/legacy.bin',
        organizationId: 'org123',
        metadata: {},
      },
    ])
    h.db = fake.db

    await deletedFileCleanupJob(ctx())

    expect(mockDeleteByKey).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'org123/legacy.bin', bucket: undefined })
    )
  })
})
