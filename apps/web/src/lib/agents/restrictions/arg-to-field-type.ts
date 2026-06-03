// apps/web/src/lib/agents/restrictions/arg-to-field-type.ts

import { FieldType } from '@auxx/database/enums'
import type { FieldOptions } from '@auxx/lib/field-values/client'

/**
 * A single top-level property of a tool's `inputsJsonSchema`, in the minimal
 * shape this mapper reads. The dialog passes one of these per arg.
 */
export interface ToolArgSchema {
  /** JSON-Schema `type`. May be a single string or an array (e.g. `['string','null']`). */
  type?: string | string[]
  /** JSON-Schema `enum` — present on closed string sets. */
  enum?: unknown[]
  /** Free-form description for the arg row. */
  description?: string
}

/**
 * Result of mapping a tool arg's JSON-Schema to a platform `FieldType`.
 *
 * `supported: false` marks structured args (object/array) — v6 only binds
 * top-level scalars, so the dialog lists these but disables their controls.
 */
export type ArgFieldTypeResult =
  | {
      supported: true
      /** Platform `FieldType` string fed to `FieldInputAdapter`. */
      fieldType: string
      /** `FieldOptions` for the adapter (only `options` is populated, for enums). */
      options?: FieldOptions
    }
  | {
      supported: false
      /** Why the arg can't be bound — surfaced as the disabled hint. */
      reason: string
    }

/** Normalize a JSON-Schema `type` (string | array) to the first non-null scalar. */
function primaryType(type: string | string[] | undefined): string | undefined {
  if (Array.isArray(type)) return type.find((t) => t !== 'null')
  return type
}

/**
 * Map a tool's JSON-Schema arg to a platform `FieldType` (+ options) so the
 * restriction dialog can render the same typed `FieldInputAdapter` the
 * conditions builder uses for constant values — no workflow/VarEditor bundle.
 *
 * Scalar-only (v6):
 *   - `string`            → `TEXT`
 *   - `string` + `enum`   → `SINGLE_SELECT` (enum mapped to select options)
 *   - `number` / `integer`→ `NUMBER`
 *   - `boolean`           → `CHECKBOX`
 *   - `object` / `array`  → `{ supported: false }` (structured, out of scope)
 *
 * See plans/chat/v6 phase-4 "Reuse boundary."
 */
export function argToFieldType(arg: ToolArgSchema): ArgFieldTypeResult {
  const type = primaryType(arg.type)

  if (type === 'object' || type === 'array') {
    return { supported: false, reason: 'structured args not yet supported (v6 scalar-only)' }
  }

  if (type === 'boolean') {
    return { supported: true, fieldType: FieldType.CHECKBOX }
  }

  if (type === 'number' || type === 'integer') {
    return { supported: true, fieldType: FieldType.NUMBER }
  }

  if (type === 'string') {
    if (Array.isArray(arg.enum) && arg.enum.length > 0) {
      const options: FieldOptions = {
        options: arg.enum.map((v) => {
          const value = String(v)
          return { value, label: value }
        }),
      }
      return { supported: true, fieldType: FieldType.SINGLE_SELECT, options }
    }
    return { supported: true, fieldType: FieldType.TEXT }
  }

  // Unknown / absent type — treat as free text so the admin can still pin a
  // constant. Safer than blocking; the tool coerces.
  return { supported: true, fieldType: FieldType.TEXT }
}

/**
 * True when a var's `fieldType` is compatible with an arg's mapped FieldType.
 * Lenient by design: any TEXT-ish var (TEXT/EMAIL/URL/PHONE/…) may bind a
 * string arg, since the value is a scalar the tool ultimately coerces. Exact
 * match otherwise. See plans/chat/v6 phase-4 var-picker type-match.
 */
export function isVarFieldTypeCompatible(argFieldType: string, varFieldType: string): boolean {
  if (argFieldType === varFieldType) return true
  if (argFieldType === FieldType.TEXT) {
    return TEXT_LIKE_FIELD_TYPES.has(varFieldType)
  }
  return false
}

/** FieldTypes whose stored scalar is a plain string — interchangeable with TEXT. */
const TEXT_LIKE_FIELD_TYPES: ReadonlySet<string> = new Set([
  FieldType.TEXT,
  FieldType.EMAIL,
  FieldType.URL,
  FieldType.PHONE_INTL,
  FieldType.RICH_TEXT,
  FieldType.SINGLE_SELECT,
])
