// packages/lib/src/jobs/maintenance/__tests__/backflush-job.test.ts
//
// The nightly shape walks yesterday in each org's book zone; a run step walks one slice and queues
// the next. One org's failure never loses the others.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  organizations: [] as string[],
  timeZones: {} as Record<string, string>,
  runs: [] as Array<{ organizationId: string; input: Record<string, unknown> }>,
  failing: new Set<string>(),
  active: new Set<string>(),
  enqueued: [] as Array<{ data: Record<string, unknown>; opts: Record<string, unknown> }>,
  slice: null as unknown,
  finalize: null as unknown,
  failed: [] as Array<[string, string]>,
  stale: [] as Array<Record<string, unknown>>,
  recoveries: [] as Array<[string, number]>,
}))

vi.mock('../../queues', () => ({
  getQueue: () => ({
    add: vi.fn(
      async (_name: string, data: Record<string, unknown>, opts: Record<string, unknown>) => {
        h.enqueued.push({ data, opts })
      }
    ),
  }),
}))
vi.mock('../../queues/types', () => ({ Queues: { maintenanceQueue: 'maintenanceQueue' } }))
vi.mock('../../../inventory/builds/backflush-run', () => ({
  runBackflushSlice: vi.fn(async () => h.slice),
  finalizeBackflushRun: vi.fn(async () => h.finalize),
  publishBackflushRunFailed: vi.fn(async () => {}),
  startBackflushRun: vi.fn(async () => ok({ runId: 'run_1', batchRun: 3 })),
}))
vi.mock('../../../inventory/builds/backflush-run-queries', () => ({
  findActiveBackflushRun: vi.fn(async (_db: unknown, organizationId: string) =>
    h.active.has(organizationId) ? { id: 'run_live' } : null
  ),
  listStaleBackflushRuns: vi.fn(async () => h.stale),
}))
vi.mock('../../../inventory/builds/backflush-run-mutations', () => ({
  failBackflushRun: vi.fn(async (_db: unknown, runId: string, error: string) => {
    h.failed.push([runId, error])
  }),
  recordBackflushRecovery: vi.fn(async (_db: unknown, runId: string, n: number) => {
    h.recoveries.push([runId, n])
  }),
}))

vi.mock('../../../settings/read', () => ({
  listOrganizationIdsBySetting: vi.fn(async (key: string, value: unknown) => {
    expect([key, value]).toEqual(['inventory.backflush', true])
    return h.organizations
  }),
}))
vi.mock('../../../accounting/ledger/setup/book-time-zone', () => ({
  readBookTimeZoneOrUtc: vi.fn(
    async (organizationId: string) => h.timeZones[organizationId] ?? 'UTC'
  ),
}))
vi.mock('../../../inventory/builds/backflush', () => ({
  backflushBuilds: vi.fn(
    async (_db: unknown, organizationId: string, input: Record<string, unknown>) => {
      h.runs.push({ organizationId, input })
      if (h.failing.has(organizationId)) return err(new Error('boom'))
      return ok({ batchRun: 1, written: [], failed: [], failedDays: [] })
    }
  ),
}))

import type { JobContext } from '../../types/job-context'
import {
  backflushJob,
  enqueueBackflushRun,
  recoverStaleBackflushRuns,
  yesterdayInZone,
} from '../backflush-job'

function ctx<T>(data: T, attemptsMade = 0): JobContext<T> {
  return {
    data,
    jobId: 'job_1',
    jobName: 'backflushJob',
    job: { attemptsMade, opts: { attempts: 3 } },
  } as unknown as JobContext<T>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.organizations = []
  h.timeZones = {}
  h.runs = []
  h.failing = new Set()
  h.active = new Set()
  h.enqueued = []
  h.slice = ok(null)
  h.finalize = ok(true)
  h.failed = []
  h.stale = []
  h.recoveries = []
  vi.useRealTimers()
})

describe('yesterdayInZone', () => {
  it('is the local day before now, so a UTC evening is still today west of Greenwich', () => {
    const now = new Date('2026-09-24T05:00:00.000Z')
    expect(yesterdayInZone(now, 'UTC')).toBe('2026-09-23')
    // Honolulu is at 19:00 on the 23rd, so yesterday there is the 22nd.
    expect(yesterdayInZone(now, 'Pacific/Honolulu')).toBe('2026-09-22')
    // Tokyo is at 14:00 on the 24th.
    expect(yesterdayInZone(now, 'Asia/Tokyo')).toBe('2026-09-23')
  })
})

