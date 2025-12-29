// packages/lib/src/workflow-engine/constants/nodes/date-time.ts
import type { NodeConstants } from '../types'

/**
 * Constants for Date-Time node configuration
 */
export const DATE_TIME_NODE_CONSTANTS = {
  // Date operations
  OPERATIONS: [
    'current',
    'add',
    'subtract',
    'format',
    'parse',
    'compare',
    'startOf',
    'endOf',
  ] as const,

  // Time units
  TIME_UNITS: [
    'milliseconds',
    'seconds',
    'minutes',
    'hours',
    'days',
    'weeks',
    'months',
    'years',
  ] as const,

  // Common date formats
  DATE_FORMATS: {
    'ISO 8601': 'YYYY-MM-DDTHH:mm:ssZ',
    'Date only': 'YYYY-MM-DD',
    'Time only': 'HH:mm:ss',
    'US format': 'MM/DD/YYYY',
    'European format': 'DD/MM/YYYY',
    'Full date': 'MMMM D, YYYY',
    'Full datetime': 'MMMM D, YYYY h:mm A',
    Relative: 'relative', // "2 days ago"
    'Unix timestamp': 'X',
    'Unix timestamp (ms)': 'x',
    Custom: 'custom',
  } as const,

  // Timezone handling
  TIMEZONE_OPTIONS: ['local', 'utc', 'specific'] as const,

  // Comparison operations
  COMPARISON_OPS: [
    'isBefore',
    'isAfter',
    'isSame',
    'isSameOrBefore',
    'isSameOrAfter',
    'isBetween',
  ] as const,

  // Start/End of period units
  PERIOD_UNITS: ['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'] as const,
} as const satisfies NodeConstants

// Type exports
export type DateTimeOperation = (typeof DATE_TIME_NODE_CONSTANTS.OPERATIONS)[number]
export type TimeUnit = (typeof DATE_TIME_NODE_CONSTANTS.TIME_UNITS)[number]
export type DateFormatKey = keyof typeof DATE_TIME_NODE_CONSTANTS.DATE_FORMATS
export type DateFormat = (typeof DATE_TIME_NODE_CONSTANTS.DATE_FORMATS)[DateFormatKey]
export type TimezoneOption = (typeof DATE_TIME_NODE_CONSTANTS.TIMEZONE_OPTIONS)[number]
export type ComparisonOp = (typeof DATE_TIME_NODE_CONSTANTS.COMPARISON_OPS)[number]
export type PeriodUnit = (typeof DATE_TIME_NODE_CONSTANTS.PERIOD_UNITS)[number]

// Helper to get format string
export function getDateFormatString(format: DateFormatKey): string {
  return DATE_TIME_NODE_CONSTANTS.DATE_FORMATS[format]
}

// Helper to validate custom date format
export function isValidDateFormat(format: string): boolean {
  // Basic validation - could be enhanced
  return format.length > 0 && format.length < 100
}
