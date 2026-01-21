// packages/lib/src/field-values/converters/calc.ts

import type { TypedFieldValueInput, TypedFieldValue } from '@auxx/types/field-value'
import type { FieldValueConverter, FieldOptions, ConverterOptions } from './index'

/**
 * Converter for CALC (calculated) fields.
 *
 * CALC fields are computed on-demand, not stored in the database.
 * This converter handles conversion between computed results and display values.
 */
export const calcConverter: FieldValueConverter = {
  /**
   * CALC fields cannot be directly set - they're computed.
   * This returns null to indicate "do not store".
   */
  toTypedInput(_value: unknown, _options?: ConverterOptions): TypedFieldValueInput | null {
    // CALC fields are read-only computed values
    // Return null to prevent storage attempts
    return null
  },

  /**
   * Extract raw value from computed result.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): unknown {
    if (!value || typeof value !== 'object') return value

    const typed = value as TypedFieldValue
    if ('value' in typed) {
      return typed.value
    }
    return value
  },

  /**
   * Format computed value for display.
   * The actual formatting is handled by DisplayCalc using the resultFieldType.
   */
  toDisplayValue(value: TypedFieldValue, _options?: FieldOptions): unknown {
    if (!value) return null
    return this.toRawValue(value)
  },
}
