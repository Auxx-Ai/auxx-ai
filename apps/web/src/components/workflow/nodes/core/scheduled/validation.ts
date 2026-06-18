// apps/web/src/components/workflow/nodes/core/scheduled-trigger/validation.ts

import { validateCronExpression } from '~/components/global/schedule/cron-validation'
import type { ScheduledTriggerUIConfig, ScheduledTriggerValidationResult } from './types'

// Mirrors MIN_SCHEDULE_INTERVAL_MINUTES (packages/lib cron-pattern); the
// scheduler rejects sub-5-minute simple cadences, so flag them as errors here.
const MIN_MINUTES = 5

/**
 * Comprehensive validation for scheduled trigger configuration
 */
export function validateScheduledTriggerConfig(
  config: ScheduledTriggerUIConfig
): ScheduledTriggerValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Validate interval configuration
  if (config.triggerInterval !== 'custom') {
    const intervalValue = config.timeBetweenTriggers[config.triggerInterval]
    const isConstant = config.timeBetweenTriggers.isConstant ?? true

    if (!intervalValue) {
      errors.push(`${config.triggerInterval} value is required`)
    } else if (isConstant && typeof intervalValue === 'number' && intervalValue <= 0) {
      errors.push(`${config.triggerInterval} value must be greater than 0`)
    } else if (!isConstant && typeof intervalValue === 'string' && intervalValue.trim() === '') {
      errors.push(`${config.triggerInterval} variable reference cannot be empty`)
    }

    // Check for reasonable limits (only for constant numeric values)
    if (isConstant && typeof intervalValue === 'number') {
      switch (config.triggerInterval) {
        case 'minutes':
          if (intervalValue > 1440) {
            warnings.push(
              'Interval longer than 24 hours (1440 minutes) might be better configured as days'
            )
          }
          if (intervalValue < MIN_MINUTES) {
            errors.push(`Minimum interval is ${MIN_MINUTES} minutes`)
          }
          break
        case 'hours':
          if (intervalValue > 168) {
            warnings.push(
              'Interval longer than 1 week (168 hours) might be better configured as weeks'
            )
          }
          break
        case 'days':
          if (intervalValue > 365) {
            warnings.push('Interval longer than 1 year (365 days) may not be practical')
          }
          break
        case 'weeks':
          if (intervalValue > 52) {
            warnings.push('Interval longer than 1 year (52 weeks) may not be practical')
          }
          break
      }
    } else if (!isConstant) {
      // For variable references, add a note about runtime validation
      warnings.push(
        'Variable values will be validated at runtime - ensure the variable contains a positive number'
      )
    }
  }

  // Validate custom cron expression
  if (config.triggerInterval === 'custom') {
    if (!config.customCron || config.customCron.trim() === '') {
      errors.push('Custom cron expression is required when using custom interval')
    } else {
      const cronValidation = validateCronExpression(config.customCron)
      if (!cronValidation.isValid) {
        errors.push(...cronValidation.errors)
      }
      warnings.push(...cronValidation.warnings)
    }
  }

  // Validate timezone
  if (config.timezone) {
    if (!isValidTimezone(config.timezone)) {
      errors.push('Invalid timezone identifier')
    }
  }

  // Validate start date
  if (config.startDate) {
    const startDate = new Date(config.startDate)
    if (Number.isNaN(startDate.getTime())) {
      errors.push('Invalid start date format')
    } else if (startDate < new Date()) {
      warnings.push('Start date is in the past - workflow will start immediately')
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Check if timezone identifier is valid
 */
function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/**
 * Get suggested improvements for cron expressions
 */
export function getCronSuggestions(cron: string): string[] {
  const suggestions: string[] = []

  if (!cron) return suggestions

  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return suggestions

  const [minute, hour, day, month, weekday] = parts

  // Suggest common patterns
  if (minute === '0' && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    suggestions.push('This runs every hour. Consider if you need this frequency.')
  }

  if (minute === '0' && hour === '0' && day === '*' && month === '*' && weekday === '*') {
    suggestions.push('This runs daily at midnight. Consider your timezone setting.')
  }

  if (minute === '0' && hour === '9' && day === '*' && month === '*' && weekday === '1-5') {
    suggestions.push('This runs weekdays at 9 AM - great for business hours automation.')
  }

  return suggestions
}
