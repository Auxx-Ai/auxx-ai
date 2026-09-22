// packages/lib/src/jobs/money/__tests__/export-batch-job.test.ts
//
// The job is a pass-through to `sendExportBatch`; what it must not lose is the
// run id and a Retry's `manual` flag (93 B2, C2).

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobContext } from '../../types'
import { type ExportBatchJobData, exportBatchJob } from '../export-batch-job'

const sendExportBatch = vi.hoisted(() => vi.fn())

vi.mock('@auxx/database', () => ({ database: { marker: 'db' } }))
vi.mock('../../../accounting/export', () => ({ sendExportBatch }))

const ctx = (data: ExportBatchJobData) => ({ data }) as JobContext<ExportBatchJobData>

beforeEach(() => {
  vi.clearAllMocks()
  sendExportBatch.mockResolvedValue(ok({ status: 'sent', attempts: 1 }))
})

describe('exportBatchJob', () => {
  it('threads a Retry through as a manual send', async () => {
    await exportBatchJob(ctx({ organizationId: 'org_1', batchId: 'b1', runId: 'r1', manual: true }))

    expect(sendExportBatch).toHaveBeenCalledWith(
      { marker: 'db' },
      { organizationId: 'org_1', batchId: 'b1', runId: 'r1', manual: true }
    )
  })

  it('leaves a Release non-manual', async () => {
    await exportBatchJob(ctx({ organizationId: 'org_1', batchId: 'b1', runId: 'r1' }))

    expect(sendExportBatch).toHaveBeenCalledWith(
      { marker: 'db' },
      { organizationId: 'org_1', batchId: 'b1', runId: 'r1' }
    )
  })
})
