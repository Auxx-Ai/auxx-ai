// packages/lib/src/import/resolution/resolvers/text.ts

import type { ResolvedValue, ResolutionConfig } from '../../types/resolution'

/**
 * Resolve text value - returns as-is after trimming.
 */
export function resolveTextValue(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  return { type: 'value', value: trimmed }
}

/**
 * Resolve text as cuid2 - validates cuid2 format.
 * cuid2 IDs are 24-32 characters, lowercase alphanumeric.
 */
export function resolveTextCuid(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  // cuid2 pattern: lowercase alphanumeric, typically 24-32 chars
  // Starts with a letter, followed by alphanumeric
  const cuidPattern = /^[a-z][a-z0-9]{23,31}$/

  if (!cuidPattern.test(trimmed)) {
    return { type: 'error', error: `Invalid ID format: ${trimmed}` }
  }

  return { type: 'value', value: trimmed }
}
