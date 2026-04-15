// packages/lib/src/custom-fields/field-options.ts

import type { FieldType } from '@auxx/database/types'
import type {
  ActorOptions,
  CurrencyOptions,
  RelationshipConfig,
  SelectOptionColor,
} from '@auxx/types/custom-field'

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
    color?: SelectOptionColor
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
  // RELATIONSHIP (nested - uses RelationshipConfig from @auxx/types/custom-field)
  // ─────────────────────────────────────────────────────────────
  relationship?: RelationshipConfig

  // ─────────────────────────────────────────────────────────────
  // ACTOR (nested - uses ActorOptions from @auxx/types/custom-field)
  // ─────────────────────────────────────────────────────────────
  actor?: ActorOptions

  // ─────────────────────────────────────────────────────────────
  // SYSTEM FIELD OPTIONS (for seeder)
  // ─────────────────────────────────────────────────────────────
  /** Icon name for the field */
  icon?: string
  /** Whether this is a custom field (false for system fields) */
  isCustom?: boolean

  // ─────────────────────────────────────────────────────────────
  // CALC (calculated/formula field)
  // ─────────────────────────────────────────────────────────────
  calc?: CalcOptions

  // ─────────────────────────────────────────────────────────────
  // EMAIL (participant search)
  // ─────────────────────────────────────────────────────────────
  email?: EmailFieldOptions

  // ─────────────────────────────────────────────────────────────
  // ADDRESS (structured address field)
  // ─────────────────────────────────────────────────────────────
  address?: AddressFieldOptions
  /** Structured address components stored for ADDRESS_STRUCT fields */
  addressComponents?: string[]

  // ─────────────────────────────────────────────────────────────
  // NAME (composite name field)
  // ─────────────────────────────────────────────────────────────
  /** NAME field options - references two TEXT fields for firstName/lastName */
  name?: NameFieldOptions
}

/**
 * Options for EMAIL fields with participant search.
 * Controls participant type filtering when used with ParticipantPicker.
 */
export interface EmailFieldOptions {
  /** Filter participants by type (from/to/cc/any) */
  participantType?: 'from' | 'to' | 'cc' | 'any'
}

/**
 * Options for NAME fields.
 * NAME fields combine two TEXT fields (firstName, lastName) into a single editable name.
 * Values are computed on-the-fly using the CALC infrastructure.
 */
export interface NameFieldOptions {
  /** Field ID of the firstName TEXT field */
  firstNameFieldId: string
  /** Field ID of the lastName TEXT field */
  lastNameFieldId: string
}

/**
 * Options for CALC (calculated) fields.
 * CALC fields compute their value based on expressions referencing other fields.
 * Values are computed on-the-fly during display (not stored in the database).
 */
export interface CalcOptions {
  /** The expression to evaluate, e.g., 'multiply({{quantity}}, {{unitPrice}})' */
  expression: string
  /**
   * Maps expression placeholder names to field IDs (database UUIDs).
   * Key: placeholder name used in expression (e.g., 'quantity')
   * Value: the field ID (UUID) of the referenced field
   */
  sourceFields: Record<string, string>
  /** Field type to use for formatting the result (e.g., 'CURRENCY', 'NUMBER', 'TEXT') */
  resultFieldType: FieldType
  /** Whether this field is disabled due to missing dependencies */
  disabled?: boolean
  /** Reason why the field is disabled (e.g., 'Source field "quantity" was deleted') */
  disabledReason?: string
}

/** Narrowed options type for CALC fields */
export type CalcFieldOptions = Pick<FieldOptions, 'calc'>

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
export type DateFieldOptions = Pick<
  FieldOptions,
  'format' | 'timeFormat' | 'includeTime' | 'timeZone'
>

/** Options for CHECKBOX fields */
export type BooleanFieldOptions = Pick<FieldOptions, 'checkboxStyle' | 'trueLabel' | 'falseLabel'>

/** Options for TEXT fields */
export type TextFieldOptions = Pick<FieldOptions, 'truncateLength' | 'copyValue'>

/** Options for PHONE fields */
export type PhoneFieldOptions = Pick<FieldOptions, 'phoneFormat'>

/** Options for SELECT/MULTI_SELECT/TAGS fields */
export type SelectFieldOptions = Pick<FieldOptions, 'maxItemsShown' | 'truncateLabel'>

/**
 * Options for ADDRESS / ADDRESS_STRUCT fields.
 * Controls the visual style of the address input fields.
 */
export interface AddressFieldOptions {
  /** Input variant for address sub-fields */
  inputVariant?: 'default' | 'transparent'
}
