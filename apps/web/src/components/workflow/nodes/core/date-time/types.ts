// apps/web/src/components/workflow/nodes/core/date-time/types.ts

import type { NodeType } from '~/components/workflow/types/node-types'
import type { BaseNodeData, SpecificNode } from '../../../types'

/**
 * Available date/time operations
 */
export enum DateTimeOperation {
  ADD_SUBTRACT = 'add_subtract',
  FORMAT = 'format',
  TIME_BETWEEN = 'time_between',
  ROUND = 'round',
  PARSE_DATE = 'parse_date',
}

/**
 * Time units for date operations
 */
export enum TimeUnit {
  YEARS = 'years',
  QUARTERS = 'quarters',
  MONTHS = 'months',
  WEEKS = 'weeks',
  DAYS = 'days',
  HOURS = 'hours',
  MINUTES = 'minutes',
  SECONDS = 'seconds',
  MILLISECONDS = 'milliseconds',
}

/**
 * Supported date format types
 */
export enum DateFormatType {
  CUSTOM = 'custom',
  ISO = 'iso', // ISO 8601
  MM_DD_YYYY = 'mm_dd_yyyy',
  DD_MM_YYYY = 'dd_mm_yyyy',
  YYYY_MM_DD = 'yyyy_mm_dd',
  MM_DD_YYYY_DASH = 'mm-dd-yyyy',
  DD_MM_YYYY_DASH = 'dd-mm-yyyy',
  YYYY_MM_DD_DASH = 'yyyy-mm-dd',
  UNIX = 'unix',
  UNIX_MS = 'unix_ms',
  RELATIVE = 'relative', // "2 hours ago"
  LONG = 'long', // "January 1, 2024"
  SHORT = 'short', // "1/1/24"
  TIME_ONLY = 'time_only', // "14:30:00"
  DATE_ONLY = 'date_only', // "2024-01-01"
}

/**
 * Supported parse format types for PARSE_DATE operation
 */
export enum ParseDateFormatType {
  AUTO = 'auto',
  ISO = 'iso',
  MM_DD_YYYY = 'mm_dd_yyyy',
  DD_MM_YYYY = 'dd_mm_yyyy',
  YYYY_MM_DD = 'yyyy_mm_dd',
  MM_DD_YYYY_DASH = 'mm-dd-yyyy',
  DD_MM_YYYY_DASH = 'dd-mm-yyyy',
  YYYY_MM_DD_DASH = 'yyyy-mm-dd',
  UNIX = 'unix',
  UNIX_MS = 'unix_ms',
  CUSTOM = 'custom',
}

/**
 * Date time node data interface - flattened structure
 */
export interface DateTimeNodeData extends BaseNodeData {
  operation: DateTimeOperation

  // Shared fields
  inputDate: string // Variable ID for date input
  isInputDateConstant: boolean
  // inputDateType?:
  // Operation-specific fields
  addSubtract?: { action: 'add' | 'subtract'; duration: number; unit: TimeUnit }

  format?: {
    type: DateFormatType
    customFormat?: string // Only when type is 'custom'
  }

  timeBetween?: {
    endDate?: string // Variable ID
    isEndDateConstant: boolean
    unit: TimeUnit
  }

  round?: { direction: 'up' | 'down' | 'nearest'; unit: TimeUnit }

  parseDate?: {
    formatType: ParseDateFormatType
    customFormat?: string
  }

  // Additional settings
  timezone?: string // Default to user's timezone
  locale?: string // For formatting
  outputAsTimestamp?: boolean // Option to output Unix timestamp
}

/**
 * Full Date-Time node type for React Flow
 */
export type DateTimeNode = SpecificNode<'date-time', DateTimeNodeData>

/**
 * Options for dropdowns
 */
export interface DateTimeSelectOption {
  value: string
  label: string
  description?: string
}
