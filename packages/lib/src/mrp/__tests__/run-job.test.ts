// packages/lib/src/mrp/__tests__/run-job.test.ts

import { database } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobContext } from '../../jobs/types/job-context'

const lock = { acquire: vi.fn(), isHeld: vi.fn(), release: vi.fn() }
vi.mock('@auxx/redis', () => ({ createCredentialLockProvider: () => lock }))
vi.mock('../guard', () => ({ isMrpEnabled: vi.fn() }))
vi.mock('../run/run', () => ({ runMrpPlan: vi.fn() }))
vi.mock('../run/write-run', () => ({ pruneRuns: vi.fn(), failStaleRuns: vi.fn() }))
vi.mock('../../settings/read', () => ({
  readOrganizationSettings: vi.fn(async () => ({ 'mrp.runRetentionDays': 30 })),
}))
vi.mock('../../inventory/movements/fact/reads', () => ({ readFactTotalsByPart: vi.fn() }))
vi.mock('../../inventory/movements/fact/drift-check', () => ({ compareFactsToLedger: vi.fn() }))
vi.mock('../../inventory/movements/fact/rebuild', () => ({ rebuildMovementFacts: vi.fn() }))
const queue = { add: vi.fn(), getJob: vi.fn() }
vi.mock('../../jobs/queues', () => ({
  getQueue: () => queue,
  Queues: { maintenanceQueue: 'maintenance' },
}))

const { isMrpEnabled } = await import('../guard')
const { runMrpPlan } = await import('../run/run')
const { failStaleRuns, pruneRuns } = await import('../run/write-run')
const { readFactTotalsByPart } = await import('../../inventory/movements/fact/reads')
const { compareFactsToLedger } = await import('../../inventory/movements/fact/drift-check')
const { rebuildMovementFacts } = await import('../../inventory/movements/fact/rebuild')
const { enqueueMrpRun, isMrpRunActive, mrpNightlyJob, runMrpForOrganization } = await import(
  '../run/run-job'
)

const db = database as never

beforeEach(() => {
  vi.clearAllMocks()
  lock.acquire.mockResolvedValue(true)
  lock.isHeld.mockResolvedValue(false)
  lock.release.mockResolvedValue(undefined)
  vi.mocked(isMrpEnabled).mockResolvedValue(true)
  vi.mocked(runMrpPlan).mockResolvedValue(ok({ runId: 'r', itemCount: 1, durationMs: 1 }))
  vi.mocked(pruneRuns).mockResolvedValue(ok({ deleted: 0 }))
  vi.mocked(failStaleRuns).mockResolvedValue(ok({ failed: 0 }))
  vi.mocked(readFactTotalsByPart).mockResolvedValue(new Map([['p', { count: 1, sum: 1 }]]))
})

describe('runMrpForOrganization', () => {
  it('skips while another run holds the org lock', async () => {
    lock.acquire.mockResolvedValue(false)
    expect(await runMrpForOrganization(db, 'org-1', 'manual')).toBe('skipped_locked')
    expect(runMrpPlan).not.toHaveBeenCalled()
    expect(lock.release).not.toHaveBeenCalled()
  })

  it('skips an org whose plan lacks MRP', async () => {
    vi.mocked(isMrpEnabled).mockResolvedValue(false)
    expect(await runMrpForOrganization(db, 'org-1', 'nightly')).toBe('skipped_disabled')
    expect(lock.acquire).not.toHaveBeenCalled()
    expect(runMrpPlan).not.toHaveBeenCalled()
  })

  it('runs, prunes with the retention setting, and releases the lock', async () => {
    expect(await runMrpForOrganization(db, 'org-1', 'nightly')).toBe('completed')
    expect(runMrpPlan).toHaveBeenCalledWith(db, 'org-1', { trigger: 'nightly' })
    expect(pruneRuns).toHaveBeenCalledWith(db, 'org-1', 30)
    expect(rebuildMovementFacts).not.toHaveBeenCalled()
    expect(lock.release).toHaveBeenCalledOnce()
  })

  it('fails orphaned runs older than six hours before planning', async () => {
    await runMrpForOrganization(db, 'org-1', 'nightly')
    expect(failStaleRuns).toHaveBeenCalledWith(db, 'org-1', 6 * 60 * 60 * 1000)
    expect(vi.mocked(failStaleRuns).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runMrpPlan).mock.invocationCallOrder[0] ?? 0
    )
  })

  it('rebuilds an empty mirror once when the ledger has movements', async () => {
    vi.mocked(readFactTotalsByPart).mockResolvedValue(new Map())
    vi.mocked(compareFactsToLedger).mockResolvedValue(
      ok([{ partId: 'p', ledgerCount: 3, factCount: 0, ledgerSum: 5, factSum: 0 }])
    )
    vi.mocked(rebuildMovementFacts).mockResolvedValue(ok({ inserted: 3 }))
    await runMrpForOrganization(db, 'org-1', 'nightly')
    expect(rebuildMovementFacts).toHaveBeenCalledWith(db, 'org-1')
    expect(runMrpPlan).toHaveBeenCalledOnce()
  })

  it('runs unlocked when Redis is down', async () => {
    lock.acquire.mockRejectedValue(new Error('Redis unavailable'))
    expect(await runMrpForOrganization(db, 'org-1', 'manual')).toBe('completed')
    expect(lock.release).not.toHaveBeenCalled()
  })
})

describe('mrpNightlyJob', () => {
  it('plans only the orgs with the feature, each in its own try', async () => {
    vi.mocked(database.select).mockReturnValueOnce({
      from: () => ({ where: async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
    } as never)
    vi.mocked(isMrpEnabled).mockImplementation(async (orgId) => orgId !== 'b')
    vi.mocked(runMrpPlan).mockImplementation(async (_db, orgId) => {
      if (orgId === 'a') throw new Error('boom')
      return ok({ runId: 'r', itemCount: 1, durationMs: 1 })
    })
    await mrpNightlyJob({ jobId: 'j' } as JobContext)
    expect(
      vi
        .mocked(runMrpPlan)
        .mock.calls.map((c) => c[1])
        .sort()
    ).toEqual(['a', 'c'])
    expect(lock.release).toHaveBeenCalledTimes(2)
  })
})

describe('enqueueMrpRun / isMrpRunActive', () => {
  it('adds one deduplicated job per org', async () => {
    queue.getJob.mockResolvedValue(undefined)
    expect(await enqueueMrpRun('org-1', { trigger: 'manual' })).toEqual({ queued: true })
    expect(queue.add).toHaveBeenCalledWith(
      'mrpRunOrgJob',
      { organizationId: 'org-1', trigger: 'manual' },
      expect.objectContaining({ jobId: 'mrp-run-org-1', attempts: 2, removeOnComplete: true })
    )
  })

  it('is a no-op while a run is queued, and reports the nightly lock as active', async () => {
    queue.getJob.mockResolvedValue({ getState: async () => 'waiting' })
    expect(await enqueueMrpRun('org-1', { trigger: 'manual' })).toEqual({ queued: false })
    expect(queue.add).not.toHaveBeenCalled()

    queue.getJob.mockResolvedValue(undefined)
    lock.isHeld.mockResolvedValue(true)
    expect(await isMrpRunActive('org-1')).toBe(true)
  })
})
