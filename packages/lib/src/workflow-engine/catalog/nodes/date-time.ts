// packages/lib/src/workflow-engine/catalog/nodes/date-time.ts

import { z } from 'zod'
import type { BaseNodeData } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'

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

  // Operation-specific fields
  addSubtract?: {
    action: 'add' | 'subtract'
    duration: number | string | undefined // string when variable ref
    unit: TimeUnit | string // string when variable ref
  }

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

  // Field mode tracking (true = constant, false = variable)
  fieldModes?: Record<string, boolean>

  // Additional settings
  timezone?: string // Default to user's timezone
  locale?: string // For formatting
  outputAsTimestamp?: boolean // Option to output Unix timestamp
}

/**
 * Zod schema for date-time node validation
 */
export const dateTimeNodeSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  desc: z.string().optional(),
  operation: z.enum(DateTimeOperation),

  // Shared fields
  // Empty is a legitimate PERSISTED state — the canvas default has no input
  // date until the user picks one, and half-configured nodes save.
  // Completeness lives in `validateDateTimeNodeData`, which errors on a
  // missing inputDate. (The legacy min(1) made the default data fail its own
  // schema — the same class the catalog defaults-parse test exists for.)
  inputDate: z.string().default(''),
  isInputDateConstant: z.boolean().default(true),

  // Operation-specific fields
  // `duration` and `unit` hold a variable reference (string) when the matching
  // `fieldModes` entry is false — see the panel's constant/variable toggles.
  addSubtract: z
    .object({
      action: z.enum(['add', 'subtract']),
      duration: z.union([z.number().min(0, 'Duration must be positive'), z.string()]).optional(),
      unit: z.union([z.enum(TimeUnit), z.string()]),
    })
    .optional(),

  format: z
    .object({ type: z.enum(DateFormatType), customFormat: z.string().optional() })
    .optional(),

  timeBetween: z
    .object({
      endDate: z.string().optional(),
      isEndDateConstant: z.boolean().default(true),
      unit: z.enum(TimeUnit),
    })
    .optional(),

  round: z
    .object({ direction: z.enum(['up', 'down', 'nearest']), unit: z.enum(TimeUnit) })
    .optional(),

  parseDate: z
    .object({
      formatType: z.nativeEnum(ParseDateFormatType),
      customFormat: z.string().optional(),
    })
    .optional(),

  // Field mode tracking (true = constant, false = bound to a variable)
  fieldModes: z.record(z.string(), z.boolean()).optional(),

  // Additional settings
  timezone: z.string().optional(),
  locale: z.string().optional(),
  outputAsTimestamp: z.boolean().optional(),
})

/**
 * Data validator
 */
export function validateDateTimeNodeData(data: DateTimeNodeData): NodeValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Additional validation
  switch (data.operation) {
    case DateTimeOperation.ADD_SUBTRACT:
      if (!data.addSubtract) {
        errors.push({
          field: 'addSubtract',
          message: 'Add/subtract configuration is required',
          type: 'error',
        })
      }
      break
    case DateTimeOperation.FORMAT:
      if (!data.format) {
        errors.push({ field: 'format', message: 'Format configuration is required', type: 'error' })
      } else if (data.format.type === DateFormatType.CUSTOM && !data.format.customFormat) {
        errors.push({
          field: 'format.customFormat',
          message: 'Custom format string is required',
          type: 'error',
        })
      }
      break
    case DateTimeOperation.TIME_BETWEEN:
      if (!data.timeBetween) {
        errors.push({
          field: 'timeBetween',
          message: 'Time between configuration is required',
          type: 'error',
        })
      } else if (!data.timeBetween.endDate) {
        errors.push({
          field: 'timeBetween.endDate',
          message: 'End date is required for time between operation',
          type: 'error',
        })
      }
      break
    case DateTimeOperation.ROUND:
      if (!data.round) {
        errors.push({ field: 'round', message: 'Round configuration is required', type: 'error' })
      }
      break
    case DateTimeOperation.PARSE_DATE:
      if (!data.parseDate) {
        errors.push({
          field: 'parseDate',
          message: 'Parse date configuration is required',
          type: 'error',
        })
      } else if (
        data.parseDate.formatType === ParseDateFormatType.CUSTOM &&
        !data.parseDate.customFormat
      ) {
        errors.push({
          field: 'parseDate.customFormat',
          message: 'Custom format string is required',
          type: 'error',
        })
      }
      break
  }

  // Validate that inputDate is provided for all operations
  if (!data.inputDate) {
    errors.push({ field: 'inputDate', message: 'Input date is required', type: 'error' })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Variable extraction
 */
export function extractDateTimeNodeVariables(data: DateTimeNodeData): string[] {
  const variables: string[] = []

  // Extract from main input date only if it's not a constant
  if (data.inputDate && !data.isInputDateConstant) {
    variables.push(data.inputDate)
  }

  // Extract from time between end date only if it's not a constant
  if (
    data.operation === DateTimeOperation.TIME_BETWEEN &&
    data.timeBetween?.endDate &&
    !data.timeBetween?.isEndDateConstant
  ) {
    variables.push(data.timeBetween.endDate)
  }

  return [...new Set(variables)]
}

/**
 * Date-time node manifest
 */
export const dateTimeManifest: NodeManifest<DateTimeNodeData> = {
  id: 'date-time',
  category: NodeCategory.UTILITY,
  displayName: 'Date Time',
  description: 'Perform various date and time operations',
  icon: 'calendar',
  color: '#3B82F6', // UTILITY category color
  defaultData: () => ({
    title: 'Date Time',
    operation: DateTimeOperation.ADD_SUBTRACT,
    isInputDateConstant: true,
    addSubtract: { action: 'add', duration: 1, unit: TimeUnit.DAYS },
    timeBetween: { unit: TimeUnit.DAYS, isEndDateConstant: true },
    parseDate: { formatType: ParseDateFormatType.AUTO },
  }),
  configSchema: dateTimeNodeSchema as unknown as z.ZodType<DateTimeNodeData>,
  validate: validateDateTimeNodeData,
  extractVariables: extractDateTimeNodeVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      'Pick `operation` (add_subtract | format | time_between | round | parse_date) and fill ' +
      'the matching config object. `inputDate` is a date value or {{…}} ref (set ' +
      'isInputDateConstant=false for refs). Output is always `result`.',
    examples: [
      {
        description: 'Add 3 days to an upstream date',
        config: {
          operation: 'add_subtract',
          inputDate: '{{trigger-1.createdAt}}',
          isInputDateConstant: false,
          addSubtract: { action: 'add', duration: 3, unit: 'days' },
        },
      },
    ],
  },
}
