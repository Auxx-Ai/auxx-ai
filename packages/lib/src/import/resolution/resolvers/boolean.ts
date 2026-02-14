// packages/lib/src/import/resolution/resolvers/boolean.ts

import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

const TRUTHY_VALUES = new Set(['true', 'yes', '1', 'y', 'on', 'enabled', 'active'])

const FALSY_VALUES = new Set(['false', 'no', '0', 'n', 'off', 'disabled', 'inactive'])

/**
 * Resolve boolean from various string representations.
 */
export function resolveBoolean(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim().toLowerCase()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  if (TRUTHY_VALUES.has(trimmed)) {
    return { type: 'value', value: true }
  }

  if (FALSY_VALUES.has(trimmed)) {
    return { type: 'value', value: false }
  }

  return {
    type: 'warning',
    warning: `Unrecognized boolean value: ${rawValue}`,
    value: null,
  }
}
