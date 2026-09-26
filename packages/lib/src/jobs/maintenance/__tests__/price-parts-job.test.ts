// packages/lib/src/jobs/maintenance/__tests__/price-parts-job.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  pricePendingMovements: vi.fn(),
  requestAccountingRecovery: vi.fn(async (_organizationId: string) => {}),
  publishAccountingWork: vi.fn(async (..._args: unknown[]) => {}),
}))

vi.mock('@auxx/database', () => ({ database: { tag: 'db' } }))
vi.mock('../../../inventory/costing/price-pending-movements', () => ({
  pricePendingMovements: h.pricePendingMovements,
}))
vi.mock('../../../accounting/work-items/realtime', () => ({
  publishAccountingWork: h.publishAccountingWork,
}))
vi.mock('../../../accounting/work-items/recovery', () => ({
  requestAccountingRecovery: h.requestAccountingRecovery,
}))

import type { JobContext } from '../../types/job-context'
import { pricePartsJob } from '../price-parts-job'

function ctx<T>(data: T): JobContext<T> {
  return { data, jobId: 'job_1', jobName: 'pricePartsJob' } as unknown as JobContext<T>
}

const SUMMARY = {
  pricedMovementIds: ['mv_1', 'mv_2'],
  unpricedPartIds: [],
  documentsPosted: 2,
  documentsFailed: 0,
  finishedBuildIds: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.pricePendingMovements.mockResolvedValue(ok(SUMMARY))
})

describe('pricePartsJob', () => {
  it('prices the named parts, then requests a recovery run as the mop-up', async () => {
    await pricePartsJob(ctx({ organizationId: 'org_1', partIds: ['p1', 'p2'] }))

    expect(h.pricePendingMovements).toHaveBeenCalledWith({ tag: 'db' }, 'org_1', ['p1', 'p2'])
    expect(h.requestAccountingRecovery).toHaveBeenCalledWith('org_1')
    expect(h.requestAccountingRecovery.mock.invocationCallOrder[0]!).toBeGreaterThan(
      h.pricePendingMovements.mock.invocationCallOrder[0]!
    )
    // The Blocked tab's refetch frame.
    expect(h.publishAccountingWork).toHaveBeenCalledWith('org_1', {
      stage: 'price',
      sourceKind: 'stock_movement',
      scanned: 2,
      accepted: 2,
    })
  })

  it('does not throw when the pricer fails; the recovery sweep retries the woken rows', async () => {
    h.pricePendingMovements.mockResolvedValue(err(new Error('deadlock')))

    await expect(
      pricePartsJob(ctx({ organizationId: 'org_1', partIds: ['p1'] }))
    ).resolves.toBeUndefined()
    expect(h.requestAccountingRecovery).toHaveBeenCalledWith('org_1')
    expect(h.publishAccountingWork).not.toHaveBeenCalled()
  })

  it('drops a job with no org or no parts', async () => {
    await pricePartsJob(ctx(undefined))
    await pricePartsJob(ctx({ organizationId: 'org_1', partIds: [] }))

    expect(h.pricePendingMovements).not.toHaveBeenCalled()
    expect(h.requestAccountingRecovery).not.toHaveBeenCalled()
  })
})