describe('the nightly shape', () => {
  it("walks yesterday in each org's book zone, per org with the switch on", async () => {
    vi.useFakeTimers({ now: new Date('2026-09-24T05:00:00.000Z') })
    h.organizations = ['org_hnl', 'org_utc']
    h.timeZones = { org_hnl: 'Pacific/Honolulu' }

    await backflushJob(ctx(undefined))

    expect(h.runs.map((r) => r.organizationId)).toEqual(['org_hnl', 'org_utc'])
    // 2026-09-23 19:00 in Honolulu (UTC-10), so its yesterday is the 22nd.
    const hnl = h.runs[0]?.input
    expect(hnl?.from).toBe('2026-09-22')
    expect(hnl?.to).toBe('2026-09-22')
    expect(hnl?.actorUserId).toBeUndefined()
    expect(h.runs[1]?.input.from).toBe('2026-09-23')
  })

  it('keeps going past an org whose run fails', async () => {
    h.organizations = ['org_a', 'org_b']
    h.failing = new Set(['org_a'])
    await expect(backflushJob(ctx(undefined))).resolves.toBeUndefined()
    expect(h.runs.map((r) => r.organizationId)).toEqual(['org_a', 'org_b'])
  })

  it('skips an org whose sliced run is still going, so yesterday is not walked twice', async () => {
    h.organizations = ['org_a', 'org_b']
    h.active = new Set(['org_a'])
    await backflushJob(ctx(undefined))
    expect(h.runs.map((r) => r.organizationId)).toEqual(['org_b'])
  })
})

describe('a run step', () => {
  const step = { organizationId: 'org_1', runId: 'run_1', step: 'slice' as const, cursor: null }

  it('claims the run and queues its first slice', async () => {
    await expect(
      enqueueBackflushRun('org_1', { from: '2021-07-16', to: '2026-09-24' }, 'user_1')
    ).resolves.toEqual({ runId: 'run_1' })
    expect(h.enqueued).toEqual([
      {
        data: step,
        opts: expect.objectContaining({ jobId: 'backflush-org_1-run_1-start', attempts: 3 }),
      },
    ])
  })

  it('queues the next slice keyed on the new cursor, or the finalize', async () => {
    h.slice = ok({ kind: 'slice', cursor: '2021-08-14' })
    await backflushJob(ctx(step))
    h.slice = ok({ kind: 'finalize' })
    await backflushJob(ctx({ ...step, cursor: '2021-08-14' }))
    expect(h.enqueued.map((e) => [e.data, e.opts.jobId])).toEqual([
      [{ ...step, cursor: '2021-08-14' }, 'backflush-org_1-run_1-2021-08-14'],
      [
        { organizationId: 'org_1', runId: 'run_1', step: 'finalize' },
        'backflush-org_1-run_1-finalize',
      ],
    ])
    const { runBackflushSlice } = await import('../../../inventory/builds/backflush-run')
    expect(vi.mocked(runBackflushSlice).mock.calls[1]?.[3]).toEqual({
      expectedCursor: '2021-08-14',
    })
  })

  it('queues nothing when the slice reports the run done or owned elsewhere', async () => {
    h.slice = ok(null)
    await backflushJob(ctx(step))
    expect(h.enqueued).toEqual([])
  })

  it('throws for a retry, and fails the row on the last attempt', async () => {
    h.slice = err(new Error('deadlock'))
    await expect(backflushJob(ctx(step, 0))).rejects.toThrow('deadlock')
    expect(h.failed).toEqual([])
    await expect(backflushJob(ctx(step, 2))).resolves.toBeUndefined()
    expect(h.failed).toEqual([['run_1', 'deadlock']])
  })

  it('drops a job in the old one-shot shape rather than running the nightly pass', async () => {
    h.organizations = ['org_1']
    await backflushJob(ctx({ organizationId: 'org_1', from: '2026-01-01', to: '2026-01-02' }))
    expect(h.runs).toEqual([])
  })
})

describe('the stale sweep', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'run_1',
    organizationId: 'org_1',
    metadata: { to: '2026-09-24', cursor: '2025-01-01', recoveries: 0, ...over },
  })

  it('re-enqueues the next slice at the stored cursor, or the finalize at the end', async () => {
    h.stale = [row({}), { ...row({ cursor: '2026-09-24' }), id: 'run_2' }]
    await recoverStaleBackflushRuns()
    expect(h.recoveries).toEqual([
      ['run_1', 1],
      ['run_2', 1],
    ])
    expect(h.enqueued.map((e) => e.opts.jobId)).toEqual([
      'backflush-org_1-run_1-2025-01-01',
      'backflush-org_1-run_2-finalize',
    ])
  })

  it('fails a run that keeps stalling instead of re-enqueuing it forever', async () => {
    h.stale = [row({ recoveries: 5 })]
    await recoverStaleBackflushRuns()
    expect(h.failed).toEqual([['run_1', 'The run stopped making progress']])
    expect(h.enqueued).toEqual([])
  })
})
