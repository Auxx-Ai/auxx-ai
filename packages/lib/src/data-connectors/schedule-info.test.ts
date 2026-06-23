// packages/lib/src/data-connectors/schedule-info.test.ts
import { describe, expect, it } from 'vitest'
import { deriveConnectorScheduleInfo } from './schedule-info'
import type { ScheduledTriggerConfig } from './types'

const NOW = Date.parse('2026-06-22T12:00:00.000Z')

function config(
  triggerInterval: ScheduledTriggerConfig['triggerInterval'],
  amount: number
): ScheduledTriggerConfig {
  return {
    triggerInterval,
    timeBetweenTriggers: { [triggerInterval]: amount, isConstant: true },
  }
}

describe('deriveConnectorScheduleInfo', () => {
  it('returns nulls for a manual connector', () => {
    expect(
      deriveConnectorScheduleInfo({
        syncBehavior: 'manual',
        status: 'live',
        scheduleConfig: config('hours', 1),
        lastSyncedAt: new Date(NOW),
        now: NOW,
      })
    ).toEqual({ nextSyncAt: null, cadenceLabel: null })
  })

  it('returns nulls when paused even if scheduled', () => {
    expect(
      deriveConnectorScheduleInfo({
        syncBehavior: 'scheduled',
        status: 'paused',
        scheduleConfig: config('minutes', 15),
        lastSyncedAt: new Date(NOW),
        now: NOW,
      })
    ).toEqual({ nextSyncAt: null, cadenceLabel: null })
  })

  it('derives next-time + cadence from lastSyncedAt + interval', () => {
    const last = new Date(NOW - 4 * 60_000) // synced 4 min ago
    const result = deriveConnectorScheduleInfo({
      syncBehavior: 'scheduled',
      status: 'live',
      scheduleConfig: config('minutes', 15),
      lastSyncedAt: last,
      now: NOW,
    })
    expect(result.cadenceLabel).toBe('every 15 minutes')
    // 4 min ago + 15 min = 11 min from now.
    expect(result.nextSyncAt).toBe(new Date(NOW + 11 * 60_000).toISOString())
  })

  it('singularizes a count of 1', () => {
    expect(
      deriveConnectorScheduleInfo({
        syncBehavior: 'scheduled',
        status: 'live',
        scheduleConfig: config('hours', 1),
        lastSyncedAt: new Date(NOW),
        now: NOW,
      }).cadenceLabel
    ).toBe('every hour')
  })

  it('clamps an overdue next-time to now', () => {
    const last = new Date(NOW - 60 * 60_000) // synced an hour ago, 15-min cadence
    const result = deriveConnectorScheduleInfo({
      syncBehavior: 'scheduled',
      status: 'live',
      scheduleConfig: config('minutes', 15),
      lastSyncedAt: last,
      now: NOW,
    })
    expect(result.nextSyncAt).toBe(new Date(NOW).toISOString())
  })

  it('falls back to now when never synced', () => {
    const result = deriveConnectorScheduleInfo({
      syncBehavior: 'scheduled',
      status: 'live',
      scheduleConfig: config('hours', 6),
      lastSyncedAt: null,
      now: NOW,
    })
    expect(result.nextSyncAt).toBe(new Date(NOW + 6 * 3_600_000).toISOString())
  })

  it('labels custom-cron without a next-time estimate', () => {
    const result = deriveConnectorScheduleInfo({
      syncBehavior: 'scheduled',
      status: 'live',
      scheduleConfig: {
        triggerInterval: 'custom',
        timeBetweenTriggers: {},
        customCron: '0 */2 * * *',
      },
      lastSyncedAt: new Date(NOW),
      now: NOW,
    })
    expect(result).toEqual({ nextSyncAt: null, cadenceLabel: 'on a custom schedule' })
  })
})
