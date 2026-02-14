// apps/web/src/components/workflow/nodes/core/scheduled-trigger/utils.ts

import { Cron } from 'croner'
import type { ProcessedScheduleConfig, ScheduledTriggerUIConfig, SchedulePreview } from './types'

/**
 * Convert UI configuration to backend-compatible format
 */
export function convertUIConfigToBackend(ui: ScheduledTriggerUIConfig): ProcessedScheduleConfig {
  if (ui.triggerInterval === 'custom') {
    return {
      type: 'cron',
      cron: ui.customCron || '',
      timezone: ui.timezone,
    }
  }

  // Convert interval-based configuration
  const intervalValue = ui.timeBetweenTriggers[ui.triggerInterval]
  if (!intervalValue) {
    throw new Error(`No value specified for ${ui.triggerInterval}`)
  }

  // Convert to number if it's a string
  const numericValue =
    typeof intervalValue === 'string' ? parseInt(intervalValue, 10) : intervalValue

  const config: ProcessedScheduleConfig = {
    type: 'interval',
    interval: {
      value: numericValue,
      unit: ui.triggerInterval,
    },
    timezone: ui.timezone,
  }

  // Add start date if specified
  if (ui.startDate) {
    config.date = ui.startDate
  }

  return config
}

/**
 * Convert backend configuration to UI-compatible format
 */
export function convertBackendToUIConfig(
  backend: ProcessedScheduleConfig
): ScheduledTriggerUIConfig {
  if (backend.type === 'cron') {
    return {
      triggerInterval: 'custom',
      timeBetweenTriggers: {},
      customCron: backend.cron || '',
      timezone: backend.timezone,
      startDate: backend.date,
    }
  }

  if (backend.type === 'interval' && backend.interval) {
    const { unit, value } = backend.interval
    return {
      triggerInterval: unit,
      timeBetweenTriggers: {
        [unit]: value,
      },
      timezone: backend.timezone,
      startDate: backend.date,
    }
  }

  // Default fallback
  return {
    triggerInterval: 'hours',
    timeBetweenTriggers: {
      hours: 1,
    },
    timezone: backend.timezone,
    startDate: backend.date,
  }
}

/**
 * Convert interval-based configuration to cron expression
 */
function intervalToCron(unit: string, value: number): string {
  switch (unit) {
    case 'minutes':
      return `*/${value} * * * *`
    case 'hours':
      return `0 */${value} * * *`
    case 'days':
      return `0 0 */${value} * *`
    case 'weeks':
      // Run every Sunday at midnight (adjust as needed)
      return `0 0 * * 0`
    default:
      return '0 * * * *' // Hourly fallback
  }
}

/**
 * Validate cron expression format using croner
 */
export function validateCronExpression(cron: string): boolean {
  if (!cron || typeof cron !== 'string') return false

  try {
    // Try to create a cron instance - if it fails, the expression is invalid
    new Cron(cron.trim(), { paused: true })
    return true
  } catch (error) {
    return false
  }
}

/**
 * Validate interval value based on unit
 */
export function validateIntervalValue(value: number, unit: string): boolean {
  if (!Number.isInteger(value) || value <= 0) return false

  // Set reasonable limits
  switch (unit) {
    case 'minutes':
      return value >= 1 && value <= 1440 // Max 1 day in minutes
    case 'hours':
      return value >= 1 && value <= 168 // Max 1 week in hours
    case 'days':
      return value >= 1 && value <= 365 // Max 1 year in days
    case 'weeks':
      return value >= 1 && value <= 52 // Max 1 year in weeks
    default:
      return false
  }
}

/**
 * Generate human-readable description for schedule configuration
 */
export function getScheduleDescription(config: ScheduledTriggerUIConfig): string {
  if (config.triggerInterval === 'custom') {
    return config.customCron ? `Custom: ${config.customCron}` : 'Custom cron expression'
  }

  const value = config.timeBetweenTriggers[config.triggerInterval]
  if (!value) return 'Invalid configuration'

  const unit = config.triggerInterval
  const unitDisplay = value === 1 ? unit.slice(0, -1) : unit // Remove 's' for singular

  return `Every ${value} ${unitDisplay}`
}

/**
 * Calculate next execution times for preview using croner
 */
export function calculateNextExecutions(
  config: ScheduledTriggerUIConfig,
  count: number = 3
): Date[] {
  try {
    let cronExpression: string

    if (config.triggerInterval === 'custom') {
      cronExpression = config.customCron || '0 * * * *' // Default to hourly
    } else {
      // Convert interval to cron expression
      const value = config.timeBetweenTriggers[config.triggerInterval]
      const numericValue = typeof value === 'string' ? parseInt(value, 10) : value

      if (!numericValue) return []

      cronExpression = intervalToCron(config.triggerInterval, numericValue)
    }

    // Get timezone (use user's timezone if not specified)
    const timezone = config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone

    // Create cron instance with timezone
    const cron = new Cron(cronExpression, {
      timezone,
      paused: true, // Don't actually run it
    })

    // Get next execution times
    const executions: Date[] = []
    let nextRun = cron.nextRun()

    for (let i = 0; i < count && nextRun; i++) {
      executions.push(new Date(nextRun))
      nextRun = cron.nextRun(nextRun)
    }

    return executions
  } catch (error) {
    console.error('Error calculating next executions:', error)
    return []
  }
}

/**
 * Create schedule preview object
 */
export function createSchedulePreview(config: ScheduledTriggerUIConfig): SchedulePreview {
  const nextExecutions = calculateNextExecutions(config, 3)
  const description = getScheduleDescription(config)

  // Basic validation
  let isValid = true
  if (config.triggerInterval === 'custom') {
    isValid = validateCronExpression(config.customCron || '')
  } else {
    const value = config.timeBetweenTriggers[config.triggerInterval]
    // Convert to number if it's a string
    const numericValue = typeof value === 'string' ? parseInt(value, 10) : value
    isValid = !!numericValue && validateIntervalValue(numericValue, config.triggerInterval)
  }

  return {
    nextExecutions,
    description,
    isValid,
  }
}

/**
 * Convert UI config to backend ScheduledTriggerConfig format for node execution
 */
export function convertUIConfigToBackendNodeData(uiConfig: ScheduledTriggerUIConfig): any {
  if (uiConfig.triggerInterval === 'custom') {
    return {
      schedule: {
        type: 'cron',
        cron: uiConfig.customCron || '',
        timezone: uiConfig.timezone,
      },
    }
  }

  // Convert interval-based configuration
  const intervalValue = uiConfig.timeBetweenTriggers[uiConfig.triggerInterval]
  if (!intervalValue) {
    throw new Error(`No value specified for ${uiConfig.triggerInterval}`)
  }

  return {
    schedule: {
      type: 'interval',
      interval: {
        value: intervalValue,
        unit: uiConfig.triggerInterval,
      },
      timezone: uiConfig.timezone,
    },
  }
}

/**
 * Generate mock trigger data for testing scheduled triggers
 */
export function generateMockTriggerData(config: ScheduledTriggerUIConfig): Record<string, any> {
  const now = new Date()

  return {
    scheduledTime: now.toISOString(),
    triggerType: 'scheduled',
    timezone: config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    executionContext: 'test_run',
    scheduleDescription: getScheduleDescription(config),
  }
}
