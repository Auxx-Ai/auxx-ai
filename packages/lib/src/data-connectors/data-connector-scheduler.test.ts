// packages/lib/src/data-connectors/data-connector-scheduler.test.ts
// v9 §5 — scheduleConfig is mode-scoped: SYNC cadence for 'scheduled', SWEEP cadence
// for 'webhook' (null = default nightly SWEEP_CRON, {triggerInterval:'off'} = no
// self-heal at all). Also the fix for a real pre-existing bug: `syncConnectorScheduler`
// used to early-return via `removeConnectorScheduler` (which tears down BOTH
// schedulers) for any non-'scheduled' connector, so a webhook connector's sweep
// scheduler was NEVER reached/registered. BullMQ's queue is faked.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataConnectorRow } from './service'

const upsertJobScheduler = vi.fn()
const removeJobScheduler = vi.fn()
vi.mock('../jobs/queues', () => ({
  getQueue: () => ({
    upsertJobScheduler: (...a: unknown[]) => upsertJobScheduler(...a),
    removeJobScheduler: (...a: unknown[]) => removeJobScheduler(...a),
  }),
  Queues: { dataConnectorQueue: 'data-connector' },
}))

import { syncConnectorScheduler, syncConnectorSweepScheduler } from './data-connector-scheduler'

function connector(over: Partial<DataConnectorRow> = {}): DataConnectorRow {
  return {
    id: 'dc1',
    organizationId: 'org1',
    syncBehavior: 'manual',
    status: 'live',
    scheduleConfig: null,
    ...over,
  } as DataConnectorRow
}

beforeEach(() => {
  upsertJobScheduler.mockReset()
  removeJobScheduler.mockReset()
})

describe('syncConnectorSweepScheduler', () => {
  it('registers the default nightly cron when scheduleConfig is null (webhook mode)', async () => {
    await syncConnectorSweepScheduler(connector({ syncBehavior: 'webhook', scheduleConfig: null }))
    expect(upsertJobScheduler).toHaveBeenCalledTimes(1)
    const [id, repeat] = upsertJobScheduler.mock.calls[0] as [string, { pattern: string }]
    expect(id).toBe('data-connector-sweep-dc1')
    expect(repeat.pattern).toBe('0 3 * * *')
  })

  it('registers a custom cron when scheduleConfig carries one', async () => {
    await syncConnectorSweepScheduler(
      connector({
        syncBehavior: 'webhook',
        scheduleConfig: {
          triggerInterval: 'custom',
          customCron: '0 5 * * 0',
          timeBetweenTriggers: {},
        },
      })
    )
    const [, repeat] = upsertJobScheduler.mock.calls[0] as [string, { pattern: string }]
    expect(repeat.pattern).toBe('0 5 * * 0')
  })

  it("removes the sweep scheduler when scheduleConfig is {triggerInterval:'off'}", async () => {
    await syncConnectorSweepScheduler(
      connector({
        syncBehavior: 'webhook',
        scheduleConfig: { triggerInterval: 'off', timeBetweenTriggers: {} },
      })
    )
    expect(upsertJobScheduler).not.toHaveBeenCalled()
    expect(removeJobScheduler).toHaveBeenCalledWith('data-connector-sweep-dc1')
  })

  it('removes the sweep scheduler for a non-webhook connector regardless of scheduleConfig', async () => {
    await syncConnectorSweepScheduler(
      connector({
        syncBehavior: 'scheduled',
        scheduleConfig: { triggerInterval: 'days', timeBetweenTriggers: { days: 1 } },
      })
    )
    expect(upsertJobScheduler).not.toHaveBeenCalled()
    expect(removeJobScheduler).toHaveBeenCalledWith('data-connector-sweep-dc1')
  })

  it('removes the sweep scheduler when the webhook connector is paused', async () => {
    await syncConnectorSweepScheduler(
      connector({ syncBehavior: 'webhook', status: 'paused', scheduleConfig: null })
    )
    expect(upsertJobScheduler).not.toHaveBeenCalled()
    expect(removeJobScheduler).toHaveBeenCalledWith('data-connector-sweep-dc1')
  })
})

describe('syncConnectorScheduler — regression: webhook connectors must reach the sweep scheduler', () => {
  it('registers ONLY the sweep scheduler for a webhook connector (sync scheduler removed)', async () => {
    await syncConnectorScheduler(
      connector({
        syncBehavior: 'webhook',
        scheduleConfig: {
          triggerInterval: 'custom',
          customCron: '0 4 * * *',
          timeBetweenTriggers: {},
        },
      })
    )
    // Sync scheduler explicitly removed (webhook ≠ scheduled) — never upserted.
    expect(removeJobScheduler).toHaveBeenCalledWith('data-connector-sync-dc1')
    // Sweep scheduler IS reached and registered with the custom cadence — this is the
    // exact call path the old early-return skipped entirely.
    expect(upsertJobScheduler).toHaveBeenCalledTimes(1)
    const [id, repeat] = upsertJobScheduler.mock.calls[0] as [string, { pattern: string }]
    expect(id).toBe('data-connector-sweep-dc1')
    expect(repeat.pattern).toBe('0 4 * * *')
  })

  it('registers ONLY the sync scheduler for a scheduled connector (sweep scheduler removed — no double-registration)', async () => {
    await syncConnectorScheduler(
      connector({
        syncBehavior: 'scheduled',
        scheduleConfig: { triggerInterval: 'days', timeBetweenTriggers: { days: 1 } },
      })
    )
    expect(upsertJobScheduler).toHaveBeenCalledTimes(1)
    const [id] = upsertJobScheduler.mock.calls[0] as [string]
    expect(id).toBe('data-connector-sync-dc1')
    expect(removeJobScheduler).toHaveBeenCalledWith('data-connector-sweep-dc1')
  })

  it('removes both schedulers for a manual connector', async () => {
    await syncConnectorScheduler(connector({ syncBehavior: 'manual' }))
    expect(upsertJobScheduler).not.toHaveBeenCalled()
    expect(removeJobScheduler).toHaveBeenCalledWith('data-connector-sync-dc1')
    expect(removeJobScheduler).toHaveBeenCalledWith('data-connector-sweep-dc1')
  })
})
