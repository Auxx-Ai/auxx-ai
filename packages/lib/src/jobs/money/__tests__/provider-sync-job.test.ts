// packages/lib/src/jobs/money/__tests__/provider-sync-job.test.ts
//
// §4.6.4: the job is `runSyncSlice` and the directive it returns. What is worth
// pinning is the wiring, not the walk - the run blob's block is loaded and
// handed to the source, `reenqueue` carries the SAME payload forward, and a
// finished backfill closes the run the runner deliberately leaves open.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobContext } from '../../types'
import { type ProviderSyncJobData, providerSyncJob } from '../provider-sync-job'

const createSource = vi.hoisted(() => vi.fn())
const enqueueSlice = vi.hoisted(() => vi.fn())
const isMarkerBlockedForRun = vi.hoisted(() => vi.fn())
const blockMarkerForRun = vi.hoisted(() => vi.fn())
const finalize = vi.hoisted(() => vi.fn())
const fail = vi.hoisted(() => vi.fn())
const recordSlice = vi.hoisted(() => vi.fn())
const runSyncSlice = vi.hoisted(() => vi.fn())

vi.mock('@auxx/database', () => ({ database: {} }))

vi.mock('../../../accounting/mirror', () => ({
  createProviderLedgerSyncSource: createSource,
  createProviderSyncRunLedger: () => ({ recordSlice, finalize, fail }),
  createProviderSyncStateStore: () => ({ load: vi.fn(), save: vi.fn() }),
  enqueueProviderSyncSlice: enqueueSlice,
  isMarkerBlockedForRun,
  blockMarkerForRun,
}))

vi.mock('../../../sync-core/slice-runner', () => ({ runSyncSlice }))
vi.mock('../../../sync-core/throttle', () => ({ createThrottleHandle: () => ({ run: vi.fn() }) }))

const DATA: ProviderSyncJobData = {
  organizationId: 'org_1',
  from: '2026-06-01',
  to: '2026-09-16',
  trigger: 'pressed',
  runStartedAt: '2026-09-16T10:00:00.000Z',
}

function ctx(over: Partial<JobContext<ProviderSyncJobData>> = {}) {
  return { data: DATA, ...over } as JobContext<ProviderSyncJobData>
}

beforeEach(() => {
  vi.clearAllMocks()
  isMarkerBlockedForRun.mockResolvedValue(false)
  recordSlice.mockResolvedValue(undefined)
  finalize.mockResolvedValue(undefined)
  fail.mockResolvedValue(undefined)
  enqueueSlice.mockResolvedValue(true)
  createSource.mockResolvedValue({ throttleKey: 'company_9:general-ledger' })
})

describe('the source is built from the run blob', () => {
  it('🛑 passes the run’s stored marker block through, so a fresh source is not a cleared flag', async () => {
    isMarkerBlockedForRun.mockResolvedValue(true)
    runSyncSlice.mockResolvedValue({ action: 'complete', completedPhase: 'steady' })

    await providerSyncJob(ctx())

    expect(isMarkerBlockedForRun).toHaveBeenCalledWith('org_1', DATA.runStartedAt)
    expect(createSource).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      expect.objectContaining({ from: '2026-06-01', to: '2026-09-16', markerBlocked: true })
    )
    // And the flip is persisted against the same run.
    await createSource.mock.calls[0]?.[2].onMarkerBlocked()
    expect(blockMarkerForRun).toHaveBeenCalledWith('org_1', DATA.runStartedAt)
  })
})

describe('the directive', () => {
  it('re-enqueues the SAME payload, honouring the slice’s pacing', async () => {
    runSyncSlice.mockResolvedValue({
      action: 'reenqueue',
      reason: 'more-pages',
      retryAfterMs: 1_200,
    })

    await providerSyncJob(ctx())

    // The run identity rides along unchanged - a re-stamped run would close its
    // own run every slice.
    expect(enqueueSlice).toHaveBeenCalledWith(DATA, { delayMs: 1_200 })
  })

  it('stops instead of chaining when the worker is shutting down', async () => {
    runSyncSlice.mockResolvedValue({ action: 'reenqueue', reason: 'more-pages' })
    const controller = new AbortController()
    controller.abort()

    await providerSyncJob(ctx({ signal: controller.signal }))

    expect(enqueueSlice).not.toHaveBeenCalled()
  })

  it('🛑 closes a run that finished its backfill - the runner does not', async () => {
    runSyncSlice.mockResolvedValue({ action: 'complete', completedPhase: 'backfill' })

    await providerSyncJob(ctx())

    expect(finalize).toHaveBeenCalledTimes(1)
    expect(enqueueSlice).not.toHaveBeenCalled()
  })

  it('leaves a completed steady pass alone - the runner already finalized it', async () => {
    runSyncSlice.mockResolvedValue({ action: 'complete', completedPhase: 'steady' })

    await providerSyncJob(ctx())

    expect(finalize).not.toHaveBeenCalled()
  })

  it('does not chain a failed run; the ledger already recorded it', async () => {
    runSyncSlice.mockResolvedValue({ action: 'failed', error: new Error('stalled') })

    await providerSyncJob(ctx())

    expect(enqueueSlice).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
  })
})

describe('a refusal before the first slice', () => {
  it('opens and fails the run, so the press leaves a trace the panel can read', async () => {
    createSource.mockRejectedValue(new Error('No accounting system is connected'))

    await expect(providerSyncJob(ctx())).resolves.toBeUndefined()

    expect(recordSlice).toHaveBeenCalledWith(expect.objectContaining({ counters: { failed: 1 } }))
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('connected') })
    )
  })
})
