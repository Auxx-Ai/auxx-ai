// packages/lib/src/custom-fields/field-options.ts

import type { FieldType } from '@auxx/database/types'
import type { ActorOptions, RelationshipConfig, SelectOptionColor } from '@auxx/types/custom-field'
import type { RecordId } from '@auxx/types/resource'

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
  /** Input variant for boolean editors: 'button-group' (default) or 'switch'. */
  variant?: 'button-group' | 'switch'

  // ─────────────────────────────────────────────────────────────
  // TEXT (flat)
  // ─────────────────────────────────────────────────────────────
  truncateLength?: number
  copyValue?: boolean
  /** Render the editor as a multiline autosize textarea instead of a single-line input. */
  multiline?: boolean
  /** Preferred visible row count for the multiline editor. */
  rows?: number
  /** Mask the value (single-line) and show a reveal toggle. For secrets/passwords. */
  secret?: boolean

  // ─────────────────────────────────────────────────────────────
  // PHONE (flat)
  // ─────────────────────────────────────────────────────────────
  phoneFormat?: 'raw' | 'national' | 'international'

  // ─────────────────────────────────────────────────────────────
  // URL (flat)
  // ─────────────────────────────────────────────────────────────
  /** Render the URL as a clickable link (default) or as an image thumbnail. */
  urlDisplay?: 'link' | 'image'

  // ─────────────────────────────────────────────────────────────
  // SELECT (flat)
  // ─────────────────────────────────────────────────────────────
  maxItemsShown?: number
  truncateLabel?: boolean

  // ─────────────────────────────────────────────────────────────
  // CURRENCY (flat — `decimals` and `useGrouping` are shared with NUMBER)
  // ─────────────────────────────────────────────────────────────
  /**
   * ISO 4217 code this field is denominated in. Asserted ONCE, on the field —
   * there is deliberately no per-value override. `valueNumber` holds minor
   * units in this denomination, so it is what SQL sorts, filters and sums; a
   * per-row code would mix exponents inside a single SUM with no error. A
   * genuinely multi-currency model pairs an amount field with its own currency
   * field and an FX-converted base-currency field.
   */
  currencyCode?: string
  currencyDisplay?: 'symbol' | 'code' | 'name' | 'compact'

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
  // TAXONOMY GROWTH (SINGLE_SELECT / MULTI_SELECT / TAGS)
  // ─────────────────────────────────────────────────────────────
  /**
   * May an automated writer (a CSV import, a paste, a bulk action) append new
   * options to this field's taxonomy?
   *
   * Tri-state: absent inherits the type default (TAGS grow, SELECT sets do
   * not), `true`/`false` is the user's decision. Read through
   * `fieldAllowsNewOptions` in `./ownership` — the SINGLE reader — never
   * off this interface directly, or the type default gets re-derived at each
   * call site and one of them will get it wrong.
   *
   * ⚠️ Not `ai.allowNewOptions`. That one asks whether the MODEL may invent
   * labels; this one asks whether an import may. Independent on purpose.
   */
  allowNewOptions?: boolean

  // ─────────────────────────────────────────────────────────────
  // FILE (nested - existing structure)
  // ─────────────────────────────────────────────────────────────
  file?: {
    allowMultiple?: boolean
    maxFiles?: number
    allowedFileTypes?: string[]
    /** Extension allowlist (e.g. `['pdf', 'docx']`), mirrors `fileOptionsSchema`. */
    allowedFileExtensions?: string[]
  }

  // ─────────────────────────────────────────────────────────────
  // RELATIONSHIP (nested - uses RelationshipConfig from @auxx/types/custom-field)
  // ─────────────────────────────────────────────────────────────
  relationship?: RelationshipConfig
  /**
   * RecordIds to exclude from RELATIONSHIP picker results (e.g. cycle/duplicate prevention).
   * Runtime-only filter passed by the caller — never persisted to CustomField.options.
   */
  excludeIds?: RecordId[]
  /**
   * RELATIONSHIP picker rows fall back to the related EntityDefinition's icon/color
   * for records that have no avatar, like the selected chips do. On by default —
   * set `false` only to opt a picker out.
   * Runtime-only UI flag passed by the caller — never persisted to CustomField.options.
   */
  showDefinitionIcon?: boolean
  /**
   * When true, RELATIONSHIP picker rows show the record's secondary display value
   * (SKU, email, …) muted beside the label. Off by default: it is only worth the row
   * width where that value is what people search by.
   * Runtime-only UI flag passed by the caller — never persisted to CustomField.options.
   */
  showSecondary?: boolean

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
  /** Editor variant: single free-text input (default, absent) vs. separate
   *  structured sub-fields. Mirrors `addressFieldOptionsSchema.inputMode`. */
  inputMode?: 'single' | 'structured'

  // ─────────────────────────────────────────────────────────────
  // NAME (composite name field)
  // ─────────────────────────────────────────────────────────────
  /** NAME field options - references two TEXT fields for firstName/lastName */
  name?: NameFieldOptions

  // ─────────────────────────────────────────────────────────────
  // MULTI-VALUE STORAGE (scalar types with multiple rows)
  // ─────────────────────────────────────────────────────────────
  /**
   * Force multi-value storage for this field regardless of its FieldType.
   * When true, writes go DELETE+INSERT (one FieldValue row per value)
   * and reads return an array. Used for scalar-typed fields (TEXT,
   * EMAIL, URL, PHONE) that need to hold multiple values — e.g.
   * external source ids from the Chrome extension.
   */
  multi?: boolean
}

