// packages/lib/src/custom-fields/field-options.ts

import type { CurrencyOptions, RelationshipConfig } from '@auxx/types/custom-field'

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
  // RELATIONSHIP (nested - uses RelationshipConfig from @auxx/types/custom-field)
  // ─────────────────────────────────────────────────────────────
  relationship?: RelationshipConfig

  // ─────────────────────────────────────────────────────────────
  // SYSTEM FIELD OPTIONS (for seeder)
  // ─────────────────────────────────────────────────────────────
  /** Icon name for the field */
  icon?: string
  /** Whether this is a custom field (false for system fields) */
  isCustom?: boolean
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
