// packages/lib/src/import/resolution/resolve-value.ts

import type { ResolvedValue, ResolutionConfig, ResolutionType } from '../types/resolution'
import { getResolver } from './resolver-registry'

/**
 * Resolve a single raw value using the specified resolution type.
 *
 * @param rawValue - The raw string value to resolve
 * @param resolutionType - The type of resolution to apply
 * @param config - Optional configuration for the resolver
 * @returns The resolved value result
 */
export function resolveValue(
  rawValue: string,
  resolutionType: ResolutionType,
  config: ResolutionConfig = {}
): ResolvedValue {
  const resolver = getResolver(resolutionType)

  if (!resolver) {
    return {
      type: 'error',
      error: `Unknown resolution type: ${resolutionType}`,
    }
  }

  try {
    return resolver(rawValue, config)
  } catch (error) {
    return {
      type: 'error',
      error: error instanceof Error ? error.message : 'Resolution failed',
    }
  }
}
