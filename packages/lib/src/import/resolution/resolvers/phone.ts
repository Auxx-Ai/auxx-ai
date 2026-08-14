// packages/lib/src/import/resolution/resolvers/phone.ts

import { formatPhoneNumber } from '@auxx/utils'
import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/**
 * Resolve and normalize a phone number to E.164.
 *
 * Delegates to the shared `formatPhoneNumber` normalizer so the resolver emits
 * exactly what the write validator (`fieldValueSchemas.phone`) accepts —
 * previously the resolver's hand-rolled digit logic accepted international
 * numbers the write path then rejected mid-import.
 *
 * Empty cells resolve to `null` (a no-write on update rows); anything the
 * normalizer can't parse is a row error, never a silent drop.
 */
export function resolvePhone(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const normalized = formatPhoneNumber(trimmed)

  if (!normalized) {
    return { type: 'error', error: `Invalid phone number: ${rawValue}` }
  }

  return { type: 'value', value: normalized }
}
