// packages/lib/src/jobs/money/__tests__/provider-sync-scheduled-job.test.ts
//
// §5.4. What a cadence's fire resolves before it goes through the same door the
// button uses: TODAY in the book timezone, and the OPEN periods rather than a
// trailing window - a December adjusting entry made in February is the case that
// motivated the feature. And §4.6: a `ConflictError` is the NORMAL outcome of a
// fire that lands on a running walk, so it must not fail the job.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../errors'

const enqueueProviderSync = vi.hoisted(() => vi.fn())
const state = vi.hoisted(() => ({
  lockedThroughMonth: null as string | null,
  settings: new Map<string, string | null>(),
}))

vi.mock('../../../accounting/mirror', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../accounting/mirror')>()),
  enqueueProviderSync,
}))

vi.mock('../../../accounting/ledger/periods/period-lock', () => ({
  resolvePeriodLock: vi.fn(async () => ({ lockedThroughMonth: state.lockedThroughMonth })),
}))

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: vi.fn(
    async ({ key }: { key: string }) => state.settings.get(key) ?? null
  ),
}))

import { providerSyncScheduledJob } from '../provider-sync-scheduled-job'

const ORG = 'org_1'

/** The job context a BullMQ scheduler fires with: the org id and nothing else. */
const ctx = { data: { organizationId: ORG } } as never

function fired() {
  return enqueueProviderSync.mock.calls[0]?.[0] as
    | { organizationId: string; from?: string; to: string; trigger: string }
    | undefined
}

beforeEach(() => {
  vi.useRealTimers()
  enqueueProviderSync.mockReset()
  enqueueProviderSync.mockResolvedValue(true)
  state.lockedThroughMonth = null
  state.settings = new Map([
    ['accounting.cutoffPeriod', '2026-03'],
    ['accounting.bookTimeZone', 'America/New_York'],
  ])
})

describe('providerSyncScheduledJob', () => {
  it('asks for today in the BOOK timezone, not the server’s', async () => {
    // 03:30 UTC on the 17th is 23:30 on the 16th in New York (EDT, UTC-4), and
    // a fire then must ask for the 16th - the day the books are still on.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T03:30:00Z'))
    await providerSyncScheduledJob(ctx)
    expect(fired()?.to).toBe('2026-09-16')
  })

  it('walks from the floor when nothing has been closed yet', async () => {
    state.lockedThroughMonth = null
    await providerSyncScheduledJob(ctx)
    // `undefined` is "everything the sync is allowed to see", which
    // `planSyncChunks` resolves to the cutover floor itself.
    expect(fired()?.from).toBeUndefined()
    expect(fired()?.trigger).toBe('scheduled')
  })

  it('walks from the month after the period lock, not a trailing window', async () => {
    state.lockedThroughMonth = '2026-04'
    await providerSyncScheduledJob(ctx)
    // May onward, so a December entry made in February is still in range once
    // the close discipline has not reached December.
    expect(fired()?.from).toBe('2026-05-01')
  })

  it('crosses a year end from a December lock', async () => {
    state.lockedThroughMonth = '2026-12'
    await providerSyncScheduledJob(ctx)
    expect(fired()?.from).toBe('2027-01-01')
  })

  it('falls back to the floor when the lock is at or before the cutoff', async () => {
    // A lock inside the opening period is not a request to re-read it; asking
    // for that date would be refused by the cutover floor.
    state.lockedThroughMonth = '2026-01'
    await providerSyncScheduledJob(ctx)
    expect(fired()?.from).toBeUndefined()
  })

  it('does not throw when a run is already open, and does not enqueue twice', async () => {
    enqueueProviderSync.mockRejectedValueOnce(
      new ConflictError('A provider sync is already running')
    )
    await expect(providerSyncScheduledJob(ctx)).resolves.toBeUndefined()
    expect(enqueueProviderSync).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the enqueue fails outright', async () => {
    enqueueProviderSync.mockRejectedValueOnce(new Error('redis is down'))
    await expect(providerSyncScheduledJob(ctx)).resolves.toBeUndefined()
  })

  it('skips an org that has no accounting cutoff', async () => {
    state.settings = new Map()
    await providerSyncScheduledJob(ctx)
    expect(enqueueProviderSync).not.toHaveBeenCalled()
  })
})
