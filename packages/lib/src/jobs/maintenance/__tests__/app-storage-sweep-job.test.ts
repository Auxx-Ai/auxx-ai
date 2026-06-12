// packages/lib/src/jobs/maintenance/__tests__/app-storage-sweep-job.test.ts

import type { Job } from 'bullmq'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleteExpired = vi.fn()
const countExpired = vi.fn()

vi.mock('../../../apps/app-storage', () => ({
  deleteExpiredAppStorage: (batchSize: number) => deleteExpired(batchSize),
  countExpiredAppStorage: () => countExpired(),
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}))

import { appStorageSweepJob } from '../app-storage-sweep-job'

function job(data: Record<string, unknown>): Job {
  return { data } as Job
}

beforeEach(() => {
  deleteExpired.mockReset()
  countExpired.mockReset()
})

describe('appStorageSweepJob', () => {
  it('drains in batches and stops when a batch comes back short', async () => {
    deleteExpired
      .mockResolvedValueOnce(ok(1000)) // full → keep going
      .mockResolvedValueOnce(ok(1000)) // full → keep going
      .mockResolvedValueOnce(ok(300)) // short → drained

    const stats = await appStorageSweepJob(job({ batchSize: 1000 }))

    expect(stats).toEqual({ deleted: 2300, batches: 3 })
    expect(deleteExpired).toHaveBeenCalledTimes(3)
    expect(deleteExpired).toHaveBeenCalledWith(1000)
  })

  it('stops at zero on the first empty batch', async () => {
    deleteExpired.mockResolvedValueOnce(ok(0))
    const stats = await appStorageSweepJob(job({ batchSize: 1000 }))
    expect(stats).toEqual({ deleted: 0, batches: 1 })
    expect(deleteExpired).toHaveBeenCalledTimes(1)
  })

  it('respects the 50-batch iteration cap when never draining', async () => {
    deleteExpired.mockResolvedValue(ok(1000))
    const stats = await appStorageSweepJob(job({ batchSize: 1000 }))
    expect(stats).toEqual({ deleted: 50_000, batches: 50 })
    expect(deleteExpired).toHaveBeenCalledTimes(50)
  })

  it('dryRun counts without deleting', async () => {
    countExpired.mockResolvedValueOnce(ok(7))
    const stats = await appStorageSweepJob(job({ dryRun: true }))
    expect(stats).toEqual({ deleted: 7, batches: 0 })
    expect(deleteExpired).not.toHaveBeenCalled()
    expect(countExpired).toHaveBeenCalledOnce()
  })

  it('defaults batchSize to 1000', async () => {
    deleteExpired.mockResolvedValueOnce(ok(5))
    await appStorageSweepJob(job({}))
    expect(deleteExpired).toHaveBeenCalledWith(1000)
  })
})
