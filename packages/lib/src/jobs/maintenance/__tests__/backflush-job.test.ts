// packages/lib/src/jobs/maintenance/__tests__/backflush-job.test.ts
//
// The nightly shape walks yesterday in each org's book zone; the on-demand shape walks one org's
// range. One org's failure never loses the others.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  organizations: [] as string[],
  timeZones: {} as Record<string, string>,
  runs: [] as Array<{ organizationId: string; input: Record<string, unknown> }>,
  failing: new Set<string>(),
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
      return ok({ batchRun: 1, written: [], leftInProgress: [], failed: [], failedDays: [] })
    }
  ),
}))

import type { JobContext } from '../../types/job-context'
import { backflushJob, yesterdayInZone } from '../backflush-job'

function ctx<T>(data: T): JobContext<T> {
  return { data, jobId: 'job_1', jobName: 'backflushJob' } as unknown as JobContext<T>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.organizations = []
  h.timeZones = {}
  h.runs = []
  h.failing = new Set()
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
})

describe('the on-demand shape', () => {
  it('walks the named range for one org, attributed to the actor', async () => {
    await backflushJob(
      ctx({
        organizationId: 'org_1',
        from: '2026-01-01',
        to: '2026-03-31',
        actorUserId: 'user_1',
      })
    )
    expect(h.runs).toEqual([
      {
        organizationId: 'org_1',
        input: {
          from: '2026-01-01',
          to: '2026-03-31',
          actorUserId: 'user_1',
        },
      },
    ])
  })

  it('surfaces a refused run so the job records the failure', async () => {
    h.failing = new Set(['org_1'])
    await expect(
      backflushJob(ctx({ organizationId: 'org_1', from: '2026-01-01', to: '2026-01-02' }))
    ).rejects.toThrow('boom')
  })
})
