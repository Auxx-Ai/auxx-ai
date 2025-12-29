// packages/lib/src/resources/crud/utils/parse-tags.ts

/**
 * Parse tags from various input formats.
 * Handles: string[], comma-separated string, null/undefined
 */
export function parseTags(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  }
  return []
}
