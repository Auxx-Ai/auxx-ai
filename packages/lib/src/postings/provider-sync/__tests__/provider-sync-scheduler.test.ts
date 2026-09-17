// packages/lib/src/postings/provider-sync/__tests__/provider-sync-scheduler.test.ts
//
// §5.1. The scheduled door is one `upsertJobScheduler` per org, active only when
// a cadence is configured AND an accounting provider is connected AND the org is
// not a demo. 🛑 The interesting half is the INACTIVE one: no cadence has to
// REMOVE, not skip, or a cadence switched off while the worker was down survives
// in Redis for ever. BullMQ's queue and the three reads are faked.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderSyncScheduleConfig } from '../client'

const upsertJobScheduler = vi.hoisted(() => vi.fn())
const removeJobScheduler = vi.hoisted(() => vi.fn())
const io = vi.hoisted(() => ({
  schedule: null as ProviderSyncScheduleConfig | null,
  schedulable: true,
  orgs: [] as string[],
  scheduleBy: new Map<string, ProviderSyncScheduleConfig | null>(),
}))

vi.mock('../../../jobs/queues', () => ({
  Queues: { providerSyncQueue: 'provider-sync' },
  getQueue: () => ({ upsertJobScheduler, removeJobScheduler }),
}))

vi.mock('../scheduler-io', () => ({
  readProviderSyncSchedule: vi.fn(async (orgId: string) =>
    io.scheduleBy.has(orgId) ? io.scheduleBy.get(orgId)! : io.schedule
  ),
  isSchedulableOrg: vi.fn(async () => io.schedulable),
  listOrgsWithAccountingProvider: vi.fn(async () => io.orgs),
}))

import {
  reconcileProviderSyncSchedulers,
  removeProviderSyncScheduler,
  syncProviderSyncScheduler,
} from '../scheduler'

const ORG = 'org_1'
const TWICE_DAILY: ProviderSyncScheduleConfig = {
  triggerInterval: 'hours',
  timeBetweenTriggers: { hours: 12 },
  timezone: 'America/New_York',
}

beforeEach(() => {
  upsertJobScheduler.mockReset()
  removeJobScheduler.mockReset()
  io.schedule = null
  io.schedulable = true
  io.orgs = []
  io.scheduleBy = new Map()
})

describe('syncProviderSyncScheduler', () => {
  it('removes the scheduler when the org has no cadence configured', async () => {
    await syncProviderSyncScheduler(ORG)
    expect(upsertJobScheduler).not.toHaveBeenCalled()
    expect(removeJobScheduler).toHaveBeenCalledWith('provider-sync-org_1')
  })

  it('upserts the twice-daily pattern in the configured timezone', async () => {
    io.schedule = TWICE_DAILY
    await syncProviderSyncScheduler(ORG)

    expect(upsertJobScheduler).toHaveBeenCalledTimes(1)
    const [id, repeat, job] = upsertJobScheduler.mock.calls[0] as [
      string,
      { pattern: string; tz?: string },
      { name: string; data: Record<string, unknown> },
    ]
    expect(id).toBe('provider-sync-org_1')
    expect(repeat).toEqual({ pattern: '0 0 */12 * * *', tz: 'America/New_York' })
    expect(job.name).toBe('provider-sync-scheduled')
    // 🛑 The range is resolved at FIRE time, never here: `to` is today in the
    // book timezone, which is wrong by the second fire.
    expect(job.data).toEqual({ organizationId: ORG })
  })

  it("removes the scheduler for {triggerInterval:'off'}", async () => {
    io.schedule = { triggerInterval: 'off', timeBetweenTriggers: {} }
    await syncProviderSyncScheduler(ORG)
    expect(upsertJobScheduler).not.toHaveBeenCalled()
    expect(removeJobScheduler).toHaveBeenCalledWith('provider-sync-org_1')
  })

  it('removes the scheduler when nothing is connected, even on a valid cadence', async () => {
    // A VALID cadence on purpose: with an invalid one the scheduler would be
    // removed anyway and the gate would do no work.
    io.schedule = TWICE_DAILY
    io.schedulable = false
    await syncProviderSyncScheduler(ORG)
    expect(upsertJobScheduler).not.toHaveBeenCalled()
    expect(removeJobScheduler).toHaveBeenCalledWith('provider-sync-org_1')
  })

  it('throws on a cadence that has no cron pattern, so the settings write is refused', async () => {
    io.schedule = { triggerInterval: 'custom', timeBetweenTriggers: {} }
    await expect(syncProviderSyncScheduler(ORG)).rejects.toThrow(/Custom cron expression/)
    expect(upsertJobScheduler).not.toHaveBeenCalled()
  })

  it('is idempotent — the same cadence twice is the same upsert twice', async () => {
    io.schedule = TWICE_DAILY
    await syncProviderSyncScheduler(ORG)
    await syncProviderSyncScheduler(ORG)
    expect(upsertJobScheduler).toHaveBeenCalledTimes(2)
    expect(upsertJobScheduler.mock.calls[0]).toEqual(upsertJobScheduler.mock.calls[1])
  })
})

describe('reconcileProviderSyncSchedulers', () => {
  it('registers every enumerated org and survives one whose cadence is unusable', async () => {
    io.orgs = ['org_a', 'org_bad', 'org_c']
    io.scheduleBy = new Map([
      ['org_a', TWICE_DAILY],
      // 240 minutes is not a minutes cadence — `intervalToCron` refuses ≥ 60.
      ['org_bad', { triggerInterval: 'minutes', timeBetweenTriggers: { minutes: 240 } }],
      ['org_c', TWICE_DAILY],
    ])

    await expect(reconcileProviderSyncSchedulers({} as never)).resolves.toBeUndefined()

    const ids = upsertJobScheduler.mock.calls.map((call) => call[0])
    expect(ids).toEqual(['provider-sync-org_a', 'provider-sync-org_c'])
  })

  it('is idempotent across two boots', async () => {
    io.orgs = [ORG]
    io.schedule = TWICE_DAILY
    await reconcileProviderSyncSchedulers({} as never)
    await reconcileProviderSyncSchedulers({} as never)
    expect(upsertJobScheduler).toHaveBeenCalledTimes(2)
    expect(upsertJobScheduler.mock.calls[0]).toEqual(upsertJobScheduler.mock.calls[1])
  })

  it('registers nothing when no org has a provider connected', async () => {
    io.orgs = []
    await reconcileProviderSyncSchedulers({} as never)
    expect(upsertJobScheduler).not.toHaveBeenCalled()
    expect(removeJobScheduler).not.toHaveBeenCalled()
  })
})

describe('removeProviderSyncScheduler', () => {
  it('swallows a queue that has none registered', async () => {
    removeJobScheduler.mockRejectedValueOnce(new Error('no such scheduler'))
    await expect(removeProviderSyncScheduler(ORG)).resolves.toBeUndefined()
  })
})
