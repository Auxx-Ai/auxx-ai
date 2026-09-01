// packages/lib/src/import/resolution/resolvers/number.ts

import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/** Grouping characters that never mark a decimal point: spaces and the Swiss apostrophe. */
const GROUPING_NOISE = /[\s'\u2019]/g

/**
 * Reduce a human-written number to `[-+]?digits[.digits]`, or null when the
 * cell holds anything else.
 *
 * Grouping is stripped, the column's configured decimal separator (or `.` by
 * default) is normalised to `.`, and ONE trailing percent sign is dropped: a
 * NUMBER field labelled "Tariff Rate (%)" stores `7.5` for a cell reading
 * `7.5%`, and the sign carries nothing the field does not already declare.
 *
 * `parseInt` / `parseFloat` are deliberately not used. Both read the longest
 * numeric prefix and ignore the rest, so `12abc` was 12, `7.5` was 7 on a
 * whole-number column, and `1.594` (a fractional cent in a minor-unit file)
 * was 1. A silent truncation is the one thing an importer must never do.
 */
function normalizeNumberText(rawValue: string, config: ResolutionConfig): string | null {
  let text = rawValue.trim().replace(/%$/, '').replace(GROUPING_NOISE, '')
  if (config.numberDecimalSeparator === ',') {
    text = text.replace(/\./g, '').replace(',', '.')
  } else {
    text = text.replace(/,/g, '')
  }
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(text) ? text : null
}

/**
 * Resolve value as a whole number.
 *
 * A cell with a fraction is a row error, never rounded or truncated: on a
 * money column read as minor units this is a fractional cent, and on a NUMBER
 * column it is a value the "Decimal number" type keeps intact.
 */
export function resolveInteger(rawValue: string, config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const normalized = normalizeNumberText(trimmed, config)
  if (normalized === null) {
    return { type: 'error', error: `Invalid integer: ${rawValue}` }
  }
  // A zero fraction (`12.0`, `12.00`) is lossless and common in exports.
  const text = normalized.replace(/\.0*$/, '')
  if (!/^[-+]?\d+$/.test(text)) {
    return {
      type: 'error',
      error:
        `"${rawValue}" is not a whole number. Read the column as "Decimal number" to keep ` +
        'the fraction, or round it in the file.',
    }
  }

  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed)) {
    return { type: 'error', error: `Invalid integer: ${rawValue} is too large to store exactly` }
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

  const text = normalizeNumberText(trimmed, config)
  const parsed = text === null ? Number.NaN : Number(text)

  if (!Number.isFinite(parsed)) {
    return { type: 'error', error: `Invalid number: ${rawValue}` }
  }

  return { type: 'value', value: parsed }
}
