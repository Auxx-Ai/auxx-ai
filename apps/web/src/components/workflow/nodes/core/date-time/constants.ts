// apps/web/src/components/workflow/nodes/core/date-time/constants.ts

import {
  DateFormatType,
  DateTimeOperation,
  type DateTimeSelectOption,
  ParseDateFormatType,
  TimeUnit,
} from './types'

/**
 * Operation options for the main selector
 */
export const OPERATION_OPTIONS: DateTimeSelectOption[] = [
  {
    value: DateTimeOperation.ADD_SUBTRACT,
    label: 'Add/Subtract from Date',
    description: 'Add or subtract time from a date',
  },
  {
    value: DateTimeOperation.FORMAT,
    label: 'Format Date',
    description: 'Convert date to a specific format',
  },
  {
    value: DateTimeOperation.TIME_BETWEEN,
    label: 'Time Between Dates',
    description: 'Calculate duration between two dates',
  },
  {
    value: DateTimeOperation.ROUND,
    label: 'Round a Date',
    description: 'Round date to nearest unit',
  },
  {
    value: DateTimeOperation.PARSE_DATE,
    label: 'Parse Date from String',
    description: 'Parse a date string into a date object',
  },
]

/**
 * Time unit options for selectors
 */
export const TIME_UNIT_OPTIONS: DateTimeSelectOption[] = [
  { value: TimeUnit.YEARS, label: 'Years' },
  { value: TimeUnit.QUARTERS, label: 'Quarters' },
  { value: TimeUnit.MONTHS, label: 'Months' },
  { value: TimeUnit.WEEKS, label: 'Weeks' },
  { value: TimeUnit.DAYS, label: 'Days' },
  { value: TimeUnit.HOURS, label: 'Hours' },
  { value: TimeUnit.MINUTES, label: 'Minutes' },
  { value: TimeUnit.SECONDS, label: 'Seconds' },
  { value: TimeUnit.MILLISECONDS, label: 'Milliseconds' },
]

/**
 * Date format options
 */
export const DATE_FORMAT_OPTIONS: DateTimeSelectOption[] = [
  { value: DateFormatType.ISO, label: 'ISO 8601', description: '2024-01-01T00:00:00.000Z' },
  { value: DateFormatType.MM_DD_YYYY, label: 'MM/DD/YYYY', description: '01/01/2024' },
  { value: DateFormatType.DD_MM_YYYY, label: 'DD/MM/YYYY', description: '01/01/2024' },
  { value: DateFormatType.YYYY_MM_DD, label: 'YYYY/MM/DD', description: '2024/01/01' },
  { value: DateFormatType.MM_DD_YYYY_DASH, label: 'MM-DD-YYYY', description: '01-01-2024' },
  { value: DateFormatType.DD_MM_YYYY_DASH, label: 'DD-MM-YYYY', description: '01-01-2024' },
  { value: DateFormatType.YYYY_MM_DD_DASH, label: 'YYYY-MM-DD', description: '2024-01-01' },
  { value: DateFormatType.UNIX, label: 'Unix Timestamp', description: '1704067200' },
  { value: DateFormatType.UNIX_MS, label: 'Unix Timestamp (ms)', description: '1704067200000' },
  { value: DateFormatType.RELATIVE, label: 'Relative', description: '2 hours ago' },
  { value: DateFormatType.LONG, label: 'Long Format', description: 'January 1, 2024' },
  { value: DateFormatType.SHORT, label: 'Short Format', description: '1/1/24' },
  { value: DateFormatType.TIME_ONLY, label: 'Time Only', description: '14:30:00' },
  { value: DateFormatType.DATE_ONLY, label: 'Date Only', description: '2024-01-01' },
  { value: DateFormatType.CUSTOM, label: 'Custom Format', description: 'Specify your own format' },
]

/**
 * Action options for add/subtract operation
 */
export const ACTION_OPTIONS: DateTimeSelectOption[] = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
]

/**
 * Direction options for round operation
 */
export const ROUND_DIRECTION_OPTIONS: DateTimeSelectOption[] = [
  { value: 'down', label: 'Round Down' },
  { value: 'up', label: 'Round Up' },
  { value: 'nearest', label: 'To Nearest' },
]

/**
 * Default duration value
 */
export const DEFAULT_DURATION = 1

/**
 * Default format type
 */
export const DEFAULT_FORMAT_TYPE = DateFormatType.ISO

/**
 * Parse date format options
 */
export const PARSE_DATE_FORMAT_OPTIONS: DateTimeSelectOption[] = [
  {
    value: ParseDateFormatType.AUTO,
    label: 'Auto Detect',
    description: 'Automatically detect format',
  },
  { value: ParseDateFormatType.ISO, label: 'ISO 8601', description: '2024-01-01T00:00:00.000Z' },
  { value: ParseDateFormatType.MM_DD_YYYY, label: 'MM/DD/YYYY', description: '01/01/2024' },
  { value: ParseDateFormatType.DD_MM_YYYY, label: 'DD/MM/YYYY', description: '01/01/2024' },
  { value: ParseDateFormatType.YYYY_MM_DD, label: 'YYYY/MM/DD', description: '2024/01/01' },
  { value: ParseDateFormatType.MM_DD_YYYY_DASH, label: 'MM-DD-YYYY', description: '01-01-2024' },
  { value: ParseDateFormatType.DD_MM_YYYY_DASH, label: 'DD-MM-YYYY', description: '01-01-2024' },
  { value: ParseDateFormatType.YYYY_MM_DD_DASH, label: 'YYYY-MM-DD', description: '2024-01-01' },
  { value: ParseDateFormatType.UNIX, label: 'Unix Timestamp', description: '1704067200' },
  { value: ParseDateFormatType.UNIX_MS, label: 'Unix (ms)', description: '1704067200000' },
  {
    value: ParseDateFormatType.CUSTOM,
    label: 'Custom Format',
    description: 'Specify format tokens',
  },
]

/**
 * Default parse format type
 */
export const DEFAULT_PARSE_FORMAT_TYPE = ParseDateFormatType.AUTO
