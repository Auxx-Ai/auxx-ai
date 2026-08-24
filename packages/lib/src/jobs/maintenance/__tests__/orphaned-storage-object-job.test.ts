// packages/lib/src/jobs/maintenance/__tests__/orphaned-storage-object-job.test.ts

/**
 * Regression tests for `docs/files-upload-architecture-guide.md` §11.2 / §10.4(a).
 *
 * The upload-completion compensation path called `cleanupService.scheduleCleanup`,
 * whose every persistence method was a `// TODO` stub that logged
 * "Would store cleanup task" and returned. Nothing was ever persisted, enqueued
 * or retried, so a failed transaction left the S3 object orphaned forever.
 *
 * `files/cleanup/` — the 48-line forwarder that replaced the stub — was deleted
 * in plan 7c: it had zero runtime callers, and its own docstring named a
 * `complete/route.ts` call site that no longer existed. The compensation
 * contract it stood in for is `enqueueOrphanedStorageObjectCleanup`, tested
 * directly below.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' })
const mockGetQueue = vi.fn(() => ({ add: mockQueueAdd }))

vi.mock('../../queues', () => ({
  getQueue: mockGetQueue,
}))

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

const mockDeleteByKey = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../files/storage/storage-manager', () => ({
  StorageManager: class {
    deleteByKey = mockDeleteByKey
  },
  createStorageManager: () => ({ deleteByKey: mockDeleteByKey }),
}))

import type { JobContext } from '../../types'
import {
  enqueueOrphanedStorageObjectCleanup,
  type OrphanedStorageObjectJobData,
  orphanedStorageObjectJob,
} from '../orphaned-storage-object-job'

function job(data: OrphanedStorageObjectJobData): JobContext<OrphanedStorageObjectJobData> {
  return {
    job: { data },
    data,
    jobId: 'job-1',
  } as unknown as JobContext<OrphanedStorageObjectJobData>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('enqueueOrphanedStorageObjectCleanup', () => {
  it('durably enqueues a maintenance job carrying the bucket', async () => {
    await enqueueOrphanedStorageObjectCleanup({
      provider: 'S3',
      bucket: 'test-public-bucket',
      key: 'org123/avatar.png',
      organizationId: 'org123',
      reason: 'DB transaction failed',
    })

    expect(mockGetQueue).toHaveBeenCalledWith('maintenance')
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)

    const [name, data] = mockQueueAdd.mock.calls[0]!
    expect(name).toBe('orphanedStorageObjectJob')
    expect(data).toEqual(
      expect.objectContaining({
        provider: 'S3',
        bucket: 'test-public-bucket',
        key: 'org123/avatar.png',
        organizationId: 'org123',
        reason: 'DB transaction failed',
      })
    )
  })
})

describe('orphanedStorageObjectJob', () => {
  it('deletes the object from the bucket the payload names', async () => {
    const result = await orphanedStorageObjectJob(
      job({
        provider: 'S3',
        bucket: 'test-public-bucket',
        key: 'org123/avatar.png',
        organizationId: 'org123',
        reason: 'DB transaction failed',
      })
    )

    expect(mockDeleteByKey).toHaveBeenCalledWith({
      provider: 'S3',
      key: 'org123/avatar.png',
      bucket: 'test-public-bucket',
      credentialId: undefined,
    })
    expect(result).toEqual({ deleted: true })
  })

  it('rethrows so BullMQ retries when the delete fails', async () => {
    mockDeleteByKey.mockRejectedValueOnce(new Error('S3 down'))

    await expect(
      orphanedStorageObjectJob(
        job({
          provider: 'S3',
          bucket: 'test-public-bucket',
          key: 'org123/avatar.png',
          reason: 'DB transaction failed',
        })
      )
    ).rejects.toThrow('S3 down')
  })
})

describe('enqueueOrphanedStorageObjectCleanup (compensation call site)', () => {
  it('actually persists work instead of only logging', async () => {
    await enqueueOrphanedStorageObjectCleanup({
      provider: 'S3',
      key: 'org123/avatar.png',
      bucket: 'test-public-bucket',
      reason: 'DB transaction failed',
      organizationId: 'org123',
    })

    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    const [name, data] = mockQueueAdd.mock.calls[0]!
    expect(name).toBe('orphanedStorageObjectJob')
    expect(data).toEqual(
      expect.objectContaining({
        key: 'org123/avatar.png',
        bucket: 'test-public-bucket',
      })
    )
  })
})
