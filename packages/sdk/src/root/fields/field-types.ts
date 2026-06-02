// packages/sdk/src/root/fields/field-types.ts

/**
 * Standalone field primitives for the app SDK.
 *
 * The SDK is consumed by third-party developers, so it cannot import from
 * `@auxx/lib` / `@auxx/database`. These mirror the platform's `FieldType` enum
 * (`@auxx/database` ContactFieldType) and `FieldCapabilities`
 * (`@auxx/lib` resources/registry/field-types.ts) and MUST be kept in sync.
 */

/**
 * Every field type the platform supports, as string literals. Mirrors the
 * `ContactFieldType` pg enum.
 */
export const FIELD_TYPES = [
  'TEXT',
  'EMAIL',
  'URL',
  'RICH_TEXT',
  'PHONE',
  'PHONE_INTL',
  'ADDRESS',
  'ADDRESS_STRUCT',
  'FILE',
  'DATE',
  'DATETIME',
  'TIME',
  'NUMBER',
  'CURRENCY',
  'CHECKBOX',
  'JSON',
  'NAME',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'TAGS',
  'RELATIONSHIP',
  'CALC',
  'ACTOR',
] as const

/** A platform field type. */
export type FieldType = (typeof FIELD_TYPES)[number]

/**
 * Author-settable field capabilities. Mirrors `@auxx/lib` `FieldCapabilities`
 * minus `configurable`, which is platform-derived (app/system fields are never
 * user-configurable). Every key is optional with the documented default.
 */
export interface FieldCapabilities {
  /** Usable in Find-node filters. Default true. */
  filterable?: boolean
  /** Usable for ordering. Default true. */
  sortable?: boolean
  /** Settable on create. Default true. */
  creatable?: boolean
  /** Settable on update by users. Default true. App fields usually set false
   *  (the owning app/platform writes values, not users). */
  updatable?: boolean
  /** Required on create. Default false. */
  required?: boolean
  /** Must hold unique values within scope. Default false. */
  unique?: boolean
  /** Computed/derived; cannot be directly set. Default false. */
  computed?: boolean
  /** Invisible in every user-facing surface (panel, pickers, import/export,
   *  custom-field list, agent context). System code still reads/writes it.
   *  Default false. */
  hidden?: boolean
}

/** Scope of an app-declared field — see app-registered custom fields §7. */
export type FieldScope = 'installation' | 'connection'

/** A select option for SINGLE_SELECT / MULTI_SELECT / TAGS fields. */
export interface FieldSelectOption {
  value: string
  label?: string
  color?: string
}

/**
 * Base `FieldType → TS value` map (not options-aware). Drives the typed
 * `ctx.entities` value types. Select types resolve to `string` here; the
 * options-aware `FieldValueType<F>` (define-field.ts) narrows them to the
 * declared option-value union for a concrete field definition.
 */
export interface FieldTypeValueMap {
  TEXT: string
  EMAIL: string
  URL: string
  RICH_TEXT: string
  PHONE: string
  PHONE_INTL: string
  ADDRESS: string
  DATE: string
  DATETIME: string
  TIME: string
  NUMBER: number
  CURRENCY: number
  CHECKBOX: boolean
  JSON: unknown
  NAME: string
  SINGLE_SELECT: string
  MULTI_SELECT: string[]
  TAGS: string[]
  ADDRESS_STRUCT: Record<string, unknown>
  FILE: { url: string; name?: string }
  RELATIONSHIP: string
  CALC: string | number
  ACTOR: string | string[]
}
