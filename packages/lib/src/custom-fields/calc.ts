// packages/lib/src/custom-fields/calc.ts

import type { FieldType } from '@auxx/database/types'
import type { CalcOptions } from './field-options'

/**
 * Pull the `options.calc` block off any field shape, or null when absent.
 * Defensive about the shape so it works for `CustomFieldEntity`,
 * `CachedField`, and the client `ResourceField` projection alike.
 */
export function getCalcOptions(
  field: { options?: unknown } | null | undefined
): CalcOptions | null {
  const opts = (field?.options as { calc?: CalcOptions } | null | undefined)?.calc
  return opts ?? null
}

/**
 * The field type used for *rendering* and *output validation*. For CALC
 * fields, this is `options.calc.resultFieldType`; for everything else it's
 * just the `FieldType` enum value on the field. Falls back to `'TEXT'` on a
 * misconfigured CALC.
 *
 * Reads `fieldType` first, then `type`, because the client `ResourceField`
 * shape carries BOTH — `type` is the `BaseType` (`'string'`, `'datetime'`,
 * lowercase) used by the workflow engine, while `fieldType` is the actual
 * `FieldType` enum (`'TEXT'`, `'DATETIME'`, uppercase). Server shapes
 * (`CustomFieldEntity`, `CachedField`) only have `type` and it's already
 * the `FieldType`.
 *
 * Pure — safe in client and server code.
 */
export function getEffectiveFieldType(field: {
  type?: FieldType | string
  fieldType?: FieldType
  options?: unknown
}): FieldType {
  const native = (field.fieldType ?? field.type) as FieldType | undefined
  if (native !== 'CALC') return (native ?? 'TEXT') as FieldType
  const calc = getCalcOptions(field)
  return ((calc?.resultFieldType as FieldType | undefined) ?? 'TEXT') as FieldType
}
