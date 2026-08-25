// packages/lib/src/import/resolution/option-labels.ts

import type { SelectOption } from '@auxx/types/custom-field'
import {
  buildOptionIndex,
  type FieldOptionItem,
  resolveOptionId,
} from '../../resources/registry/option-helpers'

/**
 * Whether a column resolves against a select-ish option list.
 *
 * The one test that decides whether the review step renders a picker, whether
 * a stored value is an option KEY (and therefore must be rendered as a label),
 * and whether `select:create` is even a meaningful thing to offer.
 *
 * @param resolutionType - The column's stored resolution type
 * @returns True for `select:*` and `multiselect:*`
 */
export function isOptionResolutionType(resolutionType: string | null | undefined): boolean {
  if (!resolutionType) return false
  return resolutionType.startsWith('select:') || resolutionType.startsWith('multiselect:')
}

/**
 * Render option key(s) as the label(s) a human recognises.
 *
 * Both the server read (`getUniqueValuesWithResolution`) and the review row's
 * optimistic patch need this answer for the same value, so it lives once and is
 * client-safe. It resolves through {@link resolveOptionId}, which matches BOTH
 * option keyspaces (`id` and `value`) — a hand-rolled `.find()` on `value`
 * silently orphans every app/connector-provisioned option.
 *
 * Returns null when the list is unknown or nothing matches: a pending option
 * CREATE carries the label to be minted rather than a key, and null is what
 * tells the caller to fall back to the raw value instead of rendering a nanoid.
 *
 * @param keys - The stored option key(s)
 * @param options - The field's current option list, or a prebuilt index
 * @returns The comma-joined label(s), or null
 */
export function resolveOptionLabel(
  keys: string[],
  options: SelectOption[] | Map<string, FieldOptionItem> | null | undefined
): string | null {
  if (!options || keys.length === 0) return null
  const index = Array.isArray(options) ? buildOptionIndex(options) : options
  if (index.size === 0) return null
  const resolved = keys.map((key) => resolveOptionId(key, index))
  if (resolved.every((r) => r.status === 'unknown')) return null
  return resolved.map((r) => (r.status === 'known' ? r.label : r.raw)).join(', ')
}
