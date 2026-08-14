// packages/lib/src/import/resolution/resolvers/url.ts

import { fieldValueSchemas } from '../../../field-values/field-value-validator'
import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/**
 * Resolve and validate a URL, preserving scheme and path.
 *
 * Reuses the write path's zod schema (`fieldValueSchemas.url`: trim, lowercase,
 * `https://`-prefix when no protocol) so an imported URL lands byte-identical to
 * a hand-typed one and round-trips through export → import losslessly. This is
 * deliberately NOT `domain:value`, which strips scheme/path/`www.` — the lossy
 * mapping URL fields historically got.
 */
export function resolveUrl(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const parsed = fieldValueSchemas.url.safeParse(trimmed)
  if (!parsed.success) {
    return { type: 'error', error: `Invalid URL: ${rawValue}` }
  }

  return { type: 'value', value: parsed.data }
}
