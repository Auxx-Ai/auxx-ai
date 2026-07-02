// packages/lib/src/record-rules/run-retention-job.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@auxx/database', () => ({ database: { execute: h.execute } }))

import { recordRuleRunRetentionJob } from './run-retention-job'

beforeEach(() => vi.clearAllMocks())

describe('recordRuleRunRetentionJob', () => {
  it('loops batched deletes until a pass returns fewer than the batch size', async () => {
    h.execute
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 123 })
    await recordRuleRunRetentionJob({ data: undefined } as never)
    expect(h.execute).toHaveBeenCalledTimes(3)
  })

  it('stops after a single pass when nothing (or little) to delete', async () => {
    h.execute.mockResolvedValueOnce({ rowCount: 0 })
    await recordRuleRunRetentionJob({ data: undefined } as never)
    expect(h.execute).toHaveBeenCalledTimes(1)
  })
})
