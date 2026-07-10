// packages/lib/src/settings/normalize-setting-value.ts
// Write-path coercion + validation for setting values, keyed off the catalog's
// FieldType. Delegates scalar coercion to the shared field-value Zod schemas
// (`field-values/field-value-validator.ts`) rather than reimplementing typeof
// checks — see plans/settings/v2/README.md §Value shapes & validation.

import { BadRequestError } from '../errors'
import { fieldValueSchemas } from '../field-values/field-value-validator'
import type { SettingConfig } from './catalog'
import type { SettingValue } from './types'

/**
 * Coerce + validate a setting write against its catalog entry. `null` is
 * always accepted — it means "reset to default". Throws {@link BadRequestError}
 * on invalid values.
 */
export function normalizeSettingValue(
  key: string,
  config: SettingConfig,
  value: SettingValue
): SettingValue {
  if (value === null) return null

  switch (config.fieldType) {
    case 'TEXT':
    case 'RICH_TEXT': {
      const result = fieldValueSchemas.text.safeParse(value)
      if (!result.success) {
        throw new BadRequestError(`Setting ${key} expects a string value`)
      }
      return result.data
    }

    case 'NUMBER':
    case 'CURRENCY': {
      const result = fieldValueSchemas.number.safeParse(value)
      if (!result.success) {
        throw new BadRequestError(`Setting ${key} expects a number value`)
      }
      return result.data
    }

    case 'CHECKBOX': {
      const result = fieldValueSchemas.boolean.safeParse(value)
      if (!result.success) {
        throw new BadRequestError(`Setting ${key} expects a boolean value`)
      }
      return result.data
    }

    case 'SINGLE_SELECT': {
      const result = fieldValueSchemas.option.safeParse(value)
      if (!result.success) {
        throw new BadRequestError(`Setting ${key} expects a select value`)
      }
      const allowedValues = config.options?.options?.map((option) => String(option.value))
      if (allowedValues && !allowedValues.includes(result.data)) {
        throw new BadRequestError(`Setting ${key} expects one of: ${allowedValues.join(', ')}`)
      }
      return result.data
    }

    case 'TAGS':
    case 'MULTI_SELECT': {
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        throw new BadRequestError(`Setting ${key} expects an array of strings`)
      }
      return value
    }

    case 'JSON': {
      // Passthrough for UI-state blobs and structural values — must be an
      // object or array, never a bare scalar.
      if (value === null || typeof value !== 'object') {
        throw new BadRequestError(`Setting ${key} expects an object or array value`)
      }
      return value
    }

    default:
      // No Phase-1 catalog entry uses FILE/RELATIONSHIP/etc. yet — pass
      // through rather than rejecting so future entries aren't blocked here.
      return value
  }
}
