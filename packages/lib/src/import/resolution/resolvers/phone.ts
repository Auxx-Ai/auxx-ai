// packages/lib/src/import/resolution/resolvers/phone.ts

import type { ResolvedValue, ResolutionConfig } from '../../types/resolution'

/**
 * Resolve and normalize phone number.
 * Strips non-numeric characters except leading +.
 */
export function resolvePhone(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  // Preserve leading + for international numbers
  const hasPlus = trimmed.startsWith('+')

  // Keep only digits
  const digits = trimmed.replace(/\D/g, '')

  if (digits.length < 7) {
    return { type: 'error', error: `Phone number too short: ${rawValue}` }
  }

  if (digits.length > 15) {
    return { type: 'error', error: `Phone number too long: ${rawValue}` }
  }

  const normalized = hasPlus ? `+${digits}` : digits

  return { type: 'value', value: normalized }
}
