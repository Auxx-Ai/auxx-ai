// packages/lib/src/field-values/converters/index.ts

import type { TypedFieldValueInput, TypedFieldValue } from '@auxx/types/field-value'
import type { FieldType } from '@auxx/database/types'
import type { CurrencyOptions } from '@auxx/types/custom-field'

/**
 * Unified field options interface.
 * Represents all possible options stored in CustomField.options JSONB column.
 * Each converter reads what it needs and provides defaults for missing values.
 */
export interface FieldOptions {
  // ─────────────────────────────────────────────────────────────
  // NUMBER (flat)
  // ─────────────────────────────────────────────────────────────
  decimals?: number
  useGrouping?: boolean
  displayAs?: 'number' | 'percentage' | 'compact' | 'bytes'
  prefix?: string
  suffix?: string

  // ─────────────────────────────────────────────────────────────
  // DATE / DATETIME / TIME (flat)
  // ─────────────────────────────────────────────────────────────
  format?: 'short' | 'medium' | 'long' | 'relative' | 'iso' | 'time-only'
  timeFormat?: '12h' | '24h'
  includeTime?: boolean
  timeZone?: string

  // ─────────────────────────────────────────────────────────────
  // CHECKBOX (flat)
  // ─────────────────────────────────────────────────────────────
  checkboxStyle?: 'icon' | 'text' | 'icon-text'
  trueLabel?: string
  falseLabel?: string

  // ─────────────────────────────────────────────────────────────
  // TEXT (flat)
  // ─────────────────────────────────────────────────────────────
  truncateLength?: number
  copyValue?: boolean

  // ─────────────────────────────────────────────────────────────
  // PHONE (flat)
  // ─────────────────────────────────────────────────────────────
  phoneFormat?: 'raw' | 'national' | 'international'

  // ─────────────────────────────────────────────────────────────
  // SELECT (flat)
  // ─────────────────────────────────────────────────────────────
  maxItemsShown?: number
  truncateLabel?: boolean

  // ─────────────────────────────────────────────────────────────
  // CURRENCY (nested - existing structure)
  // ─────────────────────────────────────────────────────────────
  currency?: CurrencyOptions

  // ─────────────────────────────────────────────────────────────
  // SELECT OPTIONS (nested - normalized with 'value' key for UI)
  // ─────────────────────────────────────────────────────────────
  options?: Array<{
    id?: string
    value: string
    label: string
    color?: string
    /** Target time for items in this status (kanban time tracking) */
    targetTimeInStatus?: { value: number; unit: 'days' | 'months' | 'years' }
    /** Trigger celebration when moving to this status (kanban) */
    celebration?: boolean
  }>

  // ─────────────────────────────────────────────────────────────
  // FILE (nested - existing structure)
  // ─────────────────────────────────────────────────────────────
  file?: {
    allowMultiple?: boolean
    maxFiles?: number
    allowedFileTypes?: string[]
  }

  // ─────────────────────────────────────────────────────────────
  // RELATIONSHIP (nested - for UI consumers)
  // ─────────────────────────────────────────────────────────────
  relationship?: {
    /** Entity definition UUID for custom entity relationships */
    relatedEntityDefinitionId?: string
    /** Model type for system resource relationships (e.g., 'contact', 'ticket') */
    relatedModelType?: string
    /** Relationship cardinality */
    relationshipType?: 'belongs_to' | 'has_one' | 'has_many'
  }
}

// ─────────────────────────────────────────────────────────────
// NARROWED FIELD OPTIONS (Pick from FieldOptions)
// Use these in components/converters that work with specific field types
// ─────────────────────────────────────────────────────────────

/** Options for NUMBER fields */
export type NumberFieldOptions = Pick<
  FieldOptions,
  'decimals' | 'useGrouping' | 'displayAs' | 'prefix' | 'suffix'
>

