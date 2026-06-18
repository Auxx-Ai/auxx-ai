// apps/web/src/components/global/schedule/scheduled-config.ts

import type { Interval } from './interval-selector'

export type ScheduledMode = 'simple' | 'cron'

/**
 * UI state for the schedule editor. `mode` toggles between a simple
 * `[value] [interval]` cadence and a raw cron expression.
 */
export interface ScheduledState {
  mode: ScheduledMode
  interval: Interval
  value: number
  customCron: string
}

export const DEFAULT_SCHEDULED_STATE: ScheduledState = {
  mode: 'simple',
  interval: 'hours',
  value: 1,
  customCron: '',
}

/**
 * The serialized scheduled config persisted on a trigger / connector. Shared
 * with the backend scheduler (`convertToCronPattern`,
 * `packages/lib/src/workflows/cron-pattern.ts`) which reads the same shape
 * across the workflow / agent / knowledge-source / connector schedulers.
 *
 * - simple: `{ triggerInterval, timeBetweenTriggers: { [interval]: value, isConstant: true } }`
 * - cron:   `{ triggerInterval: 'custom', timeBetweenTriggers: {}, customCron }`
 */
export interface ScheduledTriggerConfig {
  triggerInterval: Interval | 'custom'
  timeBetweenTriggers: Record<string, number | string | boolean>
  customCron?: string
}

/**
 * Parse a stored `ScheduledTriggerConfig` (or arbitrary jsonb blob) into the
 * editor's `ScheduledState`. The `triggerInterval: 'custom'` ↔
 * `timeBetweenTriggers` mapping is the inverse of {@link scheduledConfigFromState}.
 */
export function scheduledStateFromConfig(
  config: Record<string, unknown> | null | undefined
): ScheduledState {
  const cfg = config ?? {}
  const triggerInterval = (cfg.triggerInterval as Interval | 'custom') ?? 'hours'
  if (triggerInterval === 'custom') {
    return {
      ...DEFAULT_SCHEDULED_STATE,
      mode: 'cron',
      customCron: (cfg.customCron as string) ?? '',
    }
  }
  const timeBetween = (cfg.timeBetweenTriggers as Record<string, number | string>) ?? {}
  const rawValue = timeBetween[triggerInterval]
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue) || 1
  return {
    ...DEFAULT_SCHEDULED_STATE,
    mode: 'simple',
    interval: triggerInterval,
    value,
  }
}

/**
 * Serialize the editor's `ScheduledState` into a `ScheduledTriggerConfig`.
 * Returns `null` for cron mode with an empty expression so callers can surface
 * a validation error. Inverse of {@link scheduledStateFromConfig}.
 */
export function scheduledConfigFromState(state: ScheduledState): ScheduledTriggerConfig | null {
  if (state.mode === 'cron') {
    if (!state.customCron.trim()) {
      return null
    }
    return {
      triggerInterval: 'custom',
      timeBetweenTriggers: {},
      customCron: state.customCron,
    }
  }
  return {
    triggerInterval: state.interval,
    timeBetweenTriggers: {
      [state.interval]: state.value,
      isConstant: true,
    },
  }
}
