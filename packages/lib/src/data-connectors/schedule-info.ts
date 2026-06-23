// packages/lib/src/data-connectors/schedule-info.ts
// Derive the human-facing schedule info for a connector's status line (Step 9 §3.3).
// Pure: no DB, no queue read. `nextSyncAt` is APPROXIMATED as lastSyncedAt + interval
// (the UX copy is "next in ~11 min" — inherently fuzzy; we never need the exact cron
// tick BullMQ holds in Redis). Custom-cron schedules can't be cheaply parsed here, so
// they surface a cadence label but no next-time estimate. See the §10.3 freshness line.

import type { ScheduledTriggerConfig } from './types'

export interface ConnectorScheduleInfo {
  /**
   * Next scheduled sync as ISO 8601, approximated as `lastSyncedAt + interval`
   * (clamped to now when overdue). Null when the connector isn't on a fixed-interval
   * schedule (manual, paused, or custom-cron).
   */
  nextSyncAt: string | null
  /** Human cadence, e.g. "every 15 minutes" / "every hour". Null when not scheduled. */
  cadenceLabel: string | null
}

/** Milliseconds per fixed-interval unit. */
const UNIT_MS = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
} as const

export interface DeriveScheduleInput {
  syncBehavior: string
  status: string
  scheduleConfig: ScheduledTriggerConfig | null | undefined
  lastSyncedAt: Date | string | null | undefined
  /** Injectable clock (tests). Defaults to `Date.now()`. */
  now?: number
}

/**
 * Compute `{ nextSyncAt, cadenceLabel }` for the status line. Only a `scheduled`,
 * non-paused connector with a fixed-interval config yields a next-time + cadence;
 * everything else returns nulls (manual / webhook / paused), and custom-cron returns
 * a generic cadence label with no next-time.
 */
export function deriveConnectorScheduleInfo(input: DeriveScheduleInput): ConnectorScheduleInfo {
  const { syncBehavior, status, scheduleConfig } = input
  if (syncBehavior !== 'scheduled' || status === 'paused' || !scheduleConfig) {
    return { nextSyncAt: null, cadenceLabel: null }
  }

  const { triggerInterval } = scheduleConfig
  if (triggerInterval === 'custom') {
    return { nextSyncAt: null, cadenceLabel: 'on a custom schedule' }
  }

  const raw = scheduleConfig.timeBetweenTriggers[triggerInterval]
  const value = typeof raw === 'string' ? Number(raw) : raw
  if (!value || !Number.isFinite(value) || value <= 0) {
    return { nextSyncAt: null, cadenceLabel: null }
  }

  const now = input.now ?? Date.now()
  const base = input.lastSyncedAt ? new Date(input.lastSyncedAt).getTime() : now
  const intervalMs = UNIT_MS[triggerInterval] * value
  // Overdue (a missed tick / never synced after the window) reads as imminent.
  const nextMs = Math.max(base + intervalMs, now)

  return {
    nextSyncAt: new Date(nextMs).toISOString(),
    cadenceLabel: `every ${formatInterval(triggerInterval, value)}`,
  }
}

/** "minute" / "15 minutes" / "hour" / "6 hours" — singular when the count is 1. */
function formatInterval(unit: 'minutes' | 'hours' | 'days' | 'weeks', value: number): string {
  const singular = { minutes: 'minute', hours: 'hour', days: 'day', weeks: 'week' }[unit]
  return value === 1 ? singular : `${value} ${singular}s`
}
