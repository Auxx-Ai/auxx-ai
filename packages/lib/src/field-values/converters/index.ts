// packages/lib/src/field-values/converters/index.ts

import type { FieldType } from '@auxx/database/types'
import type { TypedFieldValue, TypedFieldValueInput } from '@auxx/types/field-value'

// Re-export field options types from centralized location
export type {
  AddressFieldOptions,
  BooleanFieldOptions,
  DateFieldOptions,
  EmailFieldOptions,
  FieldOptions,
  NumberFieldOptions,
  PhoneFieldOptions,
  SelectFieldOptions,
  TextFieldOptions,
} from '../../custom-fields/field-options'

// Import for use in this file
import type { FieldOptions } from '../../custom-fields/field-options'

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

import { actorConverter } from './actor'
import { booleanConverter } from './boolean'
import { calcConverter } from './calc'
import { dateConverter } from './date'
import { fileConverter, jsonConverter, nameConverter } from './json'
import { currencyConverter, numberConverter } from './number'
import { phoneConverter } from './phone'
import { relationshipConverter } from './relationship'
import { selectConverter } from './select'
// Import all converters (will be added as we create them)
import { textConverter } from './text'

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
  PHONE: phoneConverter,
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

  // Computed field - not stored in database
  CALC: calcConverter,

  // Actor field - stores user or group reference
  ACTOR: actorConverter,

  // Generic JSON - stores as valueJson in database
  JSON: jsonConverter,
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
  calcConverter,
  actorConverter,
}
