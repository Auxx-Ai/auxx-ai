// apps/web/src/components/global/schedule/cron-validation.ts

/**
 * Standalone cron-expression validation — per-field range checks for the
 * 5-field `minute hour day month weekday` format, with named months/weekdays.
 * Shared by the global {@link CronEditor} and the workflow scheduled-trigger
 * config validation (`validateScheduledTriggerConfig`). No workflow deps so it
 * is safe to reuse anywhere.
 */

export interface CronValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate a 5-field cron expression with detailed, field-level error reporting.
 */
export function validateCronExpression(cron: string): CronValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!cron || typeof cron !== 'string') {
    errors.push('Cron expression cannot be empty')
    return { isValid: false, errors, warnings }
  }

  const cronParts = cron.trim().split(/\s+/)

  // Must have exactly 5 parts: minute hour day month weekday
  if (cronParts.length !== 5) {
    errors.push('Cron expression must have exactly 5 fields: minute hour day month weekday')
    return { isValid: false, errors, warnings }
  }

  const [minute = '', hour = '', day = '', month = '', weekday = ''] = cronParts

  const fieldResults = [
    validateCronField(minute, 'minute', 0, 59),
    validateCronField(hour, 'hour', 0, 23),
    validateCronField(day, 'day', 1, 31),
    validateCronField(month, 'month', 1, 12, [
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
    ]),
    validateCronField(weekday, 'weekday', 0, 7, ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']),
  ]

  for (const result of fieldResults) {
    errors.push(...result.errors)
    warnings.push(...result.warnings)
  }

  // Flag very frequent executions
  if (minute === '*' && hour === '*') {
    warnings.push(
      'This expression runs every minute — consider whether this frequency is necessary'
    )
  }

  return { isValid: errors.length === 0, errors, warnings }
}

/**
 * Validate an individual cron field (supports `*`, lists, ranges, and steps).
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
      const [start = '', end = ''] = trimmedValue.split('-')
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
      const [range = '', step = ''] = trimmedValue.split('/')
      const stepNum = parseInt(step, 10)

      if (Number.isNaN(stepNum) || stepNum <= 0) {
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
 * Parse a cron field value (numeric or named month/weekday) into a number.
 */
function parseFieldValue(value: string, namedValues?: string[]): number | null {
  const trimmed = value.trim().toUpperCase()

  const numValue = parseInt(trimmed, 10)
  if (!Number.isNaN(numValue)) {
    return numValue
  }

  if (namedValues) {
    const index = namedValues.indexOf(trimmed)
    if (index !== -1) {
      return index + (namedValues.includes('SUN') ? 0 : 1) // Weekdays start at 0, months at 1
    }
  }

  return null
}
