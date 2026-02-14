// packages/lib/src/import/resolution/resolvers/array.ts

import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/**
 * Split string by delimiter into array.
 */
export function resolveArraySplit(rawValue: string, config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: [] }
  }

  const separator = config.arraySeparator || ','
  const values = trimmed
    .split(separator)
    .map((v) => v.trim())
    .filter(Boolean)

  return { type: 'value', value: values }
}
