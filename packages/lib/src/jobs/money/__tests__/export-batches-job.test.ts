// packages/lib/src/jobs/money/__tests__/export-batches-job.test.ts
//
// The plural job is a pass-through to `sendExportBatches`; what it must not lose is
// the set, the run id and a Retry's `manual` flag (93 D4), and it never throws.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobContext } from '../../types'
import {
  EXPORT_BATCHES_JOB_NAME,
  type ExportBatchesJobData,
  exportBatchesJob,
} from '../export-batches-job'

const sendExportBatches = vi.hoisted(() => vi.fn())

vi.mock('@auxx/database', () => ({ database: { marker: 'db' } }))
vi.mock('../../../accounting/export', () => ({ sendExportBatches }))

const ctx = (data: ExportBatchesJobData) => ({ data }) as JobContext<ExportBatchesJobData>

beforeEach(() => {
  vi.clearAllMocks()
  sendExportBatches.mockResolvedValue(ok({ results: [], notLeased: [] }))
})

describe('exportBatchesJob', () => {
  it('is registered under the plural name', () => {
    expect(EXPORT_BATCHES_JOB_NAME).toBe('export-batches')
  })

  it('threads the set, the run id and a Retry through', async () => {
    await exportBatchesJob(
      ctx({ organizationId: 'org_1', batchIds: ['b1', 'b2'], runId: 'r1', manual: true })
    )

    expect(sendExportBatches).toHaveBeenCalledWith(
      { marker: 'db' },
      { organizationId: 'org_1', batchIds: ['b1', 'b2'], runId: 'r1', manual: true }
    )
  })

  it('leaves a Release non-manual', async () => {
    await exportBatchesJob(ctx({ organizationId: 'org_1', batchIds: ['b1'], runId: 'r1' }))

    expect(sendExportBatches).toHaveBeenCalledWith(
      { marker: 'db' },
      { organizationId: 'org_1', batchIds: ['b1'], runId: 'r1' }
    )
  })

  it('swallows a refusal and a throw, so BullMQ never retries on top of the sweep', async () => {
    sendExportBatches.mockResolvedValueOnce(err(new Error('db down')))
    await expect(
      exportBatchesJob(ctx({ organizationId: 'org_1', batchIds: ['b1'] }))
    ).resolves.toBeUndefined()

    sendExportBatches.mockRejectedValueOnce(new Error('boom'))
    await expect(
      exportBatchesJob(ctx({ organizationId: 'org_1', batchIds: ['b1'] }))
    ).resolves.toBeUndefined()
  })
})
