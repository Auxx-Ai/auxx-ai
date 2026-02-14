// packages/lib/src/import/resolution/resolvers/email.ts

import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Resolve and validate email address.
 */
export function resolveEmail(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim().toLowerCase()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    return { type: 'error', error: `Invalid email: ${rawValue}` }
  }

  return { type: 'value', value: trimmed }
}
