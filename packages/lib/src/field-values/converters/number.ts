// packages/lib/src/field-values/converters/number.ts

import type {
  NumberFieldValue,
  TypedFieldValue,
  TypedFieldValueInput,
} from '@auxx/types/field-value'
import { formatCurrency } from '@auxx/utils/currency'
import { DEFAULT_CURRENCY_OPTIONS, DEFAULT_NUMBER_OPTIONS } from '../../custom-fields/defaults'
import type { FieldOptions, FieldValueConverter } from './index'

/**
 * Converter for NUMBER field type.
 * Stores as valueNumber in the database.
 */
export const numberConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts number, string (parses), or null/undefined.
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'number') {
        return { type: 'number', value: (typed as NumberFieldValue).value }
      }
    }

    // Parse number from input
    let num: number
    if (typeof value === 'number') {
      num = value
    } else if (typeof value === 'string') {
      // Remove common formatting characters (commas, currency symbols)
      const cleaned = value.replace(/[$€£,\s]/g, '').trim()
      if (cleaned === '') return null
      num = parseFloat(cleaned)
    } else {
      return null
    }

    // Validate
    if (Number.isNaN(num) || !isFinite(num)) {
      return null
    }

    return { type: 'number', value: num }
  },

  /**
   * Convert TypedFieldValue/Input to raw number value.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): number | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle TypedFieldValue or TypedFieldValueInput
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'number') {
        return (typed as NumberFieldValue).value
      }
      return null
    }

    // Handle raw number passthrough
    if (typeof value === 'number' && isFinite(value)) {
      return value
    }

    return null
  },

  /**
   * Convert TypedFieldValue to display string.
   * Applies display options like decimals, grouping, displayAs, prefix, suffix.
   */
  toDisplayValue(value: TypedFieldValue, options?: FieldOptions): string {
    if (!value) {
      return ''
    }

    const typed = value as NumberFieldValue
    const num = typed.value

    if (num === null || num === undefined || Number.isNaN(num)) {
      return ''
    }

    // Merge defaults with provided options
    const opts = { ...DEFAULT_NUMBER_OPTIONS, ...options }

    let formatted: string

    switch (opts.displayAs) {
      case 'percentage':
        formatted = new Intl.NumberFormat(undefined, {
          style: 'percent',
          minimumFractionDigits: opts.decimals,
          maximumFractionDigits: opts.decimals,
        }).format(num / 100)
        break
      case 'compact':
        formatted = new Intl.NumberFormat(undefined, {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(num)
        break
      case 'bytes':
        formatted = formatBytesInternal(num, opts.decimals)
        break
      default:
        formatted = num.toLocaleString(undefined, {
          minimumFractionDigits: opts.decimals,
          maximumFractionDigits: opts.decimals,
          useGrouping: opts.useGrouping,
        })
    }

    return `${opts.prefix}${formatted}${opts.suffix}`
  },
}

/**
 * Format bytes to human-readable string (internal helper)
 */
function formatBytesInternal(bytes: number, decimals: number = 0): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const value = bytes / k ** i
  return `${value.toFixed(decimals)} ${sizes[i]}`
}

/**
 * Converter for CURRENCY field type.
 * Same storage as NUMBER but with currency-specific display options.
 * Uses formatCurrency() from @auxx/utils/currency for consistent formatting.
 */
export const currencyConverter: FieldValueConverter = {
  // Use same input conversion as number
  toTypedInput: numberConverter.toTypedInput,

  // Use same raw value extraction as number
  toRawValue: numberConverter.toRawValue,

  /**
   * Convert TypedFieldValue to display string with currency formatting.
   * Uses the centralized formatCurrency utility for consistent output.
   */
  toDisplayValue(value: TypedFieldValue, options?: FieldOptions): string {
    if (!value) {
      return ''
    }

    const typed = value as NumberFieldValue
    const num = typed.value

    if (num === null || num === undefined || Number.isNaN(num)) {
      return ''
    }

    // Merge defaults with provided options (flat keys on field.options)
    const opts = {
      currencyCode: options?.currencyCode ?? DEFAULT_CURRENCY_OPTIONS.currencyCode,
      decimals: options?.decimals ?? DEFAULT_CURRENCY_OPTIONS.decimals,
      useGrouping: options?.useGrouping ?? DEFAULT_CURRENCY_OPTIONS.useGrouping,
      currencyDisplay: options?.currencyDisplay ?? DEFAULT_CURRENCY_OPTIONS.currencyDisplay,
    }

    // formatCurrency expects cents, so convert dollars to cents
    const cents = Math.round(num * 100)

    return formatCurrency(cents, opts)
  },
}
