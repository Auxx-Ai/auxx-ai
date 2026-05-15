// packages/lib/src/workflows/cron-pattern.ts

/**
 * Shared cron-pattern helpers — used by both workflow and agent scheduled
 * triggers. Extracted from `ScheduledTriggerService` so both runtimes hit
 * one implementation.
 */

export interface ScheduledTriggerConfig {
  triggerInterval: 'minutes' | 'hours' | 'days' | 'weeks' | 'custom'
  timeBetweenTriggers: {
    minutes?: number | string
    hours?: number | string
    days?: number | string
    weeks?: number | string
    isConstant?: boolean
  }
  customCron?: string
  timezone?: string
}

/**
 * Convert a trigger config into a cron pattern (BullMQ-compatible — 6-field).
 * Throws on invalid configuration so callers can surface validation errors
 * before persisting the row.
 */
export function convertToCronPattern(config: ScheduledTriggerConfig): string {
  if (config.triggerInterval === 'custom') {
    if (!config.customCron) {
      throw new Error('Custom cron expression is required when using custom interval')
    }
    return config.customCron
  }

  const intervalValue = config.timeBetweenTriggers[config.triggerInterval]
  const isConstant = config.timeBetweenTriggers.isConstant ?? true

  if (!isConstant) {
    throw new Error(
      'Variable-based intervals not supported for scheduling - values must be constants'
    )
  }

  if (typeof intervalValue === 'string') {
    throw new Error('String values not supported for scheduling - values must be numeric constants')
  }

  if (!intervalValue || typeof intervalValue !== 'number' || intervalValue <= 0) {
    throw new Error(`Invalid ${config.triggerInterval} value: ${intervalValue}`)
  }

  return intervalToCron(config.triggerInterval, intervalValue)
}

export function intervalToCron(interval: string, value: number): string {
  switch (interval) {
    case 'minutes':
      if (value >= 60) {
        throw new Error('Minutes interval must be less than 60')
      }
      return `0 */${value} * * * *`
    case 'hours':
      if (value >= 24) {
        throw new Error('Hours interval must be less than 24')
      }
      return `0 0 */${value} * * *`
    case 'days':
      if (value >= 31) {
        throw new Error('Days interval must be less than 31')
      }
      return `0 0 0 */${value} * *`
    case 'weeks':
      if (value >= 52) {
        throw new Error('Weeks interval must be less than 52')
      }
      return value === 1 ? '0 0 0 * * 0' : `0 0 0 * * */${value * 7}`
    default:
      throw new Error(`Unsupported interval: ${interval}`)
  }
}