/**
 * Options for EMAIL fields with participant search.
 * Controls participant type filtering when used with ParticipantPicker.
 */
export interface EmailFieldOptions {
  /** Filter participants by type (from/to/cc/any) */
  participantType?: 'from' | 'to' | 'cc' | 'any'
  /**
   * Narrow the participant typeahead to these `IdentifierType` values.
   *
   * A SOFT hint the surface recomputes (a phone-only inbox should not suggest
   * email addresses); typed-in values are still accepted, because an inbox's
   * channel set is a union that can grow after the filter is written.
   */
  identifierTypes?: string[]
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
// PATCH → STORED
// ─────────────────────────────────────────────────────────────

/**
 * The `options` PATCH shape a create/update accepts over the wire — i.e. what
 * `fieldOptionsUnionSchema` parses to.
 *
 * Wider than {@link FieldOptions} in one place that matters: `allowNewOptions`
 * may be `null`. That is a **patch-only sentinel** meaning "clear the stored
 * decision back to the type default" — never a stored value.
 */
export type FieldOptionsPatch =
  | NonNullable<FieldOptions['options']>
  | (Omit<FieldOptions, 'allowNewOptions'> & {
      allowNewOptions?: boolean | null
      /**
       * The AI block rides the same envelope and is PERSISTED
       * (`update-field.ts` assigns `fieldOptions.ai`), but {@link FieldOptions}
       * does not declare it — a pre-existing gap, not one this type introduces.
       * Modelled here as opaque because the narrowing only passes it through;
       * declaring it properly on `FieldOptions` is a separate change.
       */
      ai?: unknown
    })

/**
 * Narrow an options PATCH to the shape that is actually STORED.
 *
 * Two rules, both mirroring what `updateCustomField` does when it persists:
 *
 * 1. A bare array patch IS the option list — it becomes `{ options }`.
 * 2. 🛑 `allowNewOptions: null` **clears the key** rather than storing `null`.
 *    The stored flag is tri-state — absent inherits the type default (TAGS
 *    grow, SELECT sets do not), `true`/`false` is the user's decision — and
 *    absence has to stay representable or a field can never return to
 *    inheritance. `null` is how a patch says "go back to inheriting"; storing
 *    it would put a fourth state into a three-state field.
 *
 * Use this anywhere a patch is turned into a `FieldOptions` **without** going
 * through `updateCustomField` — notably the web layer's optimistic field
 * shapes, which must predict what the server will persist. Keeping the rule
 * here rather than at each call site is deliberate: the tri-state has one
 * writer (`updateCustomField`) and one reader (`fieldAllowsNewOptions`), and a
 * third copy that drifts open is how a stored `null` reaches a `!== undefined`
 * check that was written expecting a boolean.
 *
 * @param patch - The options payload from a create/update input
 * @returns The options to store, or undefined when the patch carried none
 */
export function toStoredFieldOptions(
  patch: FieldOptionsPatch | null | undefined
): FieldOptions | undefined {
  if (!patch) return undefined
  if (Array.isArray(patch)) return { options: patch }
  const { allowNewOptions, ...rest } = patch
  return allowNewOptions == null ? rest : { ...rest, allowNewOptions }
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

/** Options for CURRENCY fields */
export type CurrencyFieldOptions = Pick<
  FieldOptions,
  'currencyCode' | 'decimals' | 'useGrouping' | 'currencyDisplay'
>

/** Options for DATE/DATETIME/TIME fields */
export type DateFieldOptions = Pick<
  FieldOptions,
  'format' | 'timeFormat' | 'includeTime' | 'timeZone'
>

/** Options for CHECKBOX fields */
export type BooleanFieldOptions = Pick<FieldOptions, 'checkboxStyle' | 'trueLabel' | 'falseLabel'>

/** Options for TEXT fields */
export type TextFieldOptions = Pick<
  FieldOptions,
  'truncateLength' | 'copyValue' | 'multiline' | 'rows' | 'secret'
>

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
