// packages/lib/src/import/resolution/resolvers/select.ts

import type { ResolvedValue, ResolutionConfig } from '../../types/resolution'

/** Normalize a value for fuzzy comparison by removing separators and lowercasing */
function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[-_\s]+/g, '') // Remove separators (dashes, underscores, spaces)
}

/** Common boolean-like true values */
const BOOLEAN_LIKE_TRUE = ['yes', 'true', '1', 'active', 'enabled', 'on']
/** Common boolean-like false values */
const BOOLEAN_LIKE_FALSE = ['no', 'false', '0', 'inactive', 'disabled', 'off']

/**
 * Match value to existing enum option.
 */
export function resolveSelectValue(rawValue: string, config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const enumValues = config.enumValues || []

  // 1. Exact match on dbValue
  const exactMatch = enumValues.find((e) => e.dbValue === trimmed)
  if (exactMatch) {
    return { type: 'value', value: exactMatch.dbValue }
  }

  // 2. Case-insensitive match on label
  const lowerTrimmed = trimmed.toLowerCase()
  const labelMatch = enumValues.find((e) => e.label.toLowerCase() === lowerTrimmed)
  if (labelMatch) {
    return { type: 'value', value: labelMatch.dbValue }
  }

  // 3. Case-insensitive match on dbValue
  const dbValueMatch = enumValues.find((e) => e.dbValue.toLowerCase() === lowerTrimmed)
  if (dbValueMatch) {
    return { type: 'value', value: dbValueMatch.dbValue }
  }

  // 4. Normalized matching (handles separators/casing variations like "in_progress" → "In Progress")
  const normalizedInput = normalizeForComparison(trimmed)
  const normalizedMatch = enumValues.find(
    (e) =>
      normalizeForComparison(e.dbValue) === normalizedInput ||
      normalizeForComparison(e.label) === normalizedInput
  )
  if (normalizedMatch) {
    return {
      type: 'warning',
      value: normalizedMatch.dbValue,
      warning: `Auto-corrected "${rawValue}" to "${normalizedMatch.label}"`,
    }
  }

  // 5. Boolean-like matching for binary enum fields
  if (enumValues.length === 2) {
    if (BOOLEAN_LIKE_TRUE.includes(lowerTrimmed)) {
      // Find the "truthy" option
      const truthyOption = enumValues.find(
        (e) =>
          BOOLEAN_LIKE_TRUE.includes(e.dbValue.toLowerCase()) ||
          BOOLEAN_LIKE_TRUE.includes(e.label.toLowerCase())
      )
      if (truthyOption) {
        return {
          type: 'warning',
          value: truthyOption.dbValue,
          warning: `Interpreted "${rawValue}" as "${truthyOption.label}"`,
        }
      }
    }
    if (BOOLEAN_LIKE_FALSE.includes(lowerTrimmed)) {
      // Find the "falsy" option
      const falsyOption = enumValues.find(
        (e) =>
          BOOLEAN_LIKE_FALSE.includes(e.dbValue.toLowerCase()) ||
          BOOLEAN_LIKE_FALSE.includes(e.label.toLowerCase())
      )
      if (falsyOption) {
        return {
          type: 'warning',
          value: falsyOption.dbValue,
          warning: `Interpreted "${rawValue}" as "${falsyOption.label}"`,
        }
      }
    }
  }

  return {
    type: 'error',
    error: `No matching option for: ${rawValue}`,
  }
}

/**
 * Match to existing enum or create new option.
 */
export function resolveSelectCreate(rawValue: string, config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const enumValues = config.enumValues || []

  // Try exact match
  const match = enumValues.find(
    (e) => e.dbValue === trimmed || e.label.toLowerCase() === trimmed.toLowerCase()
  )

  if (match) {
    return { type: 'value', value: match.dbValue }
  }

  // Will create new option
  return {
    type: 'create',
    value: trimmed,
    warning: `Will create new option: ${trimmed}`,
  }
}
