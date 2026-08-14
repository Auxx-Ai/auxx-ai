// packages/lib/src/import/resolution/resolvers/split.ts

import { MAX_MULTI_VALUES } from '../../../field-values/primary-value'
import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'
import { resolveEmail } from './email'
import { resolvePhone } from './phone'
import { resolveUrl } from './url'

/**
 * Split resolutions for multi-value scalar fields (`options.multi`).
 *
 * A cell like `"a@x.com, b@y.com"` splits on `,` / `;`, each element is
 * trimmed, validated and normalized by the per-type scalar resolver, deduped
 * case-insensitively, and capped at `MAX_MULTI_VALUES`. Invalid elements are
 * dropped with a warning (the row still imports); when EVERY element is
 * invalid the whole cell is an error. There is no escape syntax — the CSV
 * layer quotes cells, and a valid email/phone cannot contain an unquoted
 * comma.
 */

/** Per-element scalar resolver signature (same shape as the registry's). */
type ElementResolver = (rawValue: string, config: ResolutionConfig) => ResolvedValue

/** Split a raw cell on `,` / `;` into trimmed, non-empty elements. */
export function splitMultiValueCell(rawValue: string): string[] {
  return rawValue
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * Resolve a multi-value cell by splitting and running the scalar resolver per
 * element. Returns:
 * - `{ type: 'value', value: null }` for a blank cell (update rows treat this
 *   as a no-write on multi fields),
 * - `{ type: 'value', value: string[] }` when every element resolved,
 * - `{ type: 'warning', value: string[], warning }` when some elements were
 *   dropped (invalid or over the cap),
 * - `{ type: 'error', error }` when no element resolved.
 */
function resolveSplit(
  rawValue: string,
  config: ResolutionConfig,
  resolveElement: ElementResolver
): ResolvedValue {
  const elements = splitMultiValueCell(rawValue)

  if (elements.length === 0) {
    return { type: 'value', value: null }
  }

  const values: string[] = []
  const seen = new Set<string>()
  const dropped: string[] = []

  for (const element of elements) {
    const resolved = resolveElement(element, config)
    if (resolved.type === 'error' || resolved.value == null) {
      dropped.push(element)
      continue
    }
    const value = String(resolved.value)
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    values.push(value)
  }

  if (values.length === 0) {
    return { type: 'error', error: `No valid values in: ${rawValue}` }
  }

  const warnings: string[] = []
  if (dropped.length > 0) {
    warnings.push(
      `Dropped invalid ${dropped.length === 1 ? 'value' : 'values'}: ${dropped.join(', ')}`
    )
  }
  if (values.length > MAX_MULTI_VALUES) {
    const overflow = values.splice(MAX_MULTI_VALUES)
    warnings.push(
      `Dropped ${overflow.length} over the ${MAX_MULTI_VALUES}-value limit: ${overflow.join(', ')}`
    )
  }

  if (warnings.length > 0) {
    return { type: 'warning', value: values, warning: warnings.join('; ') }
  }

  return { type: 'value', value: values }
}

/** Split a cell into validated, normalized email addresses. */
export function resolveEmailSplit(rawValue: string, config: ResolutionConfig): ResolvedValue {
  return resolveSplit(rawValue, config, resolveEmail)
}

/** Split a cell into validated, normalized phone numbers. */
export function resolvePhoneSplit(rawValue: string, config: ResolutionConfig): ResolvedValue {
  return resolveSplit(rawValue, config, resolvePhone)
}

/** Split a cell into validated, normalized URLs (same per-element rules as `url:value`). */
export function resolveUrlSplit(rawValue: string, config: ResolutionConfig): ResolvedValue {
  return resolveSplit(rawValue, config, resolveUrl)
}
