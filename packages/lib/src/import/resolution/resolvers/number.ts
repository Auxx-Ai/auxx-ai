// packages/lib/src/import/resolution/resolvers/number.ts

import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/**
 * Resolve value as integer.
 */
export function resolveInteger(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  // Remove thousand separators
  const cleaned = trimmed.replace(/,/g, '')
  const parsed = parseInt(cleaned, 10)

  if (Number.isNaN(parsed)) {
    return { type: 'error', error: `Invalid integer: ${rawValue}` }
  }

  return { type: 'value', value: parsed }
}

/**
 * Resolve value as decimal number.
 */
export function resolveDecimal(rawValue: string, config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  let cleaned = trimmed

  // Handle European decimal separator
  if (config.numberDecimalSeparator === ',') {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    cleaned = cleaned.replace(/,/g, '')
  }

  const parsed = parseFloat(cleaned)

  if (Number.isNaN(parsed)) {
    return { type: 'error', error: `Invalid number: ${rawValue}` }
  }

  return { type: 'value', value: parsed }
}
