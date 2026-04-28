// packages/lib/src/custom-fields/defaults.ts

import type {
  BooleanFieldOptions,
  CurrencyFieldOptions,
  DateFieldOptions,
  FieldOptions,
  NumberFieldOptions,
  PhoneFieldOptions,
  TextFieldOptions,
} from './field-options'

// ─────────────────────────────────────────────────────────────
// Individual defaults (exported for converters)
// ─────────────────────────────────────────────────────────────

/** Default options for TEXT fields */
export const DEFAULT_TEXT_OPTIONS: TextFieldOptions = {}

/** Default options for NUMBER fields */
export const DEFAULT_NUMBER_OPTIONS: NumberFieldOptions = {
  decimals: 0,
  useGrouping: true,
  displayAs: 'number',
  prefix: '',
  suffix: '',
}

/** Default options for CURRENCY fields */
export const DEFAULT_CURRENCY_OPTIONS: CurrencyFieldOptions = {
  currencyCode: 'USD',
  decimals: 2,
  useGrouping: true,
  currencyDisplay: 'symbol',
}

/** Default options for DATE fields */
export const DEFAULT_DATE_OPTIONS: DateFieldOptions = {
  format: 'medium',
  timeFormat: '12h',
  includeTime: false,
}

/** Default options for DATETIME fields */
export const DEFAULT_DATETIME_OPTIONS: DateFieldOptions = {
  format: 'medium',
  timeFormat: '12h',
  includeTime: true,
}

/** Default options for TIME fields */
export const DEFAULT_TIME_OPTIONS: DateFieldOptions = {
  format: 'time-only',
  timeFormat: '12h',
}

/** Default options for CHECKBOX fields */
export const DEFAULT_BOOLEAN_OPTIONS: BooleanFieldOptions = {
  checkboxStyle: 'icon-text',
  trueLabel: 'Yes',
  falseLabel: 'No',
}

/** Default options for PHONE_INTL fields */
export const DEFAULT_PHONE_OPTIONS: PhoneFieldOptions = {
  phoneFormat: 'international',
}

/** Default options for FILE fields */
export const DEFAULT_FILE_OPTIONS = {
  file: {
    allowMultiple: false,
    maxFiles: 1,
  },
}

// ─────────────────────────────────────────────────────────────
// Unified defaults record (for seeder + runtime)
// ─────────────────────────────────────────────────────────────

/**
 * FieldType enum values as string union
 * Matches FieldTypeValues from @auxx/database/enums
 */
type FieldType =
  | 'EMAIL'
  | 'ADDRESS'
  | 'URL'
  | 'TAGS'
  | 'DATE'
  | 'DATETIME'
  | 'TIME'
  | 'CHECKBOX'
  | 'TEXT'
  | 'NUMBER'
  | 'CURRENCY'
  | 'MULTI_SELECT'
  | 'SINGLE_SELECT'
  | 'RICH_TEXT'
  | 'PHONE_INTL'
  | 'ADDRESS_STRUCT'
  | 'FILE'
  | 'NAME'
  | 'RELATIONSHIP'

/**
 * Default display options for each FieldType.
 * Used by:
 * - EntitySeeder to set initial CustomField.options
 * - Converters to merge with stored options at runtime
 *
 * Note: This is different from fieldTypeDefaults in types.ts which holds
 * default empty values for field inputs.
 */
export const fieldTypeDisplayDefaults: Record<FieldType, Partial<FieldOptions>> = {
  // Text family
  TEXT: DEFAULT_TEXT_OPTIONS,
  EMAIL: DEFAULT_TEXT_OPTIONS,
  URL: DEFAULT_TEXT_OPTIONS,
  ADDRESS: DEFAULT_TEXT_OPTIONS,
  RICH_TEXT: DEFAULT_TEXT_OPTIONS,

  // Number family
  NUMBER: DEFAULT_NUMBER_OPTIONS,
  CURRENCY: DEFAULT_CURRENCY_OPTIONS,

  // Date family
  DATE: DEFAULT_DATE_OPTIONS,
  DATETIME: DEFAULT_DATETIME_OPTIONS,
  TIME: DEFAULT_TIME_OPTIONS,

  // Boolean
  CHECKBOX: DEFAULT_BOOLEAN_OPTIONS,

  // Phone
  PHONE_INTL: DEFAULT_PHONE_OPTIONS,

  // Select family (options come from field definition)
  SINGLE_SELECT: {},
  MULTI_SELECT: {},
  TAGS: {},

  // Compound types
  NAME: {},
  ADDRESS_STRUCT: {},

  // File
  FILE: DEFAULT_FILE_OPTIONS,

  // Relationship (config comes from field definition)
  RELATIONSHIP: {},
}
