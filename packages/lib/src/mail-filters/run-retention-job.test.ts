// packages/lib/src/mail-filters/run-retention-job.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@auxx/database', () => ({ database: { execute: h.execute } }))

import { MAIL_FILTER_RUN_RETENTION_JOB_NAME, mailFilterRunRetentionJob } from './run-retention-job'

beforeEach(() => vi.clearAllMocks())

describe('mailFilterRunRetentionJob', () => {
  it('loops batched deletes until a pass returns fewer than the batch size', async () => {
    h.execute
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 123 })
    await mailFilterRunRetentionJob({ data: undefined } as never)
    expect(h.execute).toHaveBeenCalledTimes(3)
  })

  it('stops after a single pass when nothing (or little) to delete', async () => {
    h.execute.mockResolvedValueOnce({ rowCount: 0 })
    await mailFilterRunRetentionJob({ data: undefined } as never)
    expect(h.execute).toHaveBeenCalledTimes(1)
  })

  it('exports the scheduler job name the worker registers', () => {
    // The BullMQ scheduler id, the `jobMappings` key and this constant must all
    // be the same string or the nightly tick fails with "Job function not found".
    expect(MAIL_FILTER_RUN_RETENTION_JOB_NAME).toBe('mailFilterRunRetentionJob')
    expect(mailFilterRunRetentionJob.name).toBe(MAIL_FILTER_RUN_RETENTION_JOB_NAME)
  })
})