/** Options for DATE/DATETIME/TIME fields */
export type DateFieldOptions = Pick<FieldOptions, 'format' | 'timeFormat' | 'includeTime' | 'timeZone'>

/** Options for CHECKBOX fields */
export type BooleanFieldOptions = Pick<FieldOptions, 'checkboxStyle' | 'trueLabel' | 'falseLabel'>

/** Options for TEXT fields */
export type TextFieldOptions = Pick<FieldOptions, 'truncateLength' | 'copyValue'>

/** Options for PHONE fields */
export type PhoneFieldOptions = Pick<FieldOptions, 'phoneFormat'>

/** Options for SELECT/MULTI_SELECT/TAGS fields */
export type SelectFieldOptions = Pick<FieldOptions, 'maxItemsShown' | 'truncateLabel'>

/**
 * Converter options passed to toTypedInput
 */
export interface ConverterOptions {
  /** For relationship fields: the related entity definition ID */
  relatedEntityDefinitionId?: string
  /** For select fields: available options for lookup */
  selectOptions?: { id?: string; value: string; label: string }[]
}

/**
 * Converter interface - all converters follow this pattern.
 * Converters are keyed by FieldType, not by storage type.
 */
export interface FieldValueConverter {
  /**
   * Convert raw input → TypedFieldValueInput
   * Handles any input format, validates, coerces to correct type.
   * Returns null if value should be cleared/deleted.
   * Throws if value is invalid.
   */
  toTypedInput(value: unknown, options?: ConverterOptions): TypedFieldValueInput | null

  /**
   * Convert TypedFieldValue/Input → raw primitive value.
   * Strips out metadata (id, timestamps).
   * For relationships: preserves {relatedEntityId, relatedEntityDefinitionId}.
   * Called before API calls.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): unknown

  /**
   * Convert TypedFieldValue → display value for UI.
   * Returns human-readable formatted string for most types.
   * For RELATIONSHIP: returns raw relationship object for frontend hydration.
   *
   * @param value - The typed field value
   * @param options - Field options from CustomField.options (merged with converter defaults)
   */
  toDisplayValue(value: TypedFieldValue, options?: FieldOptions): unknown
}

// Import all converters (will be added as we create them)
import { textConverter } from './text'
import { numberConverter, currencyConverter } from './number'
import { booleanConverter } from './boolean'
import { dateConverter } from './date'
import { selectConverter } from './select'
import { relationshipConverter } from './relationship'
import { jsonConverter, nameConverter, fileConverter } from './json'
import { phoneConverter } from './phone'

/**
 * Map of all converters keyed by FieldType.
 * This is the key routing table for all formatting.
 */
export const converters: Record<FieldType, FieldValueConverter> = {
  // Text family - all store as valueText in database
  TEXT: textConverter,
  EMAIL: textConverter,
  URL: textConverter,
  PHONE_INTL: phoneConverter,
  ADDRESS: textConverter,
  RICH_TEXT: textConverter,

  // Number family - store as valueNumber in database
  NUMBER: numberConverter,
  CURRENCY: currencyConverter,

  // Boolean - stores as valueBoolean in database
  CHECKBOX: booleanConverter,

  // Date family - store as valueDate in database
  DATE: dateConverter,
  DATETIME: dateConverter,
  TIME: dateConverter,

  // Select family - store as optionId in database
  SINGLE_SELECT: selectConverter,
  MULTI_SELECT: selectConverter,
  TAGS: selectConverter,

  // Relationship - stores as relatedEntityId + relatedEntityDefinitionId
  RELATIONSHIP: relationshipConverter,

  // JSON family - store as valueJson in database
  NAME: nameConverter,
  ADDRESS_STRUCT: jsonConverter,
  FILE: fileConverter,
}

export {
  textConverter,
  numberConverter,
  currencyConverter,
  booleanConverter,
  dateConverter,
  selectConverter,
  relationshipConverter,
  jsonConverter,
  nameConverter,
  fileConverter,
  phoneConverter,
}
