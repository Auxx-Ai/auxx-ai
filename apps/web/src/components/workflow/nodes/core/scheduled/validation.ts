// apps/web/src/components/workflow/nodes/core/scheduled-trigger/validation.ts

import type { ScheduledTriggerUIConfig, ScheduledTriggerValidationResult } from './types'

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
          if (intervalValue < 5) {
            warnings.push('Very frequent schedules (< 5 minutes) may impact system performance')
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
    if (isNaN(startDate.getTime())) {
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
 * Validate cron expression with detailed error reporting
 */
function validateCronExpression(cron: string): {
  isValid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (!cron || typeof cron !== 'string') {
    errors.push('Cron expression cannot be empty')
    return { isValid: false, errors, warnings }
  }

  const cronTrimmed = cron.trim()
  const cronParts = cronTrimmed.split(/\s+/)

  // Must have exactly 5 parts: minute hour day month weekday
  if (cronParts.length !== 5) {
    errors.push('Cron expression must have exactly 5 fields: minute hour day month weekday')
    return { isValid: false, errors, warnings }
  }

  const [minute, hour, day, month, weekday] = cronParts

  // Validate each field
  const minuteValidation = validateCronField(minute, 'minute', 0, 59)
  const hourValidation = validateCronField(hour, 'hour', 0, 23)
  const dayValidation = validateCronField(day, 'day', 1, 31)
  const monthValidation = validateCronField(month, 'month', 1, 12, [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ])
  const weekdayValidation = validateCronField(weekday, 'weekday', 0, 7, [
    'SUN',
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT',
  ])

  errors.push(...minuteValidation.errors)
  errors.push(...hourValidation.errors)
  errors.push(...dayValidation.errors)
  errors.push(...monthValidation.errors)
  errors.push(...weekdayValidation.errors)

  warnings.push(...minuteValidation.warnings)
  warnings.push(...hourValidation.warnings)
  warnings.push(...dayValidation.warnings)
  warnings.push(...monthValidation.warnings)
  warnings.push(...weekdayValidation.warnings)

  // Check for very frequent executions
  if (minute === '*' && hour === '*') {
    warnings.push(
      'This expression will execute every minute - consider if this frequency is necessary'
    )
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validate individual cron field
 */
function validateCronField(
  field: string,
  fieldName: string,
  min: number,
  max: number,
  namedValues?: string[]
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  if (!field) {
    errors.push(`${fieldName} field cannot be empty`)
    return { errors, warnings }
  }

  // Allow * (any value)
  if (field === '*') {
    return { errors, warnings }
  }

  // Handle comma-separated values
  const values = field.split(',')

  for (const value of values) {
    const trimmedValue = value.trim()

    // Handle ranges (e.g., 1-5)
    if (trimmedValue.includes('-')) {
      const [start, end] = trimmedValue.split('-')
      const startNum = parseFieldValue(start, namedValues)
      const endNum = parseFieldValue(end, namedValues)

      if (startNum === null || endNum === null) {
        errors.push(`Invalid range in ${fieldName}: ${trimmedValue}`)
        continue
      }

      if (startNum < min || startNum > max || endNum < min || endNum > max) {
        errors.push(`${fieldName} range ${trimmedValue} is outside valid range ${min}-${max}`)
      }

      if (startNum >= endNum) {
        errors.push(
          `Invalid range in ${fieldName}: start (${start}) must be less than end (${end})`
        )
      }
    }
    // Handle step values (e.g., */5, 1-10/2)
    else if (trimmedValue.includes('/')) {
      const [range, step] = trimmedValue.split('/')
      const stepNum = parseInt(step)

      if (isNaN(stepNum) || stepNum <= 0) {
        errors.push(`Invalid step value in ${fieldName}: ${step}`)
        continue
      }

      if (range !== '*' && !range.includes('-')) {
        errors.push(`Step values must be used with * or ranges in ${fieldName}: ${trimmedValue}`)
      }

      // Validate the range part if it's not *
      if (range !== '*') {
        const rangeValidation = validateCronField(range, fieldName, min, max, namedValues)
        errors.push(...rangeValidation.errors)
        warnings.push(...rangeValidation.warnings)
      }
    }
    // Handle single values
    else {
      const numValue = parseFieldValue(trimmedValue, namedValues)

      if (numValue === null) {
        errors.push(`Invalid value in ${fieldName}: ${trimmedValue}`)
        continue
      }

      if (numValue < min || numValue > max) {
        errors.push(`${fieldName} value ${trimmedValue} is outside valid range ${min}-${max}`)
      }
    }
  }

  return { errors, warnings }
}

/**
 * Parse cron field value (numeric or named)
 */
function parseFieldValue(value: string, namedValues?: string[]): number | null {
  const trimmed = value.trim().toUpperCase()

  // Try to parse as number first
  const numValue = parseInt(trimmed)
  if (!isNaN(numValue)) {
    return numValue
  }

  // Try named values if provided
  if (namedValues) {
    const index = namedValues.indexOf(trimmed)
    if (index !== -1) {
      return index + (namedValues.includes('SUN') ? 0 : 1) // Weekdays start at 0, months at 1
    }
  }

  return null
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
