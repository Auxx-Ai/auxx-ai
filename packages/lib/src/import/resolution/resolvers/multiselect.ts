// packages/lib/src/import/resolution/resolvers/multiselect.ts

import { resolveSelectValue } from './select'
import type { ResolvedValue, ResolutionConfig } from '../../types/resolution'

/**
 * Split string by delimiter and resolve each as select value.
 */
export function resolveMultiselectSplit(rawValue: string, config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: [] }
  }

  const separator = config.arraySeparator || ','
  const parts = trimmed
    .split(separator)
    .map((p) => p.trim())
    .filter(Boolean)

  const resolved: string[] = []
  const errors: string[] = []

  for (const part of parts) {
    const result = resolveSelectValue(part, config)

    if (result.type === 'value' && result.value) {
      resolved.push(result.value as string)
    } else if (result.type === 'error') {
      errors.push(result.error!)
    }
  }

  if (errors.length > 0) {
    return {
      type: 'warning',
      value: resolved,
      warning: `Some values not matched: ${errors.join(', ')}`,
    }
  }

  return { type: 'value', value: resolved }
}
